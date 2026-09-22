# Blueprint: Skill Matrix, Skema Arsitektur, & Roadmap DNS Server ISP Dual-Node + RPZ Kominfo

Dokumen ini merangkum kompetensi teknis, topologi sistem, dan tahapan eksekusi dari nol hingga tahap produksi untuk implementasi sistem DNS Server ISP (Authoritative + Recursor) dengan sinkronisasi RPZ Trustpositif Kominfo dan Web Control Panel Orchestrator.

---

## 1. Skill Matrix & Kompetensi Teknis

Untuk membangun, mengoperasikan, dan merawat infrastruktur DNS ISP ini, diperlukan pemahaman pada beberapa domain keahlian:

### A. Network & DNS Protocol Engineering
* **DNS Standards & RFCs:**
  * Pemahaman mendalam tentang perbedaan peran **Authoritative** (Name Server domain) vs **Recursive Resolver** (Caching DNS browsing pelanggan).
  * Penguasaan konsep **Split-Horizon (Views)** untuk memisahkan hak akses publik dan internal ISP pada daemon yang sama.
  * Standar **Response Policy Zone (RPZ - RFC 6672)**: Format sintaks CNAME/NXDOMAIN, wildcard blocking (`*.domain.com`), dan bypass policy (`PASSTHRU`).
  * Mekanisme sinkronisasi DNS: **AXFR** (Full Zone Transfer), **IXFR** (Incremental Transfer), dan **DNS NOTIFY**.
* **Keamanan DNS (DNS Security):**
  * Otentikasi replikasi master-slave menggunakan **TSIG Key** (`hmac-sha256`).
  * Mitigasi eksploitasi Open Resolver (mencegah server dijadikan reflektor serangan *DNS Amplification DDoS*).
  * Penerapan **Response Rate Limiting (RRL)** pada BIND9.
  * Validasi **DNSSEC** otomatis.

### B. Linux Systems & Automation
* **System Administration:**
  * Manajemen service systemd, penanganan file permissions (`bind:bind`), chroot environment, dan log monitoring (`syslog`, `named.log`).
  * Pemeliharaan cache memory, disk I/O, serta optimasi socket network (`UDP/TCP port 53`).
* **Remote Orchestration & Scripting:**
  * Otomatisasi konfigurasi remote server melalui protokol **SSH2 / Bastion Host**.
  * Background worker / Cron scheduling untuk sinkronisasi rutin dataset skala besar.

### C. Backend & Large Dataset Streaming
* **Runtime & Process Execution:**
  * Runtime backend (Node.js, Bun, atau Go) untuk mengontrol CLI tools (`rndc`, `named-checkzone`, `named-checkconf`).
* **High-Throughput File Streaming:**
  * Pemrosesan teks dataset Trustpositif (500.000–1.000.000+ domain) menggunakan Node.js **Read/Write Streams** dan `readline` interface guna mencegah *out-of-memory (OOM)* pada RAM server.
  * Sanitasi string, deduplikasi berbasis hashing/Set, serta pembuatan file zone secara *atomic* (tulis ke `.tmp` -> validasi -> rename).

### D. Frontend & Web Interface
* Antarmuka Single Page Application (SPA) ringan menggunakan Tailwind CSS untuk form provisioning, live deploy status, penambahan DNS records, dan trigger sinkronisasi RPZ manual.

---

## 2. Skema Arsitektur Sistem

### A. Diagram Topologi Jaringan & Data Flow

```text
[ Browser Admin / Operator ]
             │
             │ HTTP (Port 3000)
             ▼
┌──────────────────────────────────────────────────────────┐
│             WEB CONTROL PANEL / ORCHESTRATOR             │
│            (Standalone Management Container/Node)        │
│                                                          │
│  - Remote Bootstrap Engine (SSH2 Agent)                  │
│  - DNS Record Provisioner (A, CNAME, MX, TXT)            │
│  - Live Status & Trigger Sync Kominfo                    │
└───────────────┬──────────────────────────┬───────────────┘
                │                          │
   SSH Deploy / │             SSH Deploy / │
   Remote Sync  │              Remote Sync │
                ▼                          ▼
┌───────────────────────────────┐  AXFR/IXFR (TSIG)  ┌───────────────────────────────┐
│     SERVER 1 (PRIMARY/NS1)    ├───────────────────►│    SERVER 2 (SECONDARY/NS2)   │
│     IP: 103.100.50.2          │  (Port 53 TCP)     │    IP: 103.100.50.3           │
├───────────────────────────────┤                    ├───────────────────────────────┤
│ [Worker Kominfo (Cron)]       │                    │ [BIND9 Daemon (Slave)]        │
│   - Download raw blacklist    │                    │                               │
│   - Normalisasi RFC RPZ       │                    │  View Internal (Resolver):    │
│   - Atomic rndc reload        │                    │   - Slave rpz.kominfo         │
│                               │                    │   - Slave ispanda.net.id      │
│ [BIND9 Daemon (Master)]       │                    │   - Recursive for ISP clients │
│                               │                    │                               │
│  View Internal (Resolver):    │                    │  View External (Authoritative)│
│   - Master rpz.kominfo        │                    │   - Slave ispanda.net.id      │
│   - Master ispanda.net.id     │                    │   - No Recursion (Public safe)│
│   - Recursive for ISP clients │                    └───────────────┬───────────────┘
│                               │                                    │
│  View External (Authoritative)│                                    │
│   - Master ispanda.net.id     │                                    │
│   - No Recursion (Public safe)│                                    │
└───────────────┬───────────────┘                                    │
                │                                                    │
                └──────────────────────────┬─────────────────────────┘
                                           │
                        Port 53 UDP/TCP DNS Queries
                                           │
                  ┌────────────────────────┴────────────────────────┐
                  ▼                                                 ▼
     [ Pelanggan ISP (Subnet) ]                         [ Internet Publik Global ]
     - Recursive Query: ALLOWED                         - Recursive Query: REFUSED
     - Filter RPZ: ACTIVE (NXDOMAIN)                    - Domain Auth: RESOLVED