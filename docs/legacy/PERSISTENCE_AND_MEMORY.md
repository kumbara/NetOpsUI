# Persistence & Memory: Menyimpan Agent State ke Database

**Konteks:** Dokumen ini membahas bagaimana LangGraph mengelola state percakapan,
perbedaan antara checkpointing dan memory jangka panjang, serta cara menyimpannya ke database.

**Referensi kode project:**
- `agent.py` — `NetworkOpsState`, `_checkpointer = MemorySaver()`, `create_agent(thread_id)`
- `agents/graph.py` — `build_graph(checkpointer)`

**Status per kode:**
- ✅ Sudah diimplementasikan di project ini
- 🔧 Implementasi yang diusulkan (belum ada di kode)
- 💡 Konsep untuk eksplorasi lebih lanjut

---

## Daftar Isi

1. [Masalah: Data Hilang Saat Restart](#1-masalah-data-hilang-saat-restart)
2. [Apa Itu Checkpointer?](#2-apa-itu-checkpointer)
3. [Thread ID — Unit Percakapan](#3-thread-id--unit-percakapan)
4. [Tiga Checkpointer yang Tersedia](#4-tiga-checkpointer-yang-tersedia)
5. [Migrasi ke SQLite — Upgrade Paling Mudah](#5-migrasi-ke-sqlite--upgrade-paling-mudah)
6. [Migrasi ke PostgreSQL — Production-Ready](#6-migrasi-ke-postgresql--production-ready)
7. [State History & Time-Travel Debugging](#7-state-history--time-travel-debugging)
8. [Memory vs Checkpointing — Dua Konsep Berbeda](#8-memory-vs-checkpointing--dua-konsep-berbeda)
9. [Long-Term Memory Lintas Percakapan](#9-long-term-memory-lintas-percakapan)
10. [Ringkasan & Rekomendasi](#10-ringkasan--rekomendasi)

---

## 1. Masalah: Data Hilang Saat Restart

### Kondisi Saat Ini ✅

```python
# agent.py — baris 75
_checkpointer = MemorySaver()
```

`MemorySaver` menyimpan state **hanya di RAM**. Begitu proses Python mati (restart TUI, crash,
update kode), semua percakapan hilang.

### Konsekuensinya

```
Sesi 1 (TUI berjalan):
  Operator: "cek jaringan kampus"
  eko: "DTI unreachable, FIB-GW CPU 87%"
  Operator: "diagnosa DTI lebih dalam"
  agus: "interface flap, kemungkinan SFP rusak"
  [TUI ditutup]

Sesi 2 (TUI dibuka lagi):
  Operator: "tadi eko sudah cek, lanjutkan diagnosa joko"
  bambang: ???  ← tidak tahu apa yang "tadi" terjadi, konteks hilang
```

### Apa yang Mau Kita Capai

```
Sesi 1 → state tersimpan ke database
Sesi 2 → state di-load dari database → konteks tetap ada
Sesi N → bisa query riwayat percakapan, replay, audit
```

---

## 2. Apa Itu Checkpointer?

### Cara Kerja

Checkpointer adalah **komponen yang mengabadikan snapshot state pada setiap langkah graph**.
Bukan hanya state akhir — tapi state di setiap titik: sebelum supervisor, setelah eko, setelah agus, dst.

```
Satu percakapan = satu thread_id
Satu langkah graph = satu checkpoint

Timeline checkpoint untuk "cek DTI":

  checkpoint-1: {messages: [HumanMessage("cek DTI")], next_agent: "", ...}
                              ↓ supervisor berjalan
  checkpoint-2: {messages: [HumanMessage(...)], next_agent: "monitor_agent", ...}
                              ↓ eko berjalan
  checkpoint-3: {messages: [Human(...), AI("DTI unreachable")], next_agent: "supervisor", ...}
                              ↓ supervisor lagi
  checkpoint-4: {messages: [..., AI("...")] , next_agent: "END", ...}
```

Setiap checkpoint disimpan dengan:
- `thread_id` — identifier percakapan
- `checkpoint_id` — identifier snapshot ini
- `ts` — timestamp
- `channel_values` — isi state (semua field NetworkOpsState)
- `channel_versions` — versi per field (untuk merging)
- `parent_checkpoint_id` — pointer ke checkpoint sebelumnya

### Apa yang TIDAK Dilakukan Checkpointer

Checkpointer adalah **rekaman state percakapan aktif**, bukan memory jangka panjang.

| Checkpointer | Memory Jangka Panjang |
|---|---|
| State percakapan yang sedang berjalan | Fakta yang perlu diingat lintas percakapan |
| Otomatis tersimpan di setiap langkah | Harus eksplisit ditulis/dibaca |
| Diakses lewat `thread_id` | Diakses lewat query semantik / key |
| Contoh: messages, agent_log, next_agent | Contoh: "DTI pernah down 3x bulan ini" |

---

## 3. Thread ID — Unit Percakapan

### Apa Itu Thread ID?

Thread ID adalah **identifier yang mengkelompokkan semua checkpoint satu percakapan**.
Setiap graph execution harus dikaitkan ke satu thread.

```python
# agent.py — create_agent
def create_agent(thread_id: str) -> tuple[Any, RunnableConfig]:
    config: RunnableConfig = {
        "configurable": {"thread_id": thread_id},
    }
    return graph, config
```

LangGraph menyimpan dan me-load state menggunakan `thread_id` ini.
Jika `thread_id` yang sama dipakai lagi, LangGraph otomatis melanjutkan dari state terakhir.

### Eksperimen: Lihat Efek Thread ID

```python
# Percakapan 1 — thread "sesi-001"
graph, config = create_agent("sesi-001")
list(stream_agent_response(graph, config, "cek jaringan kampus"))
# ... eko bekerja, state tersimpan dengan thread_id="sesi-001"

# Percakapan 2 — thread BERBEDA — konteks hilang
graph, config = create_agent("sesi-999")
list(stream_agent_response(graph, config, "tindak lanjut dari tadi"))
# bambang tidak tahu "tadi" — thread berbeda = state kosong

# Percakapan 3 — thread SAMA "sesi-001" — konteks DILANJUTKAN
graph, config = create_agent("sesi-001")
list(stream_agent_response(graph, config, "diagnosa lebih dalam DTI"))
# bambang tahu bahwa sebelumnya eko sudah temukan DTI unreachable
```

### Strategi Thread ID di Project Ini ✅

```python
# tui.py — thread_id dibuat saat sesi dimulai
# Saat ini: kemungkinan pakai "default" atau timestamp

# Strategi yang lebih baik 🔧:
import uuid
from datetime import datetime

# Opsi A: satu thread per sesi TUI (konteks fresh tiap buka TUI)
thread_id = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

# Opsi B: thread persisten per operator (konteks tetap ada lintas restart)
thread_id = f"operator-{operator_username}"

# Opsi C: thread per topik/insiden (setiap insiden punya riwayatnya sendiri)
thread_id = f"incident-{incident_id}"
```

---

## 4. Tiga Checkpointer yang Tersedia

### Perbandingan

| Checkpointer | Penyimpanan | Cocok Untuk | Konfigurasi |
|---|---|---|---|
| `MemorySaver` | RAM | Development, testing | Tidak perlu |
| `SqliteSaver` | File `.sqlite` | Single-node, lokal | Path file |
| `PostgresSaver` | PostgreSQL | Multi-node, produksi | Connection string |

### Diagram: Arsitektur Penyimpanan

```
SEKARANG (MemorySaver):
  ┌─────────────────────┐
  │    Python Process   │
  │  ┌───────────────┐  │
  │  │  RAM          │  │
  │  │  thread-001:  │  │   ← hilang saat proses mati
  │  │   checkpoint  │  │
  │  │   checkpoint  │  │
  │  └───────────────┘  │
  └─────────────────────┘

DENGAN SqliteSaver:
  ┌─────────────────────┐     ┌──────────────────┐
  │    Python Process   │────►│  checkpoints.db  │  ← file di disk
  └─────────────────────┘     │  (SQLite)        │     tetap ada setelah restart
                               └──────────────────┘

DENGAN PostgresSaver:
  ┌─────────────────────┐     ┌──────────────────┐
  │  TUI (node 1)       │────►│                  │
  └─────────────────────┘     │   PostgreSQL     │  ← bisa diakses dari
  ┌─────────────────────┐     │   (server)       │    banyak proses
  │  API server (node 2)│────►│                  │
  └─────────────────────┘     └──────────────────┘
```

---

## 5. Migrasi ke SQLite — Upgrade Paling Mudah

### Instalasi

```bash
pip install langgraph-checkpoint-sqlite
```

### Perubahan Kode — Hanya 3 Baris di `agent.py`

```python
# SEBELUM
from langgraph.checkpoint.memory import MemorySaver
_checkpointer = MemorySaver()

# SESUDAH
from langgraph_checkpoint_sqlite import SqliteSaver
_checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
```

Seluruh kode lainnya — `create_agent()`, `stream_agent_response()`, `reset_agent()`,
`submit_approval()` — **tidak perlu diubah sama sekali**. Interface checkpointer identik.

### Implementasi Lengkap di `agent.py` 🔧

```python
# agent.py — versi dengan SQLite

import os
from pathlib import Path
from langgraph_checkpoint_sqlite import SqliteSaver

# Lokasi database — di root project
_DB_PATH = str(Path(__file__).parent / "data" / "checkpoints.db")

# Buat direktori jika belum ada
Path(_DB_PATH).parent.mkdir(parents=True, exist_ok=True)

# SqliteSaver.from_conn_string() menangani pembuatan tabel secara otomatis
_checkpointer = SqliteSaver.from_conn_string(_DB_PATH)
```

### Struktur Tabel di SQLite

SqliteSaver membuat dua tabel secara otomatis:

```sql
-- Tabel utama: satu baris per checkpoint
CREATE TABLE checkpoints (
    thread_id    TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type         TEXT,
    checkpoint   BLOB,    -- state di-serialize (JSON/pickle)
    metadata     BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- Tabel channel values (untuk field yang besar seperti messages)
CREATE TABLE checkpoint_blobs (
    thread_id    TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel      TEXT NOT NULL,
    version      TEXT NOT NULL,
    type         TEXT NOT NULL,
    blob         BLOB,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);
```

### Cara Inspeksi Database (CLI)

```bash
# Lihat semua thread yang pernah ada
sqlite3 data/checkpoints.db "
  SELECT DISTINCT thread_id, COUNT(*) as steps, MAX(rowid) as latest
  FROM checkpoints
  GROUP BY thread_id
  ORDER BY latest DESC;
"

# Lihat checkpoint terbaru dari sebuah thread
sqlite3 data/checkpoints.db "
  SELECT checkpoint_id, metadata
  FROM checkpoints
  WHERE thread_id = 'sesi-001'
  ORDER BY rowid DESC
  LIMIT 5;
"
```

---

## 6. Migrasi ke PostgreSQL — Production-Ready

### Kapan Perlu PostgreSQL?

| Kebutuhan | SQLite | PostgreSQL |
|---|---|---|
| Single user (satu TUI) | ✅ Cukup | Overkill |
| Multi user (banyak operator) | ⚠️ Write lock bisa jadi masalah | ✅ |
| Data besar (ribuan percakapan) | ⚠️ Lambat untuk query kompleks | ✅ |
| Backup otomatis & HA | ❌ Manual | ✅ Native |
| Query riwayat yang fleksibel | ❌ Terbatas | ✅ Full SQL |
| Integrasi dashboard monitoring | ❌ | ✅ |

### Instalasi

```bash
pip install langgraph-checkpoint-postgres psycopg
```

### Perubahan Kode

```python
# agent.py — versi PostgreSQL
from langgraph_checkpoint_postgres import PostgresSaver

_DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://netops:password@localhost:5432/netops_db"
)

# Setup sekali: buat tabel jika belum ada
with PostgresSaver.from_conn_string(_DB_URL) as checkpointer:
    checkpointer.setup()

_checkpointer = PostgresSaver.from_conn_string(_DB_URL)
```

### Setup Database (sekali saja)

```sql
-- Buat database dan user
CREATE DATABASE netops_db;
CREATE USER netops WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE netops_db TO netops;

-- PostgresSaver.setup() akan membuat tabel ini secara otomatis:
-- checkpoints, checkpoint_blobs, checkpoint_migrations, checkpoint_writes
```

### Skema PostgreSQL (disederhanakan)

```sql
-- Lebih kaya dari SQLite — ada index untuk query cepat
CREATE TABLE checkpoints (
    thread_id            TEXT NOT NULL,
    checkpoint_ns        TEXT NOT NULL DEFAULT '',
    checkpoint_id        UUID NOT NULL,
    parent_checkpoint_id UUID,
    type                 TEXT,
    checkpoint           JSONB,   -- ← JSONB, bisa di-query!
    metadata             JSONB,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- Index untuk query by thread
CREATE INDEX idx_checkpoints_thread ON checkpoints(thread_id);
CREATE INDEX idx_checkpoints_ts ON checkpoints((checkpoint->>'ts'));
```

### Query Riwayat yang Powerful (PostgreSQL)

```sql
-- Berapa banyak percakapan per hari?
SELECT
    DATE(checkpoint->>'ts') as tanggal,
    COUNT(DISTINCT thread_id) as jumlah_percakapan
FROM checkpoints
GROUP BY tanggal
ORDER BY tanggal DESC;

-- Thread mana yang paling panjang (banyak langkah)?
SELECT
    thread_id,
    COUNT(*) as jumlah_checkpoint
FROM checkpoints
GROUP BY thread_id
ORDER BY jumlah_checkpoint DESC
LIMIT 10;

-- Cari thread yang melibatkan security_agent
SELECT DISTINCT thread_id
FROM checkpoints
WHERE checkpoint->'channel_values'->>'active_agent' = 'security_agent';
```

---

## 7. State History & Time-Travel Debugging

### Fitur Bawaan LangGraph: `get_state_history()`

Dengan database checkpointer, kita bisa melihat **semua state dari satu thread**,
langkah per langkah — bukan hanya state terbaru.

```python
# Lihat riwayat lengkap sebuah percakapan
graph, config = create_agent("sesi-001")

for state_snapshot in graph.get_state_history(config):
    print(f"Checkpoint: {state_snapshot.config['configurable']['checkpoint_id']}")
    print(f"Agent aktif: {state_snapshot.values.get('active_agent')}")
    print(f"Jumlah messages: {len(state_snapshot.values.get('messages', []))}")
    print(f"Next agent: {state_snapshot.values.get('next_agent')}")
    print()
```

Output contoh:
```
Checkpoint: 1ef7d...  
Agent aktif: document_agent
Jumlah messages: 6
Next agent: supervisor

Checkpoint: 1ef7c...
Agent aktif: security_agent
Jumlah messages: 5
Next agent: document_agent

Checkpoint: 1ef7b...
Agent aktif: monitor_agent
Jumlah messages: 2
Next agent: supervisor
```

### Time-Travel: Fork dari Titik Tertentu

```python
# Skenario: eko sudah cek, agus sudah diagnosa, tapi hasilnya kurang
# Kita ingin "replay" dari setelah eko selesai dengan instruksi berbeda

# 1. Ambil semua history
history = list(graph.get_state_history(config))

# 2. Temukan checkpoint setelah eko selesai
checkpoint_after_eko = next(
    s for s in history
    if s.values.get("active_agent") == "monitor_agent"
)

# 3. Fork dari checkpoint itu
fork_config = graph.update_state(
    checkpoint_after_eko.config,
    {"messages": [HumanMessage("fokus diagnosa FIB-GW dulu, abaikan DTI")]}
)

# 4. Lanjutkan dari titik itu — history yang tersimpan tidak terhapus
for event in graph.stream(None, fork_config, stream_mode="values"):
    print(event)
```

### Replay untuk Debugging

```python
# Cari titik di mana bambang salah routing
for snapshot in graph.get_state_history(config):
    next_agent = snapshot.values.get("next_agent")
    active = snapshot.values.get("active_agent")

    if active == "supervisor" and next_agent == "monitor_agent":
        # Lihat input yang menyebabkan keputusan ini
        messages = snapshot.values.get("messages", [])
        last_msg = messages[-1].content if messages else ""
        print(f"Bambang routing ke monitor karena: '{last_msg[:100]}'")
```

---

## 8. Memory vs Checkpointing — Dua Konsep Berbeda

### Analogi Lengkap

```
Checkpointer = Rekaman percakapan (seperti log chat)
  → Menyimpan SEMUA yang terjadi dalam percakapan ini
  → Otomatis diisi oleh LangGraph
  → Diakses dengan thread_id
  → Terhapus / tidak relevan di percakapan lain

Long-term Memory = Catatan pengetahuan (seperti buku catatan operator)
  → Fakta penting yang perlu diingat di percakapan MANAPUN
  → Harus eksplisit ditulis dan dibaca
  → Diakses dengan query (semantic search / key lookup)
  → Relevan di thread manapun
```

### Contoh Konkret di Project NetOps

```
CHECKPOINTER menyimpan:
  "Dalam percakapan sesi-001:
    - Operator tanya soal jaringan kampus
    - Eko cek → DTI unreachable
    - Agus diagnosa → interface flap
    - Operator minta laporan"

LONG-TERM MEMORY menyimpan:
  "Fakta tentang jaringan kampus:
    - DTI sering down (3x dalam sebulan)
    - FIB-GW CPU sering tinggi saat jam 09:00-10:00
    - Router REKTORAT DHCP pool hampir penuh setiap bulan
    - Password default masih ada di 3 router"
```

### Kapan Butuh Masing-masing?

| Kebutuhan | Solusi |
|---|---|
| Ingat konteks percakapan yang sedang berjalan | Checkpointer ✅ (sudah ada) |
| Lanjutkan percakapan setelah restart | Database Checkpointer 🔧 |
| Ingat fakta tentang jaringan lintas percakapan | Long-term Memory 🔧 |
| Audit: "apa yang dilakukan eko 2 hari lalu?" | Checkpointer + history query 🔧 |
| Pengetahuan kumulatif dari semua monitoring | Long-term Memory 🔧 |

---

## 9. Long-Term Memory Lintas Percakapan

### Pendekatan 1: State Field `memory_store` (Sederhana) 🔧

Cara paling mudah: tambah field ke state, simpan sebagai JSON di database tersendiri.

```python
# model/memory.py — tabel sederhana
import sqlite3
from pathlib import Path

_MEM_DB = Path(__file__).parent.parent / "data" / "memory.db"
_MEM_DB.parent.mkdir(parents=True, exist_ok=True)

def _init():
    with sqlite3.connect(_MEM_DB) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS facts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                category  TEXT NOT NULL,     -- "router", "dhcp", "security", "incident"
                subject   TEXT NOT NULL,     -- "DTI", "FIB-GW", ...
                fact      TEXT NOT NULL,     -- "sering down, interface flap ether1"
                confidence REAL DEFAULT 1.0, -- 0.0-1.0
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()

_init()


def save_fact(category: str, subject: str, fact: str, confidence: float = 1.0):
    with sqlite3.connect(_MEM_DB) as conn:
        # Cek apakah sudah ada fact yang sama
        existing = conn.execute(
            "SELECT id FROM facts WHERE category=? AND subject=? AND fact=?",
            (category, subject, fact)
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO facts (category, subject, fact, confidence) VALUES (?,?,?,?)",
                (category, subject, fact, confidence)
            )
        conn.commit()


def get_facts(subject: str = None, category: str = None) -> list[dict]:
    query = "SELECT category, subject, fact, confidence FROM facts WHERE 1=1"
    params = []
    if subject:
        query += " AND subject = ?"
        params.append(subject)
    if category:
        query += " AND category = ?"
        params.append(category)
    query += " ORDER BY confidence DESC, updated_at DESC LIMIT 20"

    with sqlite3.connect(_MEM_DB) as conn:
        rows = conn.execute(query, params).fetchall()
    return [{"category": r[0], "subject": r[1], "fact": r[2], "confidence": r[3]}
            for r in rows]
```

```python
# Penggunaan di agents/nodes.py — supervisor inject memory ke context
from model.memory import get_facts

def supervisor_node(state):
    # Inject memory relevan ke prompt
    router_facts = get_facts(category="router")
    memory_ctx = "\n".join(f"  [{f['subject']}] {f['fact']}" for f in router_facts)

    sys_content = SUPERVISOR_SYSTEM_PROMPT.format(
        skill_list=skill_list,
        memory_context=memory_ctx,   # ← inject ke prompt
    )
    ...
```

```python
# Setelah eko selesai — simpan temuan ke memory
# agents/nodes.py — di dalam specialist node
from model.memory import save_fact

def _extract_and_save_facts(agent_name: str, content: str):
    """Parse hasil agent dan simpan fakta penting ke memory."""
    # Versi sederhana: agent LLM yang khusus ekstrak fakta
    # Versi minimal: regex / keyword matching
    if "unreachable" in content.lower():
        import re
        routers = re.findall(r'\b(DTI|FIB-GW|REKTORAT|FIB-LAB)\b', content)
        for r in routers:
            if "unreachable" in content.lower():
                save_fact("router", r, "pernah unreachable", confidence=0.9)
```

### Pendekatan 2: LangGraph Store (Native) 💡

LangGraph menyediakan `InMemoryStore` dan `AsyncPostgresStore` — abstraksi resmi
untuk long-term memory yang terpisah dari checkpointer.

```python
from langgraph.store.memory import InMemoryStore
from langgraph.store.postgres import AsyncPostgresStore

# Store terpisah dari checkpointer
store = InMemoryStore()  # atau AsyncPostgresStore

# Graph dikompilasi dengan store + checkpointer
graph = builder.compile(checkpointer=checkpointer, store=store)
```

```python
# Di dalam node — akses store via parameter khusus
def monitor_node(state, *, store):  # ← store diinjeksi otomatis
    # Baca memory
    memories = store.search(("router", "DTI"), query="status")

    # Tulis memory baru
    store.put(
        ("router", "DTI"),      # namespace: (category, subject)
        "latest_status",        # key
        {"status": "unreachable", "ts": "2026-05-02T14:30:00"}  # value
    )
```

```python
# Struktur namespace yang direkomendasikan untuk project ini:
# ("router", "{router_name}")    → fakta per router
# ("dhcp",   "{pool_name}")      → fakta per DHCP pool
# ("security", "summary")        → ringkasan temuan keamanan
# ("incident", "{incident_id}")  → riwayat insiden
```

### Pendekatan 3: Dedicated Memory Node 🔧

Tambah node khusus yang bertugas membaca dan menulis memory.

```python
# agents/nodes.py — memory_node

def memory_write_node(state: "NetworkOpsState", *, store) -> dict:
    """
    Dijalankan setelah setiap specialist — ekstrak dan simpan fakta penting.
    """
    last_msg = state["messages"][-1] if state["messages"] else None
    if not last_msg or not hasattr(last_msg, "content"):
        return {}

    active = state.get("active_agent", "")
    content = last_msg.content

    # LLM kecil untuk ekstrak fakta
    extractor_llm = _make_llm(temperature=0.0, json_mode=True)
    prompt = f"""
    Dari respons {active} berikut, ekstrak fakta-fakta penting tentang kondisi jaringan.
    Hanya fakta yang relevan untuk monitoring jangka panjang (bukan ephemeral).
    
    Respons agent:
    {content[:2000]}
    
    Balas dengan JSON:
    {{"facts": [{{"category": "router|dhcp|security", "subject": "nama_entitas", "fact": "deskripsi fakta"}}]}}
    """
    result = json.loads(extractor_llm.invoke(prompt).content)

    for f in result.get("facts", []):
        store.put(
            (f["category"], f["subject"]),
            f"fact_{int(datetime.now().timestamp())}",
            {"fact": f["fact"], "source": active}
        )

    return {}  # tidak mengubah state percakapan
```

```python
# agents/graph.py — tambah memory node setelah setiap specialist
builder.add_node("memory_writer", memory_write_node)

# Setelah eko → tulis memory → kembali ke supervisor
builder.add_edge("monitor_agent",  "memory_writer")
builder.add_edge("diagnose_agent", "memory_writer")
builder.add_edge("security_agent", "memory_writer")
builder.add_edge("memory_writer",  "supervisor")
```

---

## 10. Ringkasan & Rekomendasi

### Perubahan Bertahap

```
Tahap 1 — Persistence (sudah ada kodnya, 3 baris):
  MemorySaver → SqliteSaver
  Manfaat: percakapan tidak hilang saat restart
  Usaha: sangat rendah

Tahap 2 — Thread Management:
  Tentukan strategi thread_id yang konsisten
  Manfaat: bisa resume percakapan, riwayat per operator/insiden
  Usaha: rendah

Tahap 3 — History Querying:
  Tambah fungsi get_conversation_history() di agent.py
  Manfaat: audit, debugging, laporan aktivitas
  Usaha: rendah

Tahap 4 — Long-term Memory:
  Simpan fakta penting ke tabel terpisah
  Manfaat: bambang punya konteks historis jaringan
  Usaha: menengah

Tahap 5 — Memory Node:
  LLM kecil ekstrak fakta otomatis setelah setiap agent
  Manfaat: knowledge base jaringan terakumulasi otomatis
  Usaha: menengah-tinggi
```

### Peta Keputusan: Mau Simpan Apa?

```
Mau simpan percakapan agar tidak hilang saat restart?
  → Ganti MemorySaver ke SqliteSaver (Tahap 1)

Mau bisa resume percakapan yang terinterupsi?
  → Konsisten pakai thread_id yang persisten (Tahap 2)

Mau audit: "apa yang dilakukan agent kemarin jam 14:00?"
  → Pakai get_state_history() dari checkpointer (Tahap 3)

Mau agent punya "ingatan" tentang kondisi jaringan?
  → Tambah long-term memory store (Tahap 4-5)

Mau multi-user atau scale ke banyak instance?
  → Upgrade ke PostgresSaver (ganti SqliteSaver)
```

### Gambaran Arsitektur Lengkap (Target Jangka Panjang)

```
┌─────────────────────────────────────────────────────────────┐
│  TUI / API                                                  │
│    create_agent(thread_id)                                  │
│    stream_agent_response(...)                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│  LangGraph Graph                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Nodes: supervisor, monitor, diagnose, config,       │  │
│  │         security, document, memory_writer            │  │
│  └──────────────────────────────────────────────────────┘  │
│         │ setiap langkah              │ setelah specialist  │
│         ▼                             ▼                     │
│  ┌────────────────┐           ┌──────────────────┐         │
│  │  CHECKPOINTER  │           │  MEMORY STORE    │         │
│  │  SqliteSaver   │           │  sqlite/postgres  │         │
│  │                │           │                  │         │
│  │  data/         │           │  data/           │         │
│  │  checkpoints.db│           │  memory.db       │         │
│  │                │           │                  │         │
│  │  Menyimpan:    │           │  Menyimpan:      │         │
│  │  • messages    │           │  • router facts  │         │
│  │  • agent_log   │           │  • dhcp facts    │         │
│  │  • state tiap  │           │  • security      │         │
│  │    langkah     │           │    findings      │         │
│  └────────────────┘           └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

---

## Referensi Kode di Project Ini

| Konsep | File | Yang Perlu Diubah |
|---|---|---|
| Ganti ke SqliteSaver | `agent.py` | baris 13 + 75 |
| Strategi thread_id | `tui.py` | tempat `create_agent()` dipanggil |
| Lihat history | `agent.py` | tambah fungsi `get_conversation_history()` |
| Long-term memory tabel | buat `model/memory.py` baru | — |
| Memory node | `agents/nodes.py` + `agents/graph.py` | — |

---

*Dokumen ini bagian dari seri pembelajaran arsitektur llmnetops.*  
*Dokumen sebelumnya: [Pola Komunikasi Antar Agent](./AGENT_COMMUNICATION_PATTERNS.md)*  
*Topik lanjutan: Implementasi SqliteSaver step-by-step*
