"""Scheduled jobs (Tasks): run a prompt against a backend on a schedule.

Jobs live in the `schedules` table and are executed by APScheduler inside the
manager process. Each run creates a chat thread (title "[job] <name>", owner
"scheduler"), sends the prompt, and records the result in `job_runs` — summary
inline, full output in DATA_DIR/reports/.

Backends:
  netops  — in-process, reuses runs.start() (NetOps Agent /chat SSE).
  hermes  — POST /v1/runs with the stored API key, then reads the run's SSE
            event stream until done (same protocol the browser adapter uses).
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
import uuid
from pathlib import Path

import db
import notify
import runs

HERMES_URL = os.environ.get("HERMES_URL", "http://127.0.0.1:8642").rstrip("/")
RUN_TIMEOUT_S = 1800        # 30 menit per run
MAX_OUTPUT = 20000          # panjang output yang disimpan inline di job_runs

_sched = None
_lock = threading.Lock()


def _reports_dir() -> Path:
    d = db.DATA_DIR / "reports"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _hermes_key() -> str | None:
    with db.conn() as c:
        r = c.execute("SELECT value FROM secrets WHERE name='hermes_api_key'").fetchone()
    return r["value"] if r else None


def _create_thread(backend: str, title: str) -> str:
    tid = uuid.uuid4().hex
    with db.conn() as c:
        c.execute("INSERT OR IGNORE INTO chat_threads (id, backend, title, owner) VALUES (?,?,?,?)",
                  (tid, backend, title[:200], "scheduler"))
    return tid


def _run_netops(schedule: dict) -> tuple[str, str]:
    """(output, error) via the in-process run worker."""
    tid = _create_thread("netops", f"[job] {schedule['name']}")
    runs.start(tid, [{"role": "user", "content": schedule["prompt"]}])
    deadline = time.time() + RUN_TIMEOUT_S
    while time.time() < deadline:
        r = runs._runs.get(tid)
        if r is not None and r.done:
            with r.cond:
                evs = list(r.events)
            out = "".join(e.get("text", "") for e in evs if e.get("type") == "delta")
            err = next((e.get("text", "") for e in evs if e.get("type") == "error"), "")
            return out, err
        time.sleep(2)
    return "", "timeout"


def _run_hermes(schedule: dict) -> tuple[str, str]:
    key = _hermes_key()
    if not key:
        return "", "API key Hermes belum diset (Settings > Backend > Hermes)"
    tid = _create_thread("hermes", f"[job] {schedule['name']}")
    req = urllib.request.Request(
        HERMES_URL + "/v1/runs",
        json.dumps({"input": schedule["prompt"], "session_id": tid}).encode(),
        {"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urllib.request.urlopen(req, timeout=30) as resp:
        run_id = json.loads(resp.read())["run_id"]
    out, err = "", ""
    req2 = urllib.request.Request(
        HERMES_URL + f"/v1/runs/{run_id}/events",
        {"Authorization": "Bearer " + key})
    deadline = time.time() + RUN_TIMEOUT_S
    try:
        with urllib.request.urlopen(req2, timeout=RUN_TIMEOUT_S + 30) as resp:
            for raw in resp:
                if time.time() > deadline:
                    err = "timeout"
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                try:
                    ev = json.loads(line[5:].strip())
                except ValueError:
                    continue
                kind = ev.get("event")
                if kind == "message.delta":
                    out += ev.get("delta") or ""
                elif kind == "error":
                    err = ev.get("text") or "error"
                elif kind in ("done", "run.completed"):
                    break
    except Exception as e:  # noqa: BLE001
        err = f"gagal menghubungi Hermes: {e}"
    return out, err


def execute(schedule_id: str) -> None:
    """One job run. Safe to call from the scheduler or a 'run now' endpoint."""
    with db.conn() as c:
        s = c.execute("SELECT * FROM schedules WHERE id=?", (schedule_id,)).fetchone()
        if not s or not s["enabled"]:
            return
        s = dict(s)
        run_id = uuid.uuid4().hex
        c.execute("INSERT INTO job_runs (id, schedule_id, started_at, status) VALUES (?,?,?, 'running')",
                  (run_id, schedule_id, time.time()))
    try:
        out, err = _run_netops(s) if s["backend"] == "netops" else _run_hermes(s)
        status = "failed" if (err and not out) else "success"
        path = ""
        if out:
            f = _reports_dir() / f"job-{run_id}.md"
            f.write_text(f"# {s['name']}\n\n{out}\n", encoding="utf-8")
            path = str(f)
        with db.conn() as c:
            c.execute("UPDATE job_runs SET finished_at=?, status=?, output=?, file=?, error=? WHERE id=?",
                      (time.time(), status, out[:MAX_OUTPUT], path, err[:500], run_id))
        notify.notify_job(s, status, err, out)
    except Exception as e:  # noqa: BLE001
        with db.conn() as c:
            c.execute("UPDATE job_runs SET finished_at=?, status='failed', error=? WHERE id=?",
                      (time.time(), f"unhandled: {e}", run_id))


def _trigger_of(s: dict):
    trig = json.loads(s["trigger"])
    if trig.get("type") == "cron":
        from apscheduler.triggers.cron import CronTrigger
        kwargs = {}
        for k in ("minute", "hour", "day", "month", "day_of_week"):
            if trig.get(k) not in (None, ""):
                kwargs[k] = trig[k]
        return CronTrigger(**kwargs)
    from apscheduler.triggers.interval import IntervalTrigger
    return IntervalTrigger(minutes=max(1, int(trig.get("minutes", 60))))


def sync(schedule_id: str) -> None:
    """(Re)register one schedule with the running scheduler."""
    if _sched is None:
        return
    with db.conn() as c:
        r = c.execute("SELECT * FROM schedules WHERE id=?", (schedule_id,)).fetchone()
    if not r:
        with _lock:
            try:
                _sched.remove_job(schedule_id)
            except Exception:
                pass
        return
    with _lock:
        try:
            _sched.remove_job(schedule_id)
        except Exception:
            pass
        if not r["enabled"]:
            return
        _sched.add_job(execute, _trigger_of(dict(r)), args=[schedule_id], id=schedule_id,
                       misfire_grace_time=300, coalesce=True, max_instances=1)


def start() -> None:
    global _sched
    from apscheduler.schedulers.background import BackgroundScheduler
    _sched = BackgroundScheduler(timezone="Asia/Jakarta")
    _sched.start()
    with db.conn() as c:
        for r in c.execute("SELECT * FROM schedules"):
            sync(dict(r)["id"])


def shutdown() -> None:
    global _sched
    if _sched is not None:
        _sched.shutdown(wait=False)
        _sched = None