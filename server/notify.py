"""Notification channels (F2): webhook, Telegram bot, email (SMTP).

Channels are configured in the UI (Alerts screen) and stored in the
`notify_channels` table (secrets inside the config JSON). Every send is
logged to `notify_log` (kept at 500 rows). The scheduler calls notify_job()
after each run based on the schedule's notify_on setting.
"""
from __future__ import annotations

import json
import smtplib
import time
import urllib.request
from email.message import EmailMessage

import db

MAX_LOG = 500


def _log(channel: str, ok: bool, detail: str) -> None:
    try:
        with db.conn() as c:
            c.execute("INSERT INTO notify_log (channel, ok, detail, sent_at) VALUES (?,?,?,?)",
                      (channel[:100], int(ok), detail[:500], time.time()))
            c.execute("DELETE FROM notify_log WHERE id NOT IN (SELECT id FROM notify_log ORDER BY id DESC LIMIT ?)",
                      (MAX_LOG,))
    except Exception:
        pass


def _send_webhook(cfg: dict, title: str, body: str) -> str:
    req = urllib.request.Request(
        cfg["url"],
        json.dumps({"source": "netopsui", "title": title, "body": body}).encode(),
        {"Content-Type": "application/json"})
    if cfg.get("secret"):
        req.add_header("X-NetOpsUI-Signature", cfg["secret"])
    with urllib.request.urlopen(req, timeout=15) as resp:
        code = resp.status
    if code >= 300:
        raise RuntimeError(f"webhook HTTP {code}")
    return f"HTTP {code}"


def _send_telegram(cfg: dict, title: str, body: str) -> str:
    url = f"https://api.telegram.org/bot{cfg['token']}/sendMessage"
    payload = json.dumps({"chat_id": cfg["chat_id"], "text": f"*{title}*\n\n{body}",
                          "parse_mode": "Markdown", "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(url, payload, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        r = json.loads(resp.read())
    if not r.get("ok"):
        raise RuntimeError(f"telegram: {r.get('description')}")
    return "ok"


def _send_email(cfg: dict, title: str, body: str) -> str:
    msg = EmailMessage()
    msg["From"] = cfg.get("from") or cfg["user"]
    msg["To"] = cfg["to"]
    msg["Subject"] = title
    msg.set_content(body)
    with smtplib.SMTP(cfg["host"], int(cfg.get("port", 587)), timeout=15) as s:
        s.starttls()
        s.login(cfg["user"], cfg["password"])
        s.send_message(msg)
    return "sent"


def send(channel_id: str, title: str, body: str) -> tuple[bool, str]:
    """Send through one channel. Returns (ok, detail). Never raises."""
    with db.conn() as c:
        r = c.execute("SELECT * FROM notify_channels WHERE id=? AND enabled=1", (channel_id,)).fetchone()
    if not r:
        return False, "channel tidak aktif"
    try:
        cfg = json.loads(r["config"])
        if r["type"] == "webhook":
            detail = _send_webhook(cfg, title, body)
        elif r["type"] == "telegram":
            detail = _send_telegram(cfg, title, body)
        elif r["type"] == "email":
            detail = _send_email(cfg, title, body)
        else:
            return False, f"tipe tidak dikenal: {r['type']}"
        _log(r["name"], True, detail)
        return True, detail
    except Exception as e:  # noqa: BLE001
        _log(r["name"], False, str(e))
        return False, str(e)


def notify_job(schedule: dict, run_status: str, error: str = "", output: str = "") -> None:
    """Scheduler hook: fan out to all enabled channels per notify_on policy."""
    policy = schedule.get("notify_on", "failure")
    if policy == "always" or (policy == "failure" and run_status != "success") or \
       (policy == "success" and run_status == "success"):
        title = f"[NetOpsUI] {schedule['name']}: {'BERHASIL' if run_status == 'success' else 'GAGAL'}"
        body = (error or (output[:800] if output else "(tanpa output)"))
        with db.conn() as c:
            chans = c.execute("SELECT id FROM notify_channels WHERE enabled=1").fetchall()
        for ch in chans:
            send(ch["id"], title, body)


def test_channel(channel_id: str) -> tuple[bool, str]:
    return send(channel_id, "[NetOpsUI] Test", "Notifikasi berhasil dikirim dari NetOpsUI.")