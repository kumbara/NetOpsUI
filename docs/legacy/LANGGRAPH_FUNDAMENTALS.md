# LangGraph Fundamentals: Node, Edge, dan State

**Konteks:** Dokumen ini menjelaskan tiga konsep inti LangGraph menggunakan kode dari project `llmnetops` sebagai referensi konkret.

---

## Daftar Isi

1. [Analogi: Kantor NOC](#1-analogi-kantor-noc)
2. [State — Papan Tulis Bersama](#2-state--papan-tulis-bersama)
3. [Node — Petugas dengan Tugas Spesifik](#3-node--petugas-dengan-tugas-spesifik)
4. [Edge — Aturan Alur Kerja](#4-edge--aturan-alur-kerja)
5. [Bagaimana Ketiganya Berinteraksi](#5-bagaimana-ketiganya-berinteraksi)
6. [Mengapa Harus Menggunakan Node + Edge + State](#6-mengapa-harus-menggunakan-node--edge--state)
7. [Kapan Menggunakannya](#7-kapan-menggunakannya)
8. [Ringkasan Visual](#8-ringkasan-visual)

---

## 1. Analogi: Kantor NOC

Sebelum masuk ke kode, bayangkan sebuah **kantor NOC** (Network Operations Center):

```
[Papan Tulis / STATE]
  "ada laporan router DTI mati"
  "eko sudah cek: CPU 87%, DTI unreachable"
  "agus sudah diagnosa: interface flap"
        ↑ dibaca & ditulis oleh semua staf

[Eko / NODE]            [Agus / NODE]          [Budi / NODE]
  cek status jaringan     diagnosa masalah       tulis laporan
        ↓ selesai               ↑
[serahkan ke Agus / EDGE]
```

| Konsep | Analogi | Peran |
|---|---|---|
| **Node** | Petugas/staf | Melakukan pekerjaan tertentu |
| **State** | Papan tulis bersama | Tempat semua informasi disimpan dan dibagi |
| **Edge** | Aturan serah-terima | Menentukan "setelah A selesai, lanjut ke siapa" |

> **Aturan utama:** Node tidak bisa langsung bicara satu sama lain. Satu-satunya cara berkomunikasi adalah lewat State.

---

## 2. State — Papan Tulis Bersama

### Apa itu State?

State adalah **struktur data tunggal yang dibagikan ke semua node** dalam graph. Setiap node membaca dari state dan menulis kembali ke state. Tidak ada cara lain untuk memindahkan informasi antar node.

### Implementasi di Project

```python
# agent.py

class NetworkOpsState(TypedDict):
    messages:          Annotated[list, add_messages]        # percakapan lengkap
    next_agent:        str                                   # siapa yang jalan berikutnya
    active_agent:      str                                   # siapa yang sedang aktif
    injected_skills:   list[str]                             # skill yang relevan
    agent_log:         Annotated[list[AgentLogEntry], _append]  # log aktivitas
    pending_approval:  ApprovalRequest | None                # menunggu persetujuan
    approval_decision: str | None                            # keputusan operator
```

### Contoh: State Berubah Selama Percakapan

```python
# AWAL — state kosong saat graph dimulai
{
    "messages": [],
    "next_agent": "",
    "active_agent": "",
    "agent_log": [],
}

# SETELAH supervisor (bambang) berjalan
{
    "messages": [HumanMessage("cek jaringan kampus")],
    "next_agent": "monitor_agent",       # ← bambang menulis ini
    "active_agent": "supervisor",
    "agent_log": [
        {"source": "bambang", "event_type": "routing", "content": "→ monitor_agent"}
    ]
}

# SETELAH monitor_agent (eko) berjalan
{
    "messages": [
        HumanMessage("cek jaringan kampus"),
        AIMessage("Hasil: DTI unreachable, FIB-GW CPU 87%...")  # ← eko menambahkan
    ],
    "next_agent": "supervisor",          # ← eko menulis ini
    "active_agent": "monitor_agent",
    "agent_log": [
        {"source": "bambang", ...},
        {"source": "eko", "event_type": "tool_call", "content": "check_reachability(...)"},
        {"source": "eko", "event_type": "tool_result", "content": "DTI: UNREACHABLE"},
        {"source": "eko", "event_type": "routing", "content": "← kembali ke supervisor"},
    ]
}
```

### Reducer — Cara State Di-merge

Ketika sebuah node return update, LangGraph tidak langsung menimpa state. **Reducer** menentukan bagaimana update digabungkan dengan state yang sudah ada.

```python
# Annotated[list, add_messages]
# → setiap update DITAMBAHKAN ke list (tidak ditimpa)
messages: Annotated[list, add_messages]

# Contoh:
# state saat ini: messages = [msg1, msg2]
# node return: {"messages": [msg3]}
# hasil: messages = [msg1, msg2, msg3]  ← ditambahkan
```

```python
# Annotated[list[AgentLogEntry], _append]
# → sama, setiap log entry ditambahkan ke log yang ada
agent_log: Annotated[list[AgentLogEntry], _append]

# _append didefinisikan di agent.py:
def _append(existing: list, new: list) -> list:
    return (existing or []) + (new or [])
```

```python
# str biasa — DITIMPA langsung
next_agent: str

# Contoh:
# state saat ini: next_agent = "monitor_agent"
# node return: {"next_agent": "supervisor"}
# hasil: next_agent = "supervisor"  ← ditimpa
```

### Jenis Reducer dan Kapan Menggunakannya

| Jenis | Cara Mendefinisikan | Perilaku | Kapan Digunakan |
|---|---|---|---|
| **Replace** | `field: str` | Nilai lama ditimpa | Data yang hanya relevan saat ini (routing, active agent) |
| **Append** | `Annotated[list, reducer_fn]` | Nilai baru ditambahkan | Riwayat yang perlu dipertahankan (messages, log) |
| **Custom** | Fungsi Python apapun | Sesuai logika fungsi | Kebutuhan merge yang kompleks |

### Kapan Perlu Menambah Field State Baru?

> Tambahkan field baru ke state ketika **informasi perlu dibawa dari satu node ke node lain**, terutama jika informasi itu dibutuhkan oleh lebih dari satu node.

| Situasi | Perlu Field State Baru? |
|---|---|
| Eko temukan anomali, agus perlu tahu detailnya | ✅ Ya — misal `anomaly_report: dict` |
| Hasil intermediate yang hanya dipakai satu node | ❌ Tidak — simpan di variable lokal node |
| Status approval untuk operasi berisiko | ✅ Ya — `pending_approval` sudah ada |
| Counter iterasi di dalam satu node | ❌ Tidak — variable lokal saja |
| Data yang perlu di-pass ke semua specialist | ✅ Ya — `injected_skills` contohnya |

---

## 3. Node — Petugas dengan Tugas Spesifik

### Apa itu Node?

Node adalah **fungsi Python biasa** yang:
1. Menerima **seluruh state** sebagai input
2. Melakukan pekerjaan (panggil LLM, jalankan tool, hitung sesuatu)
3. Return **dict berisi bagian state yang berubah** — bukan seluruh state baru

```python
# Pola dasar sebuah node
def nama_node(state: NetworkOpsState) -> dict:
    # 1. Baca dari state
    data = state["messages"]

    # 2. Lakukan pekerjaan
    hasil = lakukan_sesuatu(data)

    # 3. Return HANYA field yang berubah
    return {
        "messages": [AIMessage(content=hasil)],
        "active_agent": "nama_node",
    }
    # Field yang tidak disebutkan → tidak berubah di state
```

### Tiga Jenis Node di Project Ini

#### Jenis 1: Node Sederhana (tanpa LLM)

```python
# Contoh: node yang hanya mencatat timestamp
def timestamp_node(state: NetworkOpsState) -> dict:
    return {
        "active_agent": "timestamp",
        "agent_log": [_log("timestamp", "info", f"Job dimulai {_now_str()}")]
    }
```

Ciri-ciri:
- Tidak ada LLM call
- Deterministik — output selalu sama untuk input yang sama
- Cepat, ringan
- Cocok untuk: pre-processing, validasi, transformasi data

#### Jenis 2: Node Routing dengan LLM (supervisor)

```python
# agents/nodes.py — supervisor_node (disederhanakan)
def supervisor_node(state: "NetworkOpsState") -> dict:
    # Baca messages dari state
    messages = state["messages"]

    # Panggil LLM untuk memutuskan routing
    llm = _make_llm(temperature=0.1, json_mode=True)
    resp = llm.invoke([sys_msg] + recent_messages)
    data = json.loads(resp.content)  # {"next_agent": "monitor_agent", ...}

    next_agent = data.get("next_agent", "monitor_agent")

    # Return update state — next_agent dibaca oleh edge routing
    return {
        "next_agent": next_agent,
        "active_agent": "supervisor",
        "injected_skills": data.get("relevant_skills", []),
        "agent_log": [_log("supervisor", "routing", f"→ {next_agent}")],
    }
```

Ciri-ciri:
- Ada LLM call
- Output tidak deterministik — LLM bisa berubah-ubah
- `next_agent` yang ditulis ke state akan dibaca oleh edge untuk routing
- Cocok untuk: keputusan kompleks yang butuh pemahaman konteks

#### Jenis 3: Node Specialist dengan ReAct Loop

```python
# agents/nodes.py — _make_specialist_node (disederhanakan)
def _make_specialist_node(agent_name: str, tools: list, context_window: int = 10):
    tool_map_local = {t.name: t for t in tools}
    llm_with_tools = _make_llm(temperature=0.3).bind_tools(tools)

    def _node(state: "NetworkOpsState") -> dict:
        # Baca context dari state
        context_msgs = list(state["messages"])[-context_window:]

        # Jalankan ReAct loop: LLM → pilih tool → jalankan tool → LLM → ...
        all_msgs, logs = _react_loop(
            llm_with_tools,
            [sys_msg] + context_msgs,
            tool_map_local,
            agent_name,
        )

        final_msg = all_msgs[-1]  # respons akhir LLM

        # Return update state
        return {
            "messages": [final_msg],        # ditambahkan ke messages yang ada
            "active_agent": agent_name,
            "next_agent": "supervisor",     # selalu kembali ke supervisor
            "agent_log": logs,              # ditambahkan ke log yang ada
        }

    _node.__name__ = agent_name
    return _node

# Membuat node menggunakan factory
monitor_node  = _make_specialist_node("monitor_agent",  MONITOR_TOOLS)
diagnose_node = _make_specialist_node("diagnose_agent", DIAGNOSE_TOOLS)
document_node = _make_specialist_node("document_agent", DOCUMENT_TOOLS, context_window=20)
```

Ciri-ciri:
- Ada LLM + tool calls dalam loop
- `context_window` mengontrol berapa banyak riwayat yang dibaca
- Menggunakan factory pattern agar bisa dibuat banyak specialist dengan pola sama

### Kapan Perlu Membuat Node Baru?

> Buat node baru ketika ada **unit kerja yang jelas batasannya**, punya input dan output yang terdefinisi, dan bisa diuji secara independen.

| Situasi | Buat Node Baru? |
|---|---|
| Agent dengan domain berbeda (monitoring vs security) | ✅ Ya |
| Sub-tugas kecil dalam satu agent | ❌ Tidak — tetap dalam node yang sama |
| Langkah yang butuh human-in-the-loop | ✅ Ya — dengan `interrupt()` |
| Pre-processing ringan sebelum LLM | ❌ Bisa di dalam node yang sama |
| Operasi yang sering dipakai ulang | ✅ Ya — buat dengan factory pattern |

---

## 4. Edge — Aturan Alur Kerja

### Apa itu Edge?

Edge adalah **koneksi antara dua node** yang menentukan alur eksekusi. Ada dua jenis:

### Unconditional Edge — Selalu ke Tujuan yang Sama

```python
# agents/graph.py

# Setiap kali graph dimulai, SELALU mulai dari supervisor
builder.add_edge(START, "supervisor")

# Setelah monitor_agent selesai, SELALU kembali ke supervisor
builder.add_edge("monitor_agent", "supervisor")

# Setelah semua specialist selesai, kembali ke supervisor
for agent in ("monitor_agent", "diagnose_agent", "config_agent",
              "security_agent", "document_agent"):
    builder.add_edge(agent, "supervisor")
```

Kapan digunakan:
- Alur yang tidak pernah berubah
- Semua specialist selalu kembali ke supervisor
- `START` → node pertama

### Conditional Edge — Tujuan Ditentukan Kondisi

```python
# agents/graph.py

builder.add_conditional_edges(
    "supervisor",               # dari node ini...
    route_from_supervisor,      # ...panggil fungsi ini untuk tahu tujuan
    {
        # mapping: return value fungsi → nama node tujuan
        "monitor_agent":  "monitor_agent",
        "diagnose_agent": "diagnose_agent",
        "config_agent":   "config_agent",
        "security_agent": "security_agent",
        "document_agent": "document_agent",
        "END":            END,
    },
)
```

```python
# Fungsi routing: membaca state, return string yang menentukan tujuan
def route_from_supervisor(state: dict) -> str:
    return state.get("next_agent", "END")
    # → membaca field next_agent yang sudah ditulis supervisor_node
```

**Alurnya:**
1. `supervisor_node` selesai, menulis `next_agent = "monitor_agent"` ke state
2. LangGraph memanggil `route_from_supervisor(state)`
3. Fungsi membaca state, return `"monitor_agent"`
4. LangGraph menjalankan node `"monitor_agent"`

### Visualisasi Graph Saat Ini

```
START
  │ unconditional
  ▼
[supervisor] ──── conditional edge ────► [monitor_agent] ───┐
                  route_from_supervisor  [diagnose_agent] ───┤ unconditional
                                         [config_agent]  ───┤ (semua kembali
                                         [security_agent] ──┤  ke supervisor)
                                         [document_agent] ──┤
                                         END ──► selesai    │
                  ◄──────────────────────────────────────────┘
```

### Kapan Pakai Masing-masing Edge?

| Situasi | Jenis Edge |
|---|---|
| Selalu ke node yang sama (specialist → supervisor) | **Unconditional** |
| Tujuan tergantung keputusan LLM | **Conditional** |
| Tujuan tergantung kondisi di state | **Conditional** |
| START → node pertama | **Unconditional** |
| Setelah approval — lanjut atau batal | **Conditional** |

---

## 5. Bagaimana Ketiganya Berinteraksi

Satu siklus lengkap di project ini, langkah demi langkah:

```
┌──────────────────────────────────────────────────────────────┐
│  STATE                                                       │
│  messages: [HumanMessage("cek jaringan kampus")]             │
│  next_agent: ""                                              │
└────────────────────────┬─────────────────────────────────────┘
                         │ (1) state dibaca oleh node
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  NODE: supervisor                                            │
│  • baca messages dari state                                  │
│  • panggil LLM → "next_agent = monitor_agent"               │
│  • return {"next_agent": "monitor_agent", ...}              │
└────────────────────────┬─────────────────────────────────────┘
                         │ (2) state di-update
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  STATE (sudah di-update)                                     │
│  messages: [HumanMessage("cek jaringan kampus")]             │
│  next_agent: "monitor_agent"    ← berubah                   │
│  active_agent: "supervisor"     ← berubah                   │
└────────────────────────┬─────────────────────────────────────┘
                         │ (3) state dibaca oleh edge
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  EDGE: conditional (route_from_supervisor)                   │
│  • baca state["next_agent"] → "monitor_agent"               │
│  • return "monitor_agent"                                    │
└────────────────────────┬─────────────────────────────────────┘
                         │ (4) arahkan eksekusi ke node berikutnya
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  NODE: monitor_agent (eko)                                   │
│  • baca messages[-10:] dari state                           │
│  • jalankan tools: check_reachability, get_system_info...   │
│  • return {"messages": [AIMessage(hasil)], ...}             │
└────────────────────────┬─────────────────────────────────────┘
                         │ (5) state di-update lagi
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  STATE (di-update lagi)                                      │
│  messages: [HumanMessage(...), AIMessage("DTI unreachable")] │
│  next_agent: "supervisor"       ← eko menulis ini           │
│  active_agent: "monitor_agent"  ← berubah                   │
└────────────────────────┬─────────────────────────────────────┘
                         │ (6) unconditional edge → kembali ke supervisor
                         ▼
                    [supervisor]
                         │ siklus berulang sampai next_agent = "END"
                         ▼
                        END
```

---

## 6. Mengapa Harus Menggunakan Node + Edge + State?

### Perbandingan: Monolitik vs LangGraph

**Kode lama — monolitik (~2600 baris di `agent.py`)**

```python
# ❌ Semua logika tercampur dalam satu fungsi
def handle_message(msg):
    if "cek jaringan" in msg:
        data = ssh_to_router(...)
        if data["cpu"] > 80:
            result = diagnose(...)
            if "routing loop" in result:
                config = get_config(...)
                if needs_security_check(config):
                    security = audit(...)
                    # semakin dalam, semakin kompleks
                    # tidak bisa ditest per bagian
                    # tidak bisa diubah satu bagian tanpa risiko merusak bagian lain
```

**Kode baru — LangGraph (per node terpisah)**

```python
# ✅ Setiap concern terpisah jelas
def monitor_node(state):    # HANYA urusan monitoring
    ...

def diagnose_node(state):   # HANYA urusan diagnosa
    ...

def config_node(state):     # HANYA urusan konfigurasi
    ...

# Routing dipisah dari logika — bisa diubah tanpa sentuh node
def route_from_supervisor(state):
    return state["next_agent"]
```

### Keuntungan Nyata

| Aspek | Monolitik | Node + Edge + State |
|---|---|---|
| **Tambah agent baru** | Ubah banyak tempat, risiko tinggi | Tambah 1 node + 1 edge |
| **Debug** | Susah — semua tercampur | Mudah — isolasi per node |
| **Testing** | Harus test keseluruhan | Test tiap node secara independen |
| **Alur kerja** | Tersembunyi dalam `if-else` bersarang | Eksplisit, bisa divisualisasikan |
| **State di titik manapun** | Tidak bisa diinspeksi | Bisa di-checkpoint dan di-replay |
| **Parallel execution** | Perlu kode manual | Native dengan `Send` API |
| **Human-in-the-loop** | Kompleks | Native dengan `interrupt()` |

### Contoh Nyata: Tambah Agent Baru di Project Ini

Ketika `document_agent` (budi) ditambahkan, yang perlu diubah:
1. Buat `DOCUMENT_TOOLS` di `tools.py` — ✅ terisolasi
2. Tambah `document_node` di `nodes.py` — ✅ terisolasi
3. Tambah entry di `_AGENT_ROLES` — ✅ terisolasi
4. Update supervisor prompt — ✅ hanya string
5. Tambah node dan edge di `graph.py` — ✅ dua baris

Tidak ada perubahan di node lain. Tidak ada risiko merusak eko, agus, joko, atau satria.

---

## 7. Kapan Menggunakannya

### Panduan Praktis

```
Punya tugas/pekerjaan yang perlu dilakukan?
  → Buat NODE
  → Pertanyaan: apakah tugas ini berdiri sendiri dan bisa ditest independen?
     Ya  → Node terpisah
     Tidak → Bagian dari node yang sudah ada

Perlu menentukan alur dari A ke B?
  → Buat EDGE
  → Pertanyaan: apakah tujuannya selalu sama?
     Ya  → Unconditional edge
     Tidak → Conditional edge + routing function

Perlu membawa data antar node?
  → Tambah field ke STATE
  → Pertanyaan: apakah data perlu diakumulasi (ditambahkan)?
     Ya  → Annotated[list, reducer_fn]
     Tidak → Field biasa (str, int, dict) — akan ditimpa
```

### Tanda-tanda Perlu Refactor

| Gejala | Solusi |
|---|---|
| Satu node melakukan terlalu banyak hal | Pecah menjadi beberapa node |
| Node A mengubah perilaku node B secara langsung | Gunakan state sebagai perantara |
| Routing logic tersebar di banyak node | Centralize di routing function |
| Informasi hilang karena ditimpa | Ganti ke reducer `append` |
| Sulit tahu agent mana yang aktif | Gunakan field `active_agent` di state |

---

## 8. Ringkasan Visual

```
┌─────────────────────────────────────────────────────────────┐
│                    LANGGRAPH GRAPH                          │
│                                                             │
│  [NODE A] ──edge──► [NODE B] ──edge──► [NODE C]            │
│      │                   │                  │               │
│      └──────────────────►│◄────────────────┘               │
│                          │                                  │
│              ┌───────────▼───────────┐                      │
│              │        STATE          │                      │
│              │  field_1: "nilai"     │                      │
│              │  field_2: [list...]   │                      │
│              │  field_3: {dict...}   │                      │
│              └───────────────────────┘                      │
│                                                             │
│  Node  = fungsi Python yang baca state → lakukan kerja     │
│          → return dict update state                        │
│                                                             │
│  Edge  = aturan "setelah node X, jalankan node Y"          │
│          Unconditional: selalu ke Y                        │
│          Conditional: routing function baca state → Y      │
│                                                             │
│  State = TypedDict yang dibagikan ke semua node            │
│          Reducer menentukan cara update (replace/append)   │
└─────────────────────────────────────────────────────────────┘
```

### Analogi Terakhir

Kalau LangGraph adalah sebuah pabrik:

- **State** adalah ban berjalan (conveyor belt) yang membawa produk
- **Node** adalah mesin atau pekerja di setiap stasiun yang mengerjakan produk
- **Edge** adalah rel yang menentukan produk dari stasiun A pergi ke stasiun mana

Setiap stasiun (node) tidak peduli bagaimana produk sampai ke sana — mereka hanya mengerjakan apa yang ada di depan mereka (state) dan meletakkan hasilnya kembali ke conveyor belt.

---

## Referensi Kode di Project Ini

| Konsep | File | Lokasi |
|---|---|---|
| Definisi State | `agent.py` | `class NetworkOpsState` |
| Reducer `_append` | `agent.py` | `def _append(...)` |
| Node supervisor | `agents/nodes.py` | `def supervisor_node(...)` |
| Node factory specialist | `agents/nodes.py` | `def _make_specialist_node(...)` |
| Node config + interrupt | `agents/nodes.py` | `def config_node(...)` |
| Routing function | `agents/nodes.py` | `def route_from_supervisor(...)` |
| Semua edge dan node registration | `agents/graph.py` | `def build_graph(...)` |
| Alias mapping (display name) | `agents/nodes.py` | `AGENT_ALIAS` |

---

*Dokumen ini bagian dari seri pembelajaran arsitektur llmnetops.*
*Topik lanjutan: [Pola Komunikasi Antar Agent](./AGENT_COMMUNICATION_PATTERNS.md)*
