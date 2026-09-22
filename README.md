# ISP DNS Orchestrator Panel

Proyek ini adalah implementasi sistem manajemen terintegrasi untuk **Dual-Node DNS Server ISP (BIND9)** dengan fitur:
1. **Split-Horizon Views**: Pemisahan view internal (recursor resolver + RPZ untuk klien subnet ISP) dan external (authoritative murni tanpa rekursi untuk internet publik global).
2. **Automated Kominfo Trustpositif Sync**: Worker sinkronisasi RPZ (RFC 6672) hemat memory (RAM stream) dengan mekanisme *atomic swap* (`named-checkzone` -> `rename` -> `rndc reload`).
3. **Web Control Center**: Antarmuka web modern untuk inspeksi status node, manajemen record zone DNS (A, CNAME, TXT, MX), pemicu sinkronisasi manual, dan one-click dual-server remote provisioning via SSH.

---

## Struktur Direktori

```text
├── config/                 # Template konfigurasi BIND9
│   ├── named.conf.options  # ACL klien ISP, Rate Limiting (RRL DDoS protection)
│   ├── tsig.key.example    # Contoh kunci TSIG HMAC-SHA256 untuk transfer zone
│   ├── primary/            # Konfigurasi BIND9 untuk Server 1 (Primary / Master)
│   ├── secondary/          # Konfigurasi BIND9 untuk Server 2 (Secondary / Slave)
│   └── zones/              # File template zone authoritatif domain ISP
├── docs/                   # Spesifikasi & Dokumentasi Lengkap
│   ├── AGENT.md            # SOP, guardrails keamanan agen otonom
│   ├── AGENDA.md           # Rencana kerja & WBS 5 minggu (25 hari)
│   ├── BLUEPRINT.md        # Arsitektur sistem, topologi jaringan & data flow
│   ├── README.md           # Rincian teknis dual node dan subnet ACL
│   └── TROUBLESHOOTING.txt # Panduan resolusi insiden failover, cache, dan memory
├── public/                 # Frontend Web Panel UI (HTML5, CSS Dark Theme, JS)
├── scripts/                # Script bash inisialisasi RPZ dan generator TSIG key
├── service/                # Unit file systemd untuk auto-start panel di Linux
├── src/                    # Source Code Backend Node.js
│   ├── config.js           # Sentralisasi konfigurasi & environment variable
│   ├── orchestrator.js     # Engine remote provisioning via SSH2
│   ├── rpz-worker.js       # Worker streaming dataset Kominfo (hemat RAM)
│   ├── server.js           # HTTP REST API & Static Server
│   └── zone-manager.js     # Parser dan updater file zone BIND9
└── package.json            # Manifest proyek dan dependensi
```

---

## Akun Login Default Panel

| Role | Username | Password Default | Hak Akses |
|---|---|---|---|
| **Super Admin** | `admin` | `ispadmin2026` | Akses penuh, kelola user, deploy server |
| **NOC Operator** | `operator1` | `operator2026` | Kelola record DNS & sync RPZ Kominfo |
| **Auditor / Viewer** | `auditor1` | `auditor2026` | Read-only (hanya melihat status dan log) |

---

## Panduan Deployment ke Server Linux Production

Untuk panduan lengkap langkah demi langkah deploy Web Panel, konfigurasi Nginx reverse proxy, SSL HTTPS, firewall, dan systemd service, silakan baca:
👉 **[Panduan Lengkap Deployment Production (DEPLOYMENT_GUIDE.md)](docs/DEPLOYMENT_GUIDE.md)**

