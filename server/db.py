"""SQLite store: source of truth for skills and agent profiles managed in NetOpsUI."""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data/netopsui"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS skills (
  slug        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  body        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS skill_publications (
  slug         TEXT NOT NULL REFERENCES skills(slug) ON DELETE CASCADE,
  backend      TEXT NOT NULL,
  path         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (slug, backend)
);
CREATE TABLE IF NOT EXISTS llm_providers (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_key     TEXT,
  model       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS secrets (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_threads (
  id           TEXT PRIMARY KEY,
  backend      TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT 'New Chat',
  owner        TEXT NOT NULL DEFAULT '',
  last_message TEXT NOT NULL DEFAULT '',
  running_since TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id);
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS notify_channels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notify_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  sent_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS schedules (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  trigger    TEXT NOT NULL,
  backend    TEXT NOT NULL DEFAULT 'netops',
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_runs (
  id            TEXT PRIMARY KEY,
  schedule_id   TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  started_at    REAL NOT NULL,
  finished_at   REAL,
  status        TEXT NOT NULL DEFAULT 'running',
  output        TEXT NOT NULL DEFAULT '',
  file          TEXT NOT NULL DEFAULT '',
  error         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_job_runs_sched ON job_runs(schedule_id, started_at DESC);
CREATE TABLE IF NOT EXISTS profiles (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def db_path() -> Path:
    return DATA_DIR / "netopsui.db"


@contextmanager
def conn():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db_path(), timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init() -> None:
    with conn() as c:
        c.executescript(SCHEMA)
        # The backend was called 'palapa' before the rename to NetOps Agent.
        c.execute("UPDATE OR IGNORE skill_publications SET backend='netops' WHERE backend='palapa'")
    try:
        os.chmod(db_path(), 0o600)  # holds provider API keys and password hashes
    except OSError:
        pass


def skill_row(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["tags"] = json.loads(d["tags"])
    return d
