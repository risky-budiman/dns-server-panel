# Blueprint & Panduan Teknis: Dual DNS Server ISP + RPZ Kominfo + Web Control Panel

Dokumen ini berisi panduan instalasi, arsitektur, konfigurasi server Primary (NS1) & Secondary (NS2), worker sinkronisasi Trustpositif Kominfo via RPZ, serta kode sumber Web Panel DNS.

---

## 1. Spesifikasi Teknis & Skema

### A. Rincian Node
* **Server 1 (Primary / NS1):** `103.100.50.2` (Master Auth, Internal Resolver, Web Panel API, RPZ Worker)
* **Server 2 (Secondary / NS2):** `103.100.50.3` (Slave Auth, Slave RPZ, Standalone Recursor)
* **Domain ISP:** `ispanda.net.id`
* **Subnet Pelanggan ISP (ACL):** `103.100.50.0/24`, `10.0.0.0/8`

### B. Diagram Topologi

```text
                                +-----------------------------------+
                                |     Admin / Web Browser (GUI)     |
                                +-----------------+-----------------+
                                                  | HTTP (Port 3000)
                                +-----------------v-----------------+
                                |        SERVER 1 (PRIMARY)         |
                                |       IP: 103.100.50.2 (NS1)      |
                                |                                   |
 [Kominfo Feed]                 |  +-----------------------------+  |
       │                        |  | Web Panel API + Frontend    |  |
       │ Cron Sync              |  +--------------+--------------+  |
       ▼                        |                 |                 |
 [Worker Engine]                |  +--------------v--------------+  |
 (Download/Format) ──(Writes)──►|  | File System Zone Storage   |  |
                                |  | (/etc/bind/zones/)          |  |
                                |  +--------------+--------------+  |
                                |                 | rndc reload     |
                                |  +--------------v--------------+  |
                                |  | BIND9 Primary Daemon        |  |
                                |  | - View Internal (Recursor)  |  |
                                |  | - View External (Auth)      |  |
                                |  +--------------+--------------+  |
                                +-----------------+-----------------+
                                                  │
                                                  │ DNS NOTIFY & AXFR Transfer
                                                  │ (Secured with TSIG Key)
                                                  ▼
                                +-----------------------------------+
                                |       SERVER 2 (SECONDARY)        |
                                |       IP: 103.100.50.3 (NS2)      |
                                |                                   |
                                |  +-----------------------------+  |
                                |  | BIND9 Secondary Daemon      |  |
                                |  | - View Internal (Slave RPZ) |  |
                                |  | - View External (Slave Auth)|  |
                                |  +-----------------------------+  |
                                +-----------------------------------+