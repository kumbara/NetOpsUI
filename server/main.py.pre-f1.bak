"""NetOpsUI management service.

Owns what NetOps Agent and Hermes have no API for: the skill library, agent
profiles/prompts, and read-only views of each backend's config files. Hermes
chat goes browser → nginx → Hermes directly; NetOps Agent chat runs through
here (runs.py) so answers are saved even if the browser goes away.
"""
from __future__ import annotations

import json
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import auth
import backends as bk
import db
import llm
import runs


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    runs.init_runs()
    yield


app = FastAPI(title="NetOpsUI Manager", docs_url=None, redoc_url=None, lifespan=lifespan)
app.middleware("http")(auth.guard)
app.include_router(auth.router)


def _bad(msg: str, code: int = 400):
    raise HTTPException(code, msg)


def _backend(b: str) -> str:
    if b not in bk.BACKENDS:
        _bad(f"backend tidak dikenal: {b}", 404)
    return b


def _slug(s: str) -> str:
    if not bk.SLUG_RE.match(s):
        _bad("slug harus huruf kecil/angka/strip, maksimal 64 karakter")
    return s


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "backends": {b: bk.home(b).is_dir() for b in bk.BACKENDS}}


# ── read-only views of backend files ─────────────────────────────────────────

@app.get("/api/backends/{backend}/config")
def get_config(backend: str) -> dict:
    return bk.read_config(_backend(backend))


@app.get("/api/backends/{backend}/env")
def get_env(backend: str) -> dict:
    return bk.read_env_names(_backend(backend))


@app.get("/api/backends/{backend}/soul")
def get_soul(backend: str) -> dict:
    return bk.read_soul(_backend(backend))


@app.get("/api/backends/{backend}/disk-skills")
def get_disk_skills(backend: str) -> dict:
    _backend(backend)
    with db.conn() as c:
        managed = {r["path"] for r in c.execute("SELECT path FROM skill_publications WHERE backend=?", (backend,))}
    skills = bk.disk_skills(backend)
    for s in skills:
        s["managed"] = s["path"] in managed
    return {"skills": skills}


# ── skills ───────────────────────────────────────────────────────────────────

class SkillIn(BaseModel):
    slug: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    body: str = ""


def _status(backend: str, skill: dict, pub) -> str:
    if pub is None:
        return "draft"
    disk = bk.read_text(bk.skill_path(backend, skill["slug"]))
    if disk is None:
        return "missing"
    if bk.sha(disk) != pub["content_hash"]:
        return "disk_changed"
    return "in_sync" if bk.sha(bk.render_skill(backend, skill)) == pub["content_hash"] else "db_changed"


def _with_status(c, skill: dict) -> dict:
    pubs = {r["backend"]: r for r in c.execute("SELECT * FROM skill_publications WHERE slug=?", (skill["slug"],))}
    skill["publications"] = {b: {"status": _status(b, skill, pubs.get(b)),
                                 "published_at": pubs[b]["published_at"] if b in pubs else None}
                             for b in bk.BACKENDS}
    return skill


@app.get("/api/skills")
def list_skills() -> dict:
    with db.conn() as c:
        rows = [db.skill_row(r) for r in c.execute("SELECT * FROM skills ORDER BY slug")]
        return {"skills": [_with_status(c, s) for s in rows]}


@app.get("/api/skills/{slug}")
def get_skill(slug: str) -> dict:
    with db.conn() as c:
        r = c.execute("SELECT * FROM skills WHERE slug=?", (slug,)).fetchone()
        if not r:
            _bad("skill tidak ditemukan", 404)
        return _with_status(c, db.skill_row(r))


@app.post("/api/skills", status_code=201)
def create_skill(s: SkillIn) -> dict:
    _slug(s.slug)
    with db.conn() as c:
        if c.execute("SELECT 1 FROM skills WHERE slug=?", (s.slug,)).fetchone():
            _bad("slug sudah dipakai", 409)
        c.execute("INSERT INTO skills (slug, description, tags, body) VALUES (?,?,?,?)",
                  (s.slug, s.description, json.dumps(s.tags), s.body))
    return get_skill(s.slug)


@app.put("/api/skills/{slug}")
def update_skill(slug: str, s: SkillIn) -> dict:
    if s.slug != slug:
        _bad("slug tidak bisa diubah; buat skill baru")
    with db.conn() as c:
        cur = c.execute("UPDATE skills SET description=?, tags=?, body=?, updated_at=datetime('now') WHERE slug=?",
                        (s.description, json.dumps(s.tags), s.body, slug))
        if cur.rowcount == 0:
            _bad("skill tidak ditemukan", 404)
    return get_skill(slug)


@app.delete("/api/skills/{slug}")
def delete_skill(slug: str, unpublish: bool = False) -> dict:
    """Deletes the DB record. Files already published to a backend stay in
    place unless unpublish=true — an agent may be relying on them."""
    with db.conn() as c:
        pubs = list(c.execute("SELECT backend FROM skill_publications WHERE slug=?", (slug,)))
        if unpublish:
            for p in pubs:
                bk.remove_skill(p["backend"], slug)
        if c.execute("DELETE FROM skills WHERE slug=?", (slug,)).rowcount == 0:
            _bad("skill tidak ditemukan", 404)
    return {"deleted": slug, "unpublished": [p["backend"] for p in pubs] if unpublish else []}


class PublishIn(BaseModel):
    backend: str
    force: bool = False  # overwrite even if the file on disk was changed outside NetOpsUI


@app.post("/api/skills/{slug}/publish")
def publish_skill(slug: str, req: PublishIn) -> dict:
    backend = _backend(req.backend)
    with db.conn() as c:
        r = c.execute("SELECT * FROM skills WHERE slug=?", (slug,)).fetchone()
        if not r:
            _bad("skill tidak ditemukan", 404)
        skill = db.skill_row(r)
        if not skill["description"].strip() or not skill["body"].strip():
            _bad("deskripsi dan isi skill wajib diisi sebelum dipublish")
        pub = c.execute("SELECT * FROM skill_publications WHERE slug=? AND backend=?", (slug, backend)).fetchone()
        path = bk.skill_path(backend, slug)
        existing = bk.read_text(path)
        if existing is not None and not req.force and (pub is None or bk.sha(existing) != pub["content_hash"]):
            _bad("File skill dengan nama ini sudah ada di backend dan bukan hasil publish terakhir dari NetOpsUI "
                 "(diubah di luar atau milik backend). Kirim force=true untuk menimpa.", 409)
        text = bk.render_skill(backend, skill)
        bk.write_atomic(path, text)
        rel = str(path.relative_to(bk.skills_dir(backend)))
        c.execute("""INSERT INTO skill_publications (slug, backend, path, content_hash) VALUES (?,?,?,?)
                     ON CONFLICT(slug, backend) DO UPDATE SET path=excluded.path,
                     content_hash=excluded.content_hash, published_at=datetime('now')""",
                  (slug, backend, rel, bk.sha(text)))
    return get_skill(slug)


@app.post("/api/skills/{slug}/unpublish")
def unpublish_skill(slug: str, req: PublishIn) -> dict:
    backend = _backend(req.backend)
    with db.conn() as c:
        if not c.execute("SELECT 1 FROM skill_publications WHERE slug=? AND backend=?", (slug, backend)).fetchone():
            _bad("skill ini belum dipublish ke backend tersebut", 404)
        bk.remove_skill(backend, slug)
        c.execute("DELETE FROM skill_publications WHERE slug=? AND backend=?", (slug, backend))
    return get_skill(slug)


class ImportIn(BaseModel):
    backend: str
    path: str  # relative path from disk-skills


@app.post("/api/skills/import", status_code=201)
def import_skill(req: ImportIn) -> dict:
    """Copy a skill found on a backend's disk into the DB. Not marked as
    published: the backend keeps its own file until you publish over it."""
    backend = _backend(req.backend)
    try:
        d = bk.read_disk_skill(backend, req.path)
    except FileNotFoundError:
        _bad("file skill tidak ditemukan", 404)
    except ValueError as e:
        _bad(str(e))
    slug = re.sub(r"[^a-z0-9-]+", "-", d["slug"].lower()).strip("-")[:64]
    if not bk.SLUG_RE.match(slug):
        _bad("nama skill tidak bisa dijadikan slug yang valid")
    with db.conn() as c:
        if c.execute("SELECT 1 FROM skills WHERE slug=?", (slug,)).fetchone():
            _bad(f"slug '{slug}' sudah ada di NetOpsUI", 409)
        c.execute("INSERT INTO skills (slug, description, tags, body) VALUES (?,?,?,?)",
                  (slug, d["description"], json.dumps(d["tags"]), d["body"]))
    return get_skill(slug)


# ── agent profiles (prompts) ─────────────────────────────────────────────────

class ProfileIn(BaseModel):
    slug: str
    name: str
    description: str = ""
    prompt: str = ""


@app.get("/api/profiles")
def list_profiles() -> dict:
    with db.conn() as c:
        return {"profiles": [dict(r) for r in c.execute("SELECT * FROM profiles ORDER BY name")]}


@app.get("/api/profiles/{slug}")
def get_profile(slug: str) -> dict:
    with db.conn() as c:
        r = c.execute("SELECT * FROM profiles WHERE slug=?", (slug,)).fetchone()
    if not r:
        _bad("profil tidak ditemukan", 404)
    return dict(r)


@app.post("/api/profiles", status_code=201)
def create_profile(p: ProfileIn) -> dict:
    _slug(p.slug)
    if not p.name.strip():
        _bad("nama wajib diisi")
    with db.conn() as c:
        if c.execute("SELECT 1 FROM profiles WHERE slug=?", (p.slug,)).fetchone():
            _bad("slug sudah dipakai", 409)
        c.execute("INSERT INTO profiles (slug, name, description, prompt) VALUES (?,?,?,?)",
                  (p.slug, p.name.strip(), p.description, p.prompt))
    return get_profile(p.slug)


@app.put("/api/profiles/{slug}")
def update_profile(slug: str, p: ProfileIn) -> dict:
    if p.slug != slug:
        _bad("slug tidak bisa diubah; buat profil baru")
    with db.conn() as c:
        cur = c.execute("UPDATE profiles SET name=?, description=?, prompt=?, updated_at=datetime('now') WHERE slug=?",
                        (p.name.strip(), p.description, p.prompt, slug))
        if cur.rowcount == 0:
            _bad("profil tidak ditemukan", 404)
    return get_profile(slug)


@app.delete("/api/profiles/{slug}")
def delete_profile(slug: str) -> dict:
    with db.conn() as c:
        if c.execute("DELETE FROM profiles WHERE slug=?", (slug,)).rowcount == 0:
            _bad("profil tidak ditemukan", 404)
    return {"deleted": slug}


@app.post("/api/profiles/{slug}/apply-soul")
def apply_profile_to_soul(slug: str) -> dict:
    """Publish a profile's prompt as NetOps Agent's SOUL.md (its persona file). The
    previous SOUL.md is copied to DATA_DIR/backups first. Hermes profiles are
    applied per request as `instructions` by the browser instead."""
    prof = get_profile(slug)
    if not prof["prompt"].strip():
        _bad("prompt profil kosong")
    bk.write_soul("netops", prof["prompt"].strip() + "\n", db.DATA_DIR / "backups")
    return {"applied": slug, "backend": "netops", "path": "SOUL.md"}


# ── LLM providers ────────────────────────────────────────────────────────────
# Provider profiles live here (API key write-only: it is never returned).
# "Apply" writes a provider into a backend's config.yaml `model:` block.

class ProviderIn(BaseModel):
    slug: str
    name: str
    base_url: str
    model: str = ""
    api_key: str | None = None  # None = keep the stored key; "" = clear it


def _provider_public(r) -> dict:
    d = dict(r)
    d["has_key"] = bool(d.pop("api_key"))
    return d


def _provider(c, slug: str):
    r = c.execute("SELECT * FROM llm_providers WHERE slug=?", (slug,)).fetchone()
    if not r:
        _bad("provider tidak ditemukan", 404)
    return r


def _clean_url(url: str) -> str:
    try:
        return llm.check_url(url)
    except ValueError as e:
        _bad(str(e))


@app.get("/api/llm/providers")
def list_providers() -> dict:
    with db.conn() as c:
        return {"providers": [_provider_public(r) for r in c.execute("SELECT * FROM llm_providers ORDER BY name")]}


@app.post("/api/llm/providers", status_code=201)
def create_provider(p: ProviderIn) -> dict:
    _slug(p.slug)
    if not p.name.strip():
        _bad("nama wajib diisi")
    url = _clean_url(p.base_url)
    with db.conn() as c:
        if c.execute("SELECT 1 FROM llm_providers WHERE slug=?", (p.slug,)).fetchone():
            _bad("slug sudah dipakai", 409)
        c.execute("INSERT INTO llm_providers (slug, name, base_url, api_key, model) VALUES (?,?,?,?,?)",
                  (p.slug, p.name.strip(), url, p.api_key or None, p.model.strip()))
        return _provider_public(_provider(c, p.slug))


@app.put("/api/llm/providers/{slug}")
def update_provider(slug: str, p: ProviderIn) -> dict:
    if p.slug != slug:
        _bad("slug tidak bisa diubah; buat provider baru")
    if not p.name.strip():
        _bad("nama wajib diisi")
    url = _clean_url(p.base_url)
    with db.conn() as c:
        cur = _provider(c, slug)
        key = cur["api_key"] if p.api_key is None else (p.api_key or None)
        # A stored key must not silently follow the provider to a different host.
        if p.api_key is None and cur["api_key"] and url != cur["base_url"]:
            _bad("Base URL berubah: masukkan API key lagi (atau kosongkan untuk menghapusnya) "
                 "agar key lama tidak terkirim ke host baru")
        c.execute("UPDATE llm_providers SET name=?, base_url=?, api_key=?, model=?, updated_at=datetime('now') WHERE slug=?",
                  (p.name.strip(), url, key, p.model.strip(), slug))
        return _provider_public(_provider(c, slug))


@app.delete("/api/llm/providers/{slug}")
def delete_provider(slug: str) -> dict:
    with db.conn() as c:
        if c.execute("DELETE FROM llm_providers WHERE slug=?", (slug,)).rowcount == 0:
            _bad("provider tidak ditemukan", 404)
    return {"deleted": slug}


class TestIn(BaseModel):
    base_url: str
    api_key: str | None = None
    provider: str | None = None  # reuse this stored provider's key when api_key is blank


@app.post("/api/llm/test")
def test_provider(t: TestIn) -> dict:
    """Server-side connection check + model list, so the key never reaches the browser."""
    url = _clean_url(t.base_url)
    key = t.api_key or None
    if key is None and t.provider:
        with db.conn() as c:
            r = c.execute("SELECT base_url, api_key FROM llm_providers WHERE slug=?", (t.provider,)).fetchone()
        if r and r["base_url"] == url:  # only reuse the stored key for the URL it belongs to
            key = r["api_key"]
    return llm.list_models(url, key)


def _config_path(backend: str):
    return bk.home(backend) / "config.yaml"


@app.get("/api/backends/{backend}/llm")
def get_backend_llm(backend: str) -> dict:
    return llm.describe(_backend(backend), bk.read_text(_config_path(backend)))


class ApplyIn(BaseModel):
    provider: str
    model: str = ""
    include_delegation: bool = False  # NetOps Agent only: also update delegated agents' model blocks


@app.post("/api/backends/{backend}/llm/apply")
def apply_backend_llm(backend: str, req: ApplyIn) -> dict:
    """Write a provider into the backend's config.yaml (`model:` block only).
    The backend keeps running on its old settings until it is restarted."""
    _backend(backend)
    path = _config_path(backend)
    text = bk.read_text(path)
    if text is None:
        _bad("config.yaml backend tidak ditemukan", 404)
    if not os.access(path, os.W_OK):
        _bad("config.yaml backend read-only di container manager. Lihat README (mount config.yaml tanpa :ro).", 409)
    with db.conn() as c:
        prov = dict(_provider(c, req.provider))
    model = req.model.strip() or prov["model"]
    if not model:
        _bad("pilih model terlebih dulu")
    try:
        new_text = llm.plan_apply(backend, text, prov, model, req.include_delegation and backend == "netops")
    except llm.ConfigEditError as e:
        _bad(str(e), 422)
    backup_dir = db.DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / f"config.{backend}.{time.strftime('%Y%m%d-%H%M%S')}.yaml"
    backup.write_text(text, encoding="utf-8")
    os.chmod(backup, 0o600)  # contains whatever secrets the config held
    path.write_text(new_text, encoding="utf-8")  # in place: may be a single-file bind mount
    return {"applied": req.provider, "model": model, "backup": backup.name, "current": get_backend_llm(backend),
            "restart_required": True}


# ── backend credentials (stored here, never in environment variables) ────────
# Only Hermes needs one: its api_server requires a Bearer key. nginx asks
# /internal/hermes-auth (auth_request) for it on every proxied request, so the
# key never sits in a container environment and can be changed without a restart.

_CRED_NAME = {"hermes": "hermes_api_key"}
_KEY_RE = re.compile(r"[\x21-\x7e]{1,512}")  # printable ASCII, no spaces: also blocks header injection


def _cred_backend(backend: str) -> str:
    _backend(backend)
    if backend not in _CRED_NAME:
        _bad("Backend ini tidak memakai API key", 404)
    return backend


def _get_secret(name: str):
    with db.conn() as c:
        return c.execute("SELECT value, updated_at FROM secrets WHERE name=?", (name,)).fetchone()


def _valid_key(key: str) -> str:
    key = key.strip()
    if not _KEY_RE.fullmatch(key):
        _bad("API key hanya boleh berisi karakter ASCII yang tercetak, tanpa spasi (maks. 512)")
    return key


@app.get("/api/backends/{backend}/credential")
def get_credential(backend: str) -> dict:
    r = _get_secret(_CRED_NAME[_cred_backend(backend)])
    return {"has_key": bool(r), "updated_at": r["updated_at"] if r else None}


class CredentialIn(BaseModel):
    api_key: str


@app.put("/api/backends/{backend}/credential")
def set_credential(backend: str, c_in: CredentialIn) -> dict:
    name = _CRED_NAME[_cred_backend(backend)]
    key = _valid_key(c_in.api_key)
    with db.conn() as c:
        c.execute("""INSERT INTO secrets (name, value) VALUES (?, ?)
                     ON CONFLICT(name) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""", (name, key))
    return get_credential(backend)


@app.delete("/api/backends/{backend}/credential")
def delete_credential(backend: str) -> dict:
    name = _CRED_NAME[_cred_backend(backend)]
    with db.conn() as c:
        c.execute("DELETE FROM secrets WHERE name=?", (name,))
    return get_credential(backend)


class CredentialTestIn(BaseModel):
    api_key: str | None = None  # blank: test the stored key


@app.post("/api/backends/{backend}/credential/test")
def test_credential(backend: str, t: CredentialTestIn) -> dict:
    """Try a key (typed or stored) against the backend's authenticated /v1/models,
    server-side, so the key never reaches the browser."""
    name = _CRED_NAME[_cred_backend(backend)]
    key = _valid_key(t.api_key) if t.api_key else (_get_secret(name) or {"value": None})["value"]
    if not key:
        return {"ok": False, "error": "Belum ada API key untuk dites"}
    base = os.environ.get("HERMES_URL", "http://127.0.0.1:8642").rstrip("/")
    return llm.list_models(base + "/v1", key)


@app.get("/internal/hermes-auth")
def hermes_auth(request: Request) -> Response:
    """auth_request target for nginx (not under /api/, so not proxied to browsers).
    204 with a session cookie (nginx forwards the request's headers); the header is
    empty when no key is set, which makes nginx send no Authorization and lets
    Hermes answer 401 itself."""
    if auth.session_user(request) is None:
        return Response(status_code=401)
    r = _get_secret(_CRED_NAME["hermes"])
    return Response(status_code=204, headers={
        "X-Hermes-Authorization": f"Bearer {r['value']}" if r else "",
        "Cache-Control": "no-store"})


