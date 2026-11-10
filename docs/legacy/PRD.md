# PRD — NetOps AI: AI-Powered Campus Network Operations Platform

**Versi:** 1.2  
**Tanggal:** 2026-05-16  
**Status:** Selesai  
**Author:** Alan

---

## 1. Latar Belakang

Proyek ini awalnya dikembangkan sebagai tool monitoring DHCP lease MikroTik untuk event UTBK 2026 di Universitas Brawijaya. Tool tersebut (`llmnetops/main`) sudah berfungsi untuk monitoring DHCP, namun cakupannya terbatas dan arsitektur kodenya monolitik — semua logic agent, tools, dan UI tercampur dalam satu file `agent.py` (~2600 baris).

Branch baru ini (`netops`) mengembangkan tool tersebut menjadi platform operasional jaringan kampus yang komprehensif, dengan arsitektur multi-agent berbasis LangGraph dan skill system yang dapat dikonfigurasi oleh operator jaringan tanpa perlu menyentuh kode Python.

---

## 2. Tujuan

### 2.1 Tujuan Utama
- Memperluas cakupan dari monitoring DHCP → operasional jaringan kampus secara menyeluruh
- Memisahkan concerns: tools (infrastruktur), skills (pengetahuan domain), agents (orkestrasi), UI
- Memberikan operator jaringan kemampuan mendefinisikan prosedur kerja (skills) dalam Markdown tanpa coding
- Meningkatkan kemampuan diagnosis dengan multi-agent LangGraph yang terstruktur

### 2.2 Tujuan Sekunder
- Operator dapat memonitor komunikasi antar agent secara real-time di TUI
- Operasi berisiko memerlukan persetujuan eksplisit dari operator (human-in-the-loop)
- Skill dapat ditambah/diubah saat runtime tanpa restart sistem

---

## 3. Stakeholder

| Peran | Kebutuhan |
|---|---|
| **Operator Jaringan** | Monitor status jaringan, diagnosa masalah, lihat laporan, definisikan prosedur kerja |
| **Network Engineer** | Audit konfigurasi, backup config, analisis trafik, investigasi insiden |
| **Manager Jaringan** | Laporan harian kondisi jaringan, ringkasan anomali, rekomendasi tindakan |

---

## 4. Scope

### 4.1 In Scope (Branch `feature/web-server`)
- Multi-agent LangGraph: Supervisor + 6 specialist agents (monitor, diagnose, config, security, document, netbox)
- Skill system berbasis Markdown dengan hot reload; 32 skill aktif; `pedoman-agent.md` sebagai global conduct file
- Tools: reachability, system resource, routing, interface, traffic stats, DHCP, log, config read/write, config backup, security, diagnostic, NetBox IPAM, report, document — **61 tools**
- TUI Textual (`tui_textual.py`): chat + approval modal + token metrics di footer
- Human-in-the-loop approval untuk backup dan write operations (enforced code-level)
- Write operations ke router via `run_command_write` dengan mandatory backup-before-write
- Commissioning workflow: router baru dari fresh via skill + design doc
- Pengembangan scope dari DHCP-only → network operations menyeluruh
- NetBox agent: IPAM drift detection, sync konfigurasi

### 4.2 Out of Scope (masih)
- Web interface / REST API
- Wireless/CAPsMAN monitoring
- IPv6 support
- Integrasi ticketing system (Jira, ServiceNow)
- Notifikasi otomatis (email, Telegram, Slack)
- Vector embedding untuk skill search (cukup keyword matching untuk saat ini)

### 4.3 Tetap di Branch `main` (Tidak Disentuh)
- Logic `generate_reports.py` — tetap standalone
- Format output file DHCP lease di `output/`
- Compatibility dengan `schedule_utbk.sh`

---

## 5. Functional Requirements

### 5.1 Multi-Agent Orchestration

| ID | Requirement |
|---|---|
| FA-01 | Supervisor agent menerima input operator dan memilih specialist agent yang tepat |
| FA-02 | Semua routing antar specialist harus melalui supervisor — tidak ada direct handoff |
| FA-03 | Supervisor dapat chain multiple specialist untuk query kompleks |
| FA-04 | Operator dapat invoke skill secara eksplisit dengan prefix `/skill <nama>` |
| FA-05 | Supervisor secara otomatis mendeteksi skill yang relevan berdasarkan keyword query |
| FA-06 | Supervisor dapat route ke document_agent untuk kompilasi laporan multi-domain setelah specialist lain mengumpulkan data |

### 5.2 Skill System

| ID | Requirement |
|---|---|
| FB-01 | Skill didefinisikan dalam format Markdown dengan frontmatter YAML untuk metadata |
| FB-02 | Skill dimuat dari direktori `skills/` secara rekursif |
| FB-03 | Hot reload: perubahan file skill aktif tanpa restart sistem |
| FB-04 | Skill baru yang ditambahkan saat runtime langsung tersedia di session berikutnya |
| FB-05 | Skill dapat mendeklarasikan tools yang dibutuhkan dan apakah perlu approval |
| FB-06 | Operator dapat mengaktifkan/menonaktifkan skill individual |

### 5.3 Tools

| ID | Requirement |
|---|---|
| FC-01 | Setiap tool adalah fungsi Python atomic — satu operasi, satu output |
| FC-02 | Semua tool dikategorikan dalam file terpisah per domain di `tools/` |
| FC-03 | Tool baru untuk traffic stats: TX/RX rate realtime, top talkers, queue stats |
| FC-04 | Tool baru untuk config backup: export + simpan, diff dua versi, list backups |
| FC-05 | Tool read-only yang sudah ada di `agent.py` dipindahkan tanpa perubahan logic |
| FC-06 | Tool `write_document` menyimpan dokumen ke `laporan/` dengan konvensi nama `{tipe}_{YYYYMMDD}_{HHMMSS}.md` |
| FC-07 | Tool `create_template` membuat/memperbarui template di `skills/documents/templates/` tanpa restart |

### 5.4 Human-in-the-Loop

| ID | Requirement |
|---|---|
| FD-01 | Operasi config backup memerlukan persetujuan operator sebelum dieksekusi |
| FD-02 | TUI menampilkan detail aksi + risk level saat approval dibutuhkan |
| FD-03 | Operator approve dengan `Y` atau reject dengan `N` |
| FD-04 | Agent melanjutkan atau membatalkan berdasarkan keputusan operator |
| FD-05 | Semua keputusan approval tercatat di agent log |

### 5.5 TUI

| ID | Requirement |
|---|---|
| FE-01 | Semua LLM dan agent logic dipindahkan dari `tui.py` ke `agent.py` |
| FE-02 | `tui.py` hanya memanggil public API dari `agent.py` |
| FE-03 | Tambah screen/panel **Agent Activity** yang menampilkan komunikasi antar agent real-time |
| FE-04 | Agent Activity menampilkan: routing decisions, tool calls, tool results, approval requests |
| FE-05 | TUI tetap berfungsi normal (backward compatible) saat LangGraph tidak tersedia |

---

## 6. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFA-01 | Tool SSH timeout maksimal 30 detik per command |
| NFA-02 | Parallel tool execution untuk operasi multi-router (ThreadPoolExecutor) |
| NFA-03 | Skill loading tidak boleh block main thread TUI |
| NFA-04 | Agent response streaming — operator melihat output secara inkremental |
| NFA-05 | Credentials (SSH password) tidak pernah muncul di log atau output agent |
| NFA-06 | Config backup files disimpan di `backups/` yang dikecualikan dari git |
| NFA-07 | Path traversal protection untuk semua operasi file |

---

## 7. Success Metrics

| Metrik | Target | Aktual |
|---|---|---|
| Tool coverage (domain yang bisa diquery agent) | ≥ 8 domain | 12 domain ✅ |
| Jumlah skill contoh tersedia | ≥ 10 skill | 10 skill ✅ |
| Response time query sederhana (single tool) | < 10 detik | — (tergantung model/router) |
| Response time diagnosis kompleks (multi-tool) | < 60 detik | — (tergantung model/router) |
| LLM logic di tui.py | 0 baris | 0 baris ✅ |
| Lines of code di agent.py (orchestration only) | < 300 baris | 178 baris ✅ |
| Tool atomic tersedia | ≥ 20 | 32 tool ✅ |
| Specialist agents | ≥ 4 | 5 agent ✅ |

---

## 8. Constraints & Assumptions

- Router yang didukung: MikroTik RouterOS v6 dan v7
- LLM backend: Ollama (lokal), model default `qwen3:32b`
- LangGraph versi ≥ 0.2 (diperlukan untuk `interrupt()`)
- Python 3.11+
- Sistem operasi: Linux
- Semua operasi ke router bersifat **read-only** kecuali config backup yang require approval
