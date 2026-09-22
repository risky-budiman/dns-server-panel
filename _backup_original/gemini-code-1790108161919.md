# Agenda & Rencana Kerja Eksekusi Proyek (agenda.md)

**Nama Proyek:** Dual-Node ISP DNS Server, Automated RPZ Kominfo Sync, & Orchestrator Web Panel  
**Target Delivery:** 5 Minggu (25 Hari Kerja)  
**Tujuan:** Membangun infrastruktur DNS Primary & Secondary standar ISP yang patuh regulasi Trustpositif Kominfo, terisolasi keamanannya, dan dapat dikontrol penuh melalui antarmuka web.

---

## 1. Timeline & Matriks Jadwal Mingguan

| Minggu | Fokus Utama | Target Deliverable | PIC / Lead | Status |
|---|---|---|---|---|
| **Minggu 1** | Inisiasi & Core DNS Topology | VPS Provisioning, Glue Records, BIND9 Views & TSIG Transfer | Network Engineer | Pending |
| **Minggu 2** | Pipeline RPZ Trustpositif | Script normalisasi stream, atomic zone update, auto-cron | Backend / Dev | Pending |
| **Minggu 3** | Remote Provisioner & Backend API | Modul SSH2 Provisioner, REST API CRUD Record, auto-SOA | Backend / Dev | Pending |
| **Minggu 4** | Web Control Panel & Dashboard | Frontend UI (Tailwind), trigger sync RPZ, DNS Table | Frontend / Fullstack | Pending |
| **Minggu 5** | Hardening, Audit & Production | Penetration test Open Resolver, uji failover HA, Go-Live | SecOps / Sysadmin | Pending |

---

## 2. Rincian Agenda Kerja Harian (Work Breakdown Structure)

### Minggu 1: Fondasi Infrastruktur & Topologi BIND9
* **Hari 01:** Provisioning 2 unit VPS Ubuntu 24.04 di subnet/upstream berbeda (Primary `103.100.50.2` & Secondary `103.100.50.3`).
* **Hari 02:** Registrasi Glue Records (Child Nameservers `ns1` dan `ns2`) pada registrar domain ISP (`ispanda.net.id`).
* **Hari 03:** Pembuatan TSIG Key (`hmac-sha256`) dan uji komunikasi zone transfer transfer-key antar kedua server.
* **Hari 04:** Konfigurasi Split-Horizon Views (`internal-resolver` vs `external-authoritative`) pada BIND9 Primary & Secondary.
* **Hari 05:** Uji coba AXFR manual dari Server 2 ke Server 1 dan verifikasi routing port 53 UDP/TCP.

### Minggu 2: Engine Sinkronisasi RPZ Kominfo
* **Hari 06:** Riset format feed database domain Kominfo Trustpositif dan profiling ukuran data (500k+ baris).
* **Hari 07:** Pembuatan script parser berbasis Node.js stream (`readline`) untuk sanitasi URL, trailing slash, dan FQDN.
* **Hari 08:** Implementasi mekanisme penulisan atomic file: tulis ke `.tmp`, verifikasi dengan `named-checkzone`, lalu replace ke file aktif.
* **Hari 09:** Integrasi mekanisme reload zero-downtime menggunakan `rndc reload rpz.kominfo in internal-resolver`.
* **Hari 10:** Uji stress-test konsumsi RAM/CPU selama reload berlangsung dan konfigurasi penjadwalan Cron (tiap 6 jam).

### Minggu 3: Orchestration Engine & REST API
* **Hari 11:** Desain arsitektur Node.js Orchestrator menggunakan library `ssh2`.
* **Hari 12:** Pembuatan modul auto-provisioning script: push named.conf, pembuatan direktori zone, dan aktivasi systemd service.
* **Hari 13:** Pembuatan parser file zone authoritatif ISP (`db.ispanda.net.id`) untuk membaca record ke format JSON.
* **Hari 14:** Pembuatan API endpoint penambahan/penghapusan record (A, CNAME, TXT, MX) dengan auto-increment serial SOA.
* **Hari 15:** Uji eksekusi end-to-end: penambahan record dari API Primary hingga otomatis ter-update di Secondary.

### Minggu 4: Antarmuka Web Control Panel
* **Hari 16:** Setup dashboard SPA berbasis HTML5/Tailwind CSS yang responsif dan clean.
* **Hari 17:** Pembuatan antarmuka form One-Click Deployment (input IP, Port, dan kredensial SSH Server 1 & 2).
* **Hari 18:** Pembuatan tabel manajemen pointing domain authoritatif ISP dengan modal penambahan record instan.
* **Hari 19:** Integrasi tombol "Sync Kominfo Now" manual beserta visual status indicator / execution log terminal.
* **Hari 20:** Implementasi modul manajemen Local Whitelist (RPZ Passthru) untuk bypass domain yang salah blokir.

### Minggu 5: Hardening, Pengujian Ekstrem & Go-Live
* **Hari 21:** **Security Audit:** Pengetesan Open Resolver dari IP publik luar (wajib berstatus `REFUSED` untuk non-client).
* **Hari 22:** **DDoS Mitigation:** Konfigurasi Response Rate Limiting (RRL) di BIND9 untuk mencegah serangan Amplification.
* **Hari 23:** **Simulasi Bencana (Failover):** Mematikan service Server 1 secara paksa, memastikan Server 2 mengambil alih query browsing pelanggan dan domain publik tanpa gangguan.
* **Hari 24:** Validasi kepatuhan Kominfo: Uji resolusi domain sampel blacklist (memastikan respon berstatus `NXDOMAIN`).
* **Hari 25:** Deployment resmi Web Control Panel, dokumentasi hand-over tim NOC, dan Go-Live operasional.

---

## 3. Checklist Kriteria Penerimaan (Acceptance Criteria)

- [ ] **Dual-Server Redundancy:** Server Secondary otomatis mereplikasi zone domain ISP dalam waktu < 5 detik setelah diinput di Primary.
- [ ] **Open Resolver Protection:** Query rekursif dari IP publik luar jaringan ISP ditolak secara tegas (`REFUSED`).
- [ ] **RPZ Integrity:** File RPZ yang korup atau terputus saat download tidak boleh merusak konfigurasi BIND9 aktif (mekanisme atomic swap).
- [ ] **Zero Downtime Reload:** Pembaruan ratusan ribu domain Trustpositif tidak boleh mereset DNS cache pelanggan atau menyebabkan kegagalan resolusi.
- [ ] **No Manual Terminal Setup:** Deploy awal pada server baru dapat dieksekusi 100% melalui form Web Panel tanpa intervensi SSH manual oleh teknisi.

---

## 4. Rencana Kontinjensi & Mitigasi Risiko

| Potensi Kendala | Tingkat Risiko | Rencana Mitigasi |
|---|---|---|
| **Feed Kominfo Down/Timeout** | Sedang | Worker menggunakan cache database download terakhir dan menghentikan proses reload tanpa menghapus zone file lama. |
| **Syntax Error pada List Domain** | Tinggi | Validasi wajib menggunakan perintah `named-checkzone` sebelum me-rename file `.tmp` menjadi file aktif. |
| **Beban RAM Server Membengkak** | Sedang | Gunakan pembacaan berbasis ReadStream chunking di Node.js, hindari memuat seluruh isi teks file ke dalam memori variabel. |
| **Kunci TSIG Bocor** | Tinggi | Rahasiakan file `/etc/bind/tsig.key`, gunakan permission `640` dengan owner `root:bind`, dan izinkan transfer zone hanya dari IP Secondary terdaftar. |