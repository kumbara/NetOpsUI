# Implementation Plan — NetOps AI

**Versi:** 1.1  
**Tanggal:** 2026-05-16  
**Branch Target:** `feature/web-server`  
**Base Branch:** `main`

---

## Ringkasan Phases

| Phase | Nama | Deskripsi | Status | Commit |
|---|---|---|---|---|
| 1 | Foundation | Branch setup + struktur direktori + base layer | ✅ Selesai | 3459187 |
| 2 | Tool Extraction | Pecah tools dari agent.py ke tools/*.py | ✅ Selesai | f9cd9d9 |
| 2b | Tool Naming | Standarisasi nama tool (tool naming standardization) | ✅ Selesai | 01561ad |
| 3 | Skill System | SkillLibrary + format + 9 skill contoh | ✅ Selesai | 2eeb91e |
| 4 | Multi-Agent Graph | Supervisor + 4 specialist agents | ✅ Selesai | ff50090 |
| 5 | New Tools | traffic.py + config_backup.py | ✅ Selesai | 2f2d897 |
| 6 | TUI Refactor | Pisahkan LLM logic + Agent Activity screen | ✅ Selesai | 463e419 |
| 7 | Human-in-the-Loop | Approval mechanism via interrupt() | ✅ Selesai | b031262 |
| 8 | TUI Replacement | Ganti ncurses dengan Textual framework | ✅ Selesai | 34d6435 |
| 9 | Platform Maturity | Hallucination fix + commissioning + pedoman + backup enforcement | 🔄 In Progress | e17f2da |

**Legend:** ⬜ Belum · 🔄 In Progress · ✅ Selesai · 🔁 Review

---

## Phase 1: Foundation

**Goal:** Branch siap, struktur direktori ada, shared infrastructure terbentuk.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P1-01 | Buat branch `netops` dari `main` | — | `git checkout -b netops` berhasil |
| P1-02 | Buat struktur direktori | `tools/`, `skills/`, `agents/`, `backups/` | Semua direktori ada + `__init__.py` |
| P1-03 | Update `.gitignore` | `.gitignore` | `backups/` dikecualikan |
| P1-04 | Ekstrak `tools/base.py` | `tools/base.py` | `ssh_run_command`, `_load_config`, `_validate_router`, `_ssh_creds` ada + tested importable |
| P1-05 | Buat `requirements.txt` | `requirements.txt` | Semua dependency terdokumentasi dengan versi minimum |

### Definition of Done Phase 1
- `from tools.base import ssh_run_command, _load_config` berhasil ✅
- `git status` di branch `netops` ✅
- `requirements.txt` ada dan akurat ✅

---

## Phase 2: Tool Extraction

**Goal:** Semua tools dari `agent.py` dipindah ke `tools/*.py` tanpa perubahan logic. 20 tool atomic tersedia.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P2-01 | Ekstrak reachability tools | `tools/reachability.py` | `check_reachability` |
| P2-02 | Ekstrak system tools | `tools/system.py` | `get_system_info` |
| P2-03 | Ekstrak routing tools | `tools/routing.py` | `get_routing_full`, `get_router_config` |
| P2-04 | Ekstrak interface tools | `tools/interface.py` | `get_interface_stats` |
| P2-05 | Ekstrak DHCP tools | `tools/dhcp.py` | `get_dhcp_leases`, `get_router_leases`, `search_device`, `audit_dhcp` |
| P2-06 | Ekstrak log tools | `tools/log.py` | `get_router_log` |
| P2-07 | Ekstrak config_read tools | `tools/config_read.py` | `run_command`, `run_command_all` |
| P2-08 | Ekstrak security tools | `tools/security.py` | `audit_security` |
| P2-09 | Ekstrak diagnostic tools | `tools/diagnostic.py` | `run_diagnostic` |
| P2-10 | Ekstrak report tools | `tools/report.py` | `list_reports`, `get_report`, `get_report_section`, `get_report_toc` |
| P2-11 | Ekstrak utility tools | `tools/utility.py` | `list_routers`, `get_current_time` |
| P2-12 | Standarisasi nama tool | `tools/report.py`, `tools/dhcp.py`, dll | `get_report`, `audit_dhcp`, `get_router_leases`, `audit_security`, `run_command_all` konsisten |
| P2-13 | Verifikasi semua tools importable | — | Import dari `tools.*` OK untuk semua tools |

### Catatan P2
- 20 tool atomic tersedia setelah Phase 2 selesai
- Nama tool yang distandarisasi (Phase 2b): `read_report` → `get_report`, `read_report_section` → `get_report_section`, `get_all_leases_for_router` → `get_router_leases`, `audit_all_routers` → `audit_dhcp`, `run_command_all_routers` → `run_command_all`

### Definition of Done Phase 2
- `tools/` berisi 11 file ✅
- Semua `@tool` decorator ada di masing-masing file ✅
- Import dari `tools.*` berfungsi tanpa error ✅
- Total 20 tool atomic importable ✅

---

## Phase 3: Skill System

**Goal:** SkillLibrary berfungsi, format skill terdefinisi, 9 skill tersedia.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P3-01 | Implementasi `SkillLibrary` class | `skills/library.py` | Load, search, hot reload berfungsi |
| P3-02 | Implementasi file watcher | `skills/library.py` | Perubahan file `.md` ter-detect dalam 2 detik |
| P3-03 | Buat skill: `utbk-client-monitor` | `skills/dhcp/utbk-client-monitor.md` | Format valid, triggers match |
| P3-04 | Buat skill: `diagnose-dhcp-client` | `skills/dhcp/diagnose-dhcp-client.md` | Format valid |
| P3-05 | Buat skill: `dhcp-pool-audit` | `skills/dhcp/dhcp-pool-audit.md` | Format valid |
| P3-06 | Buat skill: `bgp-diagnostics` | `skills/routing/bgp-diagnostics.md` | Format valid |
| P3-07 | Buat skill: `ospf-neighbor-down` | `skills/routing/ospf-neighbor-down.md` | Format valid |
| P3-08 | Buat skill: `network-health-check` | `skills/monitoring/network-health-check.md` | Format valid |
| P3-09 | Buat skill: `router-unreachable` | `skills/monitoring/router-unreachable.md` | Format valid |
| P3-10 | Buat skill: `security-audit` | `skills/security/security-audit.md` | Format valid |
| P3-11 | Buat skill: `config-backup-procedure` | `skills/config/config-backup-procedure.md` | `approval_required: true` |

### Catatan P3
- `SkillLibrary` diimplementasikan di `skills/library.py`, bukan di `agent.py`
- `skills/__init__.py` mengekspos `from skills.library import Skill, SkillLibrary`
- Singleton `_skill_lib` dibuat di `agent.py` saat modul di-import
- Hot reload menggunakan `watchfiles` library (background daemon thread)

### Definition of Done Phase 3
- `SkillLibrary().find_relevant("client tidak dapat IP")` return skill DHCP ✅
- Hot reload: edit `.md` → perubahan aktif tanpa restart ✅
- 9 skill tersedia dan enabled ✅

---

## Phase 4: Multi-Agent Graph

**Goal:** LangGraph Supervisor + 4 specialist agents berfungsi, routing akurat, streaming ke TUI berjalan.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P4-01 | Definisi `NetworkOpsState` | `agent.py` | TypedDict valid, semua field ada |
| P4-02 | Implementasi tool registries per agent | `agents/tools.py` | `MONITOR_TOOLS`, `DIAGNOSE_TOOLS`, `CONFIG_TOOLS`, `SECURITY_TOOLS`, `TOOL_MAP` |
| P4-03 | Implementasi `supervisor_node` | `agents/nodes.py` | Routing ke 4 specialist + END via JSON-mode LLM |
| P4-04 | Implementasi `_make_specialist_node()` factory | `agents/nodes.py` | Factory untuk monitor, diagnose, security nodes |
| P4-05 | Implementasi `config_node` | `agents/nodes.py` | interrupt() placeholder untuk backup tools |
| P4-06 | Implementasi `_react_loop()` helper | `agents/nodes.py` | ReAct tool-calling loop, max 12 iters |
| P4-07 | Bangun `StateGraph` di `agents/graph.py` | `agents/graph.py` | `build_graph(checkpointer)` compile tanpa error |
| P4-08 | Implementasi `create_agent()` public API | `agent.py` | Return (graph, config) yang valid |
| P4-09 | Implementasi `stream_agent_response()` | `agent.py` | Yield event tuples sesuai spec |
| P4-10 | Tulis ulang `agent.py` dari scratch | `agent.py` | 178 baris, zero LLM logic, hanya public API |
| P4-11 | Update `tui.py` import | `tui.py` | Import dari `agent.py` baru, tidak ada import error |

### Catatan P4
- Semua node ada di satu file `agents/nodes.py` dengan factory pattern — tidak ada file per-agent terpisah
- `route_from_supervisor(state: dict)` menggunakan type hint `dict` (bukan forward ref `"NetworkOpsState"`) karena LangGraph memanggil `get_type_hints()` saat compile
- `agent.py` ditulis ulang dari scratch menjadi 178 baris — tidak ada `agent_legacy.py`
- `agents/graph.py` berisi `build_graph()` yang dipanggil oleh `agent.py`

### Definition of Done Phase 4
- Query "cek status jaringan" → `monitor_agent` teraktivasi ✅
- Query "diagnosa koneksi DTI" → `diagnose_agent` teraktivasi ✅
- Streaming event sampai ke TUI ✅
- `agent.py` = 178 baris (orchestration + public API only) ✅

---

## Phase 5: New Tools

**Goal:** Tools traffic stats dan config backup tersedia dan terhubung ke agent.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P5-01 | Implementasi `get_interface_traffic` | `tools/traffic.py` | Return TX/RX rate realtime |
| P5-02 | Implementasi `get_traffic_summary` | `tools/traffic.py` | Semua interface satu router |
| P5-03 | Implementasi `get_top_talkers` | `tools/traffic.py` | Menggunakan MikroTik `/tool/torch` |
| P5-04 | Implementasi `get_queue_stats` | `tools/traffic.py` | Queue usage dan drop stats |
| P5-05 | Implementasi `get_traffic_all` | `tools/traffic.py` | Traffic stats semua router paralel |
| P5-06 | Implementasi `backup_router_config` | `tools/config_backup.py` | Export + simpan ke `backups/<router>/<ts>.rsc` |
| P5-07 | Implementasi `list_backups` | `tools/config_backup.py` | Daftar backup per router |
| P5-08 | Implementasi `diff_config` | `tools/config_backup.py` | Diff dua file backup (unified_diff) |
| P5-09 | Tambah traffic tools ke `MONITOR_TOOLS` | `agents/tools.py` | 5 traffic tools terdaftar |
| P5-10 | Tambah config_backup tools ke `CONFIG_TOOLS` | `agents/tools.py` | 3 config backup tools terdaftar |

### Catatan P5
- Total 28 tool atomic setelah Phase 5 (20 + 5 traffic + 3 config backup)
- `get_traffic_all` diimplementasikan di Phase 5 sebagai tool ke-5 di traffic.py
- Skill `traffic-analysis.md` tidak dibuat; `config-backup-procedure.md` sudah ada sejak Phase 3

### Definition of Done Phase 5
- `backup_router_config("DTI")` menyimpan file ke `backups/DTI/DTI_YYYYMMDD_HHMMSS.rsc` ✅
- `diff_config("DTI", file1, file2)` output readable diff ✅
- `get_interface_traffic("DTI", "ether1")` return TX/RX rates ✅
- Total 28 tool terdaftar di `TOOL_MAP` ✅

---

## Phase 6: TUI Refactor

**Goal:** Zero LLM logic di `tui.py`. Agent Activity screen berfungsi.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P6-01 | Hapus `_call_ollama()` dari `AIScreen` | `tui.py` | Tidak ada Ollama import di tui.py |
| P6-02 | Hapus semua LLM logic dari `AIScreen` | `tui.py` | Tidak ada LangGraph/langchain import di tui.py |
| P6-03 | Refactor `AIScreen._send_message()` | `tui.py` | Hanya panggil `agent.stream_agent_response()` |
| P6-04 | Handle semua event types di `AIScreen.draw()` | `tui.py` | routing, tool_call, tool_result, ai, approval_required render dengan benar |
| P6-05 | Implementasi `AgentActivityScreen` | `tui.py` | Screen baru menu item 7 |
| P6-06 | Agent Activity: render agent_log | `tui.py` | Log events tampil dari `_agent_activity_log` shared list |
| P6-07 | Update MENU constant | `tui.py` | Menu item 7 "Activity" muncul |
| P6-08 | Implementasi shared `_agent_activity_log` | `tui.py` | `AIScreen` write, `AgentActivityScreen` read |

### Catatan P6
- `tui.py` turun dari ~1821 baris → 1592 baris (-229 baris) setelah remove LLM logic
- `_agent_activity_log: list[dict] = []` di module level sebagai shared state
- `AgentActivityScreen._EVENT_ICONS` map event type ke ikon dan warna terminal
- Title diubah dari lama → "NetOps AI — Campus Network Operations"
- `AIScreen` state machine: "IDLE" | "WAITING" | "APPROVAL"

### Definition of Done Phase 6
- `grep -n "import langchain\|import langgraph\|ChatOllama\|requests.post" tui.py` → 0 results ✅
- Agent Activity screen tampil dan update real-time ✅
- TUI berfungsi normal untuk semua 7 menu items ✅

---

## Phase 7: Human-in-the-Loop

**Goal:** Config backup memerlukan approval operator, flow berjalan end-to-end.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P7-01 | Tambah `interrupt()` gate di `config_node` | `agents/nodes.py` | Graph pause saat `backup_router_config` dipanggil |
| P7-02 | Implementasi `submit_approval()` public API | `agent.py` | `Command(resume=decision)` dikirim ke graph |
| P7-03 | TUI: handle event `approval_required` | `tui.py` | APPROVAL state + modal panel di AIScreen |
| P7-04 | TUI: kirim keputusan operator ke agent | `tui.py` | Y/N keys → `agent.submit_approval()` |
| P7-05 | Log approval decisions ke `agent_log` | `agents/nodes.py` | Keputusan tercatat di `config_agent` log |
| P7-06 | Test end-to-end: request backup → approval → eksekusi | — | Flow lengkap berfungsi |

### Catatan P7
- `_APPROVAL_REQUIRED_TOOLS = {"backup_router_config"}` di `agents/nodes.py` — mudah diperluas
- `interrupt(approval_req)` langsung di dalam `config_node` loop, bukan di dalam tool
- TUI menangkap Y/N sebelum `handle_key` normal ketika `_state == "APPROVAL"`
- `submit_approval()` memanggil `graph.invoke(Command(resume=decision), config=config)`

### Definition of Done Phase 7
- Request backup → TUI modal muncul → Y → backup file tersimpan ✅
- Request backup → TUI modal muncul → N → agent respond "dibatalkan" ✅
- Log approval decision muncul di Agent Activity screen ✅

---

## Phase 8: TUI Replacement (Textual)

**Goal:** Ganti ncurses-based `tui.py` dengan Textual framework. Simple, maintainable, Google-inspired design.

### Tasks

| ID | Task | File Target | DoD |
|---|---|---|---|
| P8-01 | Setup Textual + struktur app | `tui_textual.py` | `textual` installed, `python tui_textual.py` runs |
| P8-02 | Header + Footer layout | `tui_textual.py` | Header: nama agent aktif + status; Footer: ctx%, pred%, tools, elapsed |
| P8-03 | ChatPanel — area pesan | `tui_textual.py` | Pesan user + agent tampil; tool calls inline (✓/✗/⟳ + durasi) |
| P8-04 | InputBar — area input | `tui_textual.py` | Enter to send; disabled otomatis saat RUNNING |
| P8-05 | Connect ke `stream_agent_response()` | `tui_textual.py` | Async Worker; event routing/tool/ai dirender ke ChatPanel |
| P8-06 | Approval modal (ModalScreen) | `tui_textual.py` | Muncul saat `approval_required`; tampilkan router + perintah; tombol Setujui/Tolak |
| P8-07 | Connect approval ke `resume_after_approval()` | `tui_textual.py` | Keputusan operator dikirim via streaming; interrupt chain berikutnya ditangani |
| P8-08 | Token metrics di Footer | `tui_textual.py` | ctx% dan pred% dari `AIMessage.usage_metadata`; progress bar ASCII |
| P8-09 | Tambah `--ui` flag ke launcher | `tui_textual.py` | `python tui_textual.py` atau flag `--ui textual` di entry point |
| P8-10 | Test end-to-end | — | Query → tool calls → approval → resume semua berfungsi |

### Design Decisions

- **Layout:** Satu panel utama, chat mendominasi layar penuh, tool calls inline di dalam chat
- **Header:** Satu baris tipis — nama agen aktif + bullet status (idle/running/approval)
- **Footer:** Satu baris — `ctx ████░░ 19%  ·  pred ████░░ 26%  ·  8 tools  ·  00:02:14`
- **Approval:** Textual `ModalScreen`, centered, tanpa box drawing berat
- **Style:** Google-inspired — hanya `─` sebagai separator, whitespace konsisten, tidak ada `╔╗╚╝`
- **Migrasi:** `tui_textual.py` berjalan paralel dengan `tui.py` sampai verified stabil

### Definition of Done Phase 8

- `python tui_textual.py` runs tanpa error ✅
- Query, approval, multi-interrupt chain semua berfungsi ✅
- Token metrics tampil real-time di footer ✅
- Code lebih pendek dan maintainable dari `tui.py` ✅

---

## Phase 9: Platform Maturity

**Goal:** Hardening output quality, safety enforcement code-level, workflow commissioning, dan arsitektur conduct yang maintainable.

### Tasks

| ID | Task | File Target | Status |
|---|---|---|---|
| P9-01 | Fix hallucination morning-check (example contamination + premature output) | `skills/monitoring/morning-check.md` | ✅ |
| P9-02 | Approval modal buttons tidak terlihat (border: tall + height issue) | `tui_textual.py` | ✅ |
| P9-03 | Tambah narasi edukasi WAJIB setelah setiap tabel | `skills/pedoman-agent.md` | ✅ |
| P9-04 | Larangan action items pasif (Monitor/Verifikasi/Pertimbangkan) | `skills/pedoman-agent.md` | ✅ |
| P9-05 | Backup-before-write enforcement code-level di config_node | `agents/nodes.py` | ✅ |
| P9-06 | Fix /add blocklist false positive (regex path terminal segment) | `tools/config_read.py` | ✅ |
| P9-07 | Containerlab commissioning workflow (RouterOS CHR, 2 router) | `skills/config/commissioning.md`, `laporan/commissioning-spec-lab.md` | ✅ |
| P9-08 | Refactor global agent rules ke pedoman-agent.md (hot-reload tanpa restart) | `agents/nodes.py`, `skills/pedoman-agent.md` | ✅ |
| P9-09 | Local language morning check (triggers lokal + header bahasa Indonesia) | `skills/monitoring/morning-check.md` | ⬜ |
| P9-10 | Regression test eval.py setelah semua perubahan | `tests/eval.py` | ⬜ |

### Catatan P9

- **pedoman-agent.md** — file conduct global dimuat via `_load_pedoman()` di startup; ubah perilaku semua agent tanpa restart Python
- **Auto-backup** — `_backed_up_routers: set[str]` per invocation; skip jika LLM sudah call backup duluan; jika operator tolak → write dibatalkan
- **Commissioning skill** — config_agent baca `laporan/commissioning-spec-lab.md` via `get_report()` saat runtime; ubah parameter (NTP, SNMP, user) di Markdown tanpa ubah kode
- **Hallucination fix** — 3 lapis: (1) Aturan Kritis larangan print template, (2) INSTRUKSI gate sebelum format section, (3) gate transisi eksplisit setelah setiap langkah

### Definition of Done Phase 9

- Morning check tidak pernah print template verbatim ✅ (P9-01)
- Agent tidak pernah write ke router tanpa backup didahulukan ✅ (P9-05)
- `/ip/firewall/address-list/print` tidak diblokir blocklist ✅ (P9-06)
- `skills/pedoman-agent.md` sebagai single source of truth conduct semua agent ✅ (P9-08)
- Local language morning check triggers berfungsi ⬜ (P9-09)
- `python tests/eval.py` pass semua kasus ⬜ (P9-10)

---

## Tracking Status

### Progress Overview

```
Phase 1: Foundation          [██████████] 100% ✅
Phase 2: Tool Extraction     [██████████] 100% ✅
Phase 3: Skill System        [██████████] 100% ✅
Phase 4: Multi-Agent Graph   [██████████] 100% ✅
Phase 5: New Tools           [██████████] 100% ✅
Phase 6: TUI Refactor        [██████████] 100% ✅
Phase 7: Human-in-the-Loop   [██████████] 100% ✅
Phase 8: TUI Replacement     [██████████] 100% ✅
Phase 9: Platform Maturity   [████████░░]  80% 🔄
```

### Hasil Akhir

| Metrik | Target | Aktual |
|---|---|---|
| Tool atomic | ≥ 20 | 61 |
| Skill | ≥ 8 | 32 |
| Lines agent.py | < 300 | 278 |
| LLM logic di tui.py | 0 | 0 |
| Specialist agents | 4 | 6 |
| Total commit di branch | — | 81 |

---

## Dependency Graph antar Phase

```
P1 (Foundation)
  └── P2 (Tool Extraction)
        ├── P3 (Skill System) ─────────┐
        └── P4 (Multi-Agent Graph) ◄───┘
              ├── P5 (New Tools)
              ├── P6 (TUI Refactor)
              └── P7 (Human-in-the-Loop)
                    └── P8 (TUI Replacement)
```

P5, P6, P7 dikerjakan paralel setelah P4 selesai. P8 dikerjakan setelah P7 verified. P9 dikerjakan paralel dengan P8 (hardening tidak blokir TUI launch).