# ── chat threads (shared across every browser) ───────────────────────────────
# NetOps Agent's /chat is stateless, so threads used to live in each browser's
# localStorage and other operators' chats were invisible. They are stored here
# instead. `owner` is the client label the browser sends
# plus the address nginx saw (X-Real-IP), enough to tell operators apart.

_THREAD_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
_RUNNING_STALE_S = 3600  # a run flagged longer ago than this is assumed dead (tab closed mid-run)


class ThreadIn(BaseModel):
    id: str
    backend: str = "netops"
    title: str = "New Chat"
    client: str = ""


class ThreadPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    running: bool | None = None


class MessageIn(BaseModel):
    role: str
    content: str = Field(default="", max_length=200_000)


class ImportThread(BaseModel):
    id: str
    title: str = "New Chat"
    createdAt: float = 0   # epoch ms, as kept in localStorage
    updatedAt: float = 0
    messages: list[MessageIn] = []


class ThreadImportIn(BaseModel):
    backend: str = "netops"
    client: str = ""
    threads: list[ImportThread]


def _owner(req: Request, client: str) -> str:
    ip = req.headers.get("x-real-ip") or (req.client.host if req.client else "")
    label = re.sub(r"[^\w .@-]", "", client)[:40]
    return f"{label} ({ip})" if label and ip else label or ip


def _tid(tid: str) -> str:
    if not _THREAD_ID_RE.fullmatch(tid):
        _bad("id thread tidak valid")
    return tid


def _thread_public(r) -> dict:
    d = dict(r)
    since = d.pop("running_since")
    d["running"] = bool(since) and time.time() - _parse_ts(since) < _RUNNING_STALE_S
    return d


def _parse_ts(s: str) -> float:
    from datetime import datetime
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _iso(ms: float) -> str | None:
    from datetime import datetime, timezone
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _thread_or_404(c, tid: str):
    r = c.execute("SELECT * FROM chat_threads WHERE id=?", (tid,)).fetchone()
    if not r:
        _bad("thread tidak ditemukan", 404)
    return r


@app.get("/api/threads")
def list_threads(backend: str = "netops", limit: int = 200) -> dict:
    with db.conn() as c:
        rows = c.execute("SELECT * FROM chat_threads WHERE backend=? ORDER BY updated_at DESC LIMIT ?",
                         (backend, max(1, min(limit, 500)))).fetchall()
    return {"threads": [_thread_public(r) for r in rows]}


@app.post("/api/threads", status_code=201)
def create_thread(t: ThreadIn, request: Request) -> dict:
    _tid(t.id)
    with db.conn() as c:
        c.execute("INSERT OR IGNORE INTO chat_threads (id, backend, title, owner) VALUES (?,?,?,?)",
                  (t.id, t.backend, t.title[:200] or "New Chat", _owner(request, t.client)))
        return _thread_public(_thread_or_404(c, t.id))


@app.get("/api/threads/{tid}")
def get_thread(tid: str) -> dict:
    with db.conn() as c:
        return _thread_public(_thread_or_404(c, _tid(tid)))


@app.get("/api/threads/{tid}/messages")
def thread_messages(tid: str) -> dict:
    with db.conn() as c:
        _thread_or_404(c, _tid(tid))
        rows = c.execute("SELECT role, content, created_at FROM chat_messages WHERE thread_id=? ORDER BY id",
                         (tid,)).fetchall()
    return {"messages": [dict(r) for r in rows]}


@app.post("/api/threads/{tid}/messages", status_code=201)
def append_message(tid: str, m: MessageIn) -> dict:
    if m.role not in ("user", "agent"):
        _bad("role harus 'user' atau 'agent'")
    with db.conn() as c:
        t = _thread_or_404(c, _tid(tid))
        c.execute("INSERT INTO chat_messages (thread_id, role, content) VALUES (?,?,?)", (tid, m.role, m.content))
        title = t["title"]
        if m.role == "user" and title == "New Chat":
            title = m.content[:60] or title
        last = m.content[:120] if m.role == "user" else t["last_message"]
        c.execute("UPDATE chat_threads SET title=?, last_message=?, "
                  "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", (title, last, tid))
    return {"ok": True}


@app.patch("/api/threads/{tid}")
def patch_thread(tid: str, p: ThreadPatch) -> dict:
    with db.conn() as c:
        _thread_or_404(c, _tid(tid))
        if p.title is not None:
            c.execute("UPDATE chat_threads SET title=? WHERE id=?", (p.title.strip() or "New Chat", tid))
        if p.running is not None:
            c.execute("UPDATE chat_threads SET running_since=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') "
                      "ELSE NULL END, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
                      (1 if p.running else 0, tid))
        return _thread_public(_thread_or_404(c, tid))


@app.delete("/api/threads/{tid}")
def delete_thread(tid: str) -> dict:
    with db.conn() as c:
        c.execute("DELETE FROM chat_threads WHERE id=?", (_tid(tid),))
    return {"ok": True}


@app.post("/api/threads/import")
def import_threads(req: ThreadImportIn, request: Request) -> dict:
    """One-time move of a browser's localStorage threads to the server; ids
    already present are skipped, so re-running is harmless."""
    owner = _owner(request, req.client)
    n = 0
    with db.conn() as c:
        for t in req.threads:
            if not _THREAD_ID_RE.fullmatch(t.id) or c.execute(
                    "SELECT 1 FROM chat_threads WHERE id=?", (t.id,)).fetchone():
                continue
            msgs = [m for m in t.messages if m.role in ("user", "agent")]
            last = next((m.content for m in reversed(msgs) if m.role == "user"), "")[:120]
            created, updated = _iso(t.createdAt), _iso(t.updatedAt)
            c.execute("INSERT INTO chat_threads (id, backend, title, owner, last_message, created_at, updated_at) "
                      "VALUES (?,?,?,?,?,COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')),"
                      "COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
                      (t.id, req.backend, t.title[:200], owner, last, created, updated))
            c.executemany("INSERT INTO chat_messages (thread_id, role, content) VALUES (?,?,?)",
                          [(t.id, m.role, m.content) for m in msgs])
            n += 1
    return {"imported": n}


# ── chat runs: the manager calls NetOps Agent, browsers only watch ───────────

class RunIn(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


@app.post("/api/threads/{tid}/run", status_code=202)
def start_run(tid: str, req: RunIn) -> dict:
    with db.conn() as c:
        _thread_or_404(c, _tid(tid))
        if runs.is_active(tid):
            _bad("Thread ini sedang diproses; tunggu sampai selesai atau hentikan dulu", 409)
        prior = [{"role": "assistant" if r["role"] == "agent" else "user", "content": r["content"]}
                 for r in c.execute("SELECT role, content FROM chat_messages WHERE thread_id=? ORDER BY id", (tid,))
                 if r["content"]]
        c.execute("INSERT INTO chat_messages (thread_id, role, content) VALUES (?,?,?)", (tid, "user", req.text))
        t = _thread_or_404(c, tid)
        title = t["title"] if t["title"] != "New Chat" else (req.text[:60] or "New Chat")
        c.execute("UPDATE chat_threads SET title=?, last_message=?, "
                  "running_since=strftime('%Y-%m-%dT%H:%M:%fZ','now'), "
                  "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", (title, req.text[:120], tid))
    try:
        runs.start(tid, prior + [{"role": "user", "content": req.text}])
    except RuntimeError:
        _bad("Thread ini sedang diproses", 409)
    return {"started": True}


@app.get("/api/threads/{tid}/events")
def run_events(tid: str, after: int = 0) -> StreamingResponse:
    """SSE of the thread's run (delta / tool_end / error / stopped, then done).
    Replays from event `after`, so a refreshed page can re-attach to a live run."""
    return StreamingResponse(runs.stream(_tid(tid), after), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/threads/{tid}/stop")
def stop_run(tid: str) -> dict:
    return {"ok": runs.cancel(_tid(tid))}
