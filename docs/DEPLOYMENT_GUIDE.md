# Panduan Lengkap Deployment Production: ISP DNS & Web Control Panel

Dokumentasi ini adalah panduan langkah demi langkah (*step-by-step production runbook*) untuk memasang dan menjalankan **Web Control Panel**, **Worker Sinkronisasi RPZ Kominfo**, serta **Server DNS Dual-Node BIND9** di lingkungan server Linux Ubuntu / Debian.

---

## Daftar Isi
1. [Arsitektur Deployment](#1-arsitektur-deployment)
2. [Prasyarat Server](#2-prasyarat-server)
3. [Panduan Deploy Web Control Panel (Utama)](#3-panduan-deploy-web-control-panel-utama)
   - [Langkah 1: Upload File Proyek ke Server](#langkah-1-upload-file-proyek-ke-server)
   - [Langkah 2: Instalasi Runtime Node.js & Dependensi](#langkah-2-instalasi-runtime-nodejs--dependensi)
   - [Langkah 3: Konfigurasi Environment (.env)](#langkah-3-konfigurasi-environment-env)
   - [Langkah 4: Setup Linux Systemd Service (Auto-Start & Auto-Restart)](#langkah-4-setup-linux-systemd-service-auto-start--auto-restart)
   - [Langkah 5: Konfigurasi Reverse Proxy Nginx & SSL HTTPS (Sangat Direkomendasikan)](#langkah-5-konfigurasi-reverse-proxy-nginx--ssl-https-sangat-direkomendasikan)
   - [Langkah 6: Firewall Hardening (UFW)](#langkah-6-firewall-hardening-ufw)
4. [Panduan Deploy DNS Server BIND9 (Primary & Secondary)](#4-panduan-deploy-dns-server-bind9-primary--secondary)
   - [Setup Server 1 (Primary / NS1)](#setup-server-1-primary--ns1)
   - [Setup Server 2 (Secondary / NS2)](#setup-server-2-secondary--ns2)
   - [Generasi Kunci TSIG untuk Zone Transfer](#generasi-kunci-tsig-untuk-zone-transfer)
5. [Otomatisasi Sinkronisasi RPZ Kominfo via Cronjob](#5-otomatisasi-sinkronisasi-rpz-kominfo-via-cronjob)
6. [Verifikasi Pasca-Deployment (Post-Flight Check)](#6-verifikasi-pasca-deployment-post-flight-check)
7. [Troubleshooting & Pemeliharaan Harian](#7-troubleshooting--pemeliharaan-harian)

---

## 1. Arsitektur Deployment

Sistem ini mendukung 2 skema pemasangan:

### Skema A: Panel Standalone Terpisah (Best Practice ISP Modern) 🌟
- **Server Panel (NOC/Internal):** `192.168.10.50` (atau IP Publik terisolasi) menjalankan Web Control Center.
- **Server DNS 1 (Primary/NS1):** `103.100.50.2` (BIND9 Master).
- **Server DNS 2 (Secondary/NS2):** `103.100.50.3` (BIND9 Slave).

### Skema B: Panel Co-located di Server Primary
- Web Panel dan BIND9 Master sama-sama berjalan di **Server 1 (`103.100.50.2`)**.

---

## 2. Prasyarat Server

Pastikan server Anda memenuhi spesifikasi minimum berikut:
- **Sistem Operasi:** Ubuntu 22.04 LTS / Ubuntu 24.04 LTS atau Debian 11/12.
- **Hardware Minimum Web Panel:** 1 vCPU, 1 GB RAM, 10 GB Disk.
- **Hardware Minimum DNS BIND9 (dengan RPZ 800k+ domain):** 2 vCPU, 2 GB - 4 GB RAM, 20 GB SSD.

---

## 3. Panduan Deploy Web Control Panel (Utama)

### Langkah 1: Clone Repository dari GitHub ke Server Production
Masuk ke terminal server Linux (VPS / Baremetal) Anda via SSH, kemudian clone langsung dari repository GitHub ke direktori standar `/opt/dns-panel`:

```bash
# Buat direktori aplikasi dan atur hak kepemilikan user Anda
sudo mkdir -p /opt/dns-panel
sudo chown -R $USER:$USER /opt/dns-panel

# Clone repository langsung dari GitHub
git clone https://github.com/risky-budiman/dns-server-panel.git /opt/dns-panel

# Masuk ke direktori proyek
cd /opt/dns-panel
```

> [!TIP]
> **Cara Update Kode Produksi (CI/CD Ringan via Git):**
> Kapan pun Anda melakukan update di lokal dan melakukan `git push origin main`, Anda cukup memperbarui server produksi dengan satu baris perintah:
> ```bash
> cd /opt/dns-panel && git pull origin main && sudo systemctl restart dns-panel
> ```

---

### Langkah 2: Instalasi Runtime Node.js & Dependensi
Pasang Node.js LTS (Versi 20 atau 22):

```bash
# Update repository
sudo apt update && sudo apt install -y curl ufw git build-essential

# Pasang Node.js versi 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi versi
node -v    # Harus v20.x atau lebih baru
npm -v

# Di folder /opt/dns-panel, install dependensi (ssh2)
cd /opt/dns-panel
npm install --production
```

---

### Langkah 3: Konfigurasi Environment (.env)
Buat file konfigurasi environment produksi:

```bash
cat << 'EOF' > /opt/dns-panel/.env
PORT=3000
HOST=127.0.0.1
ZONE_DOMAIN=ispanda.net.id
PRIMARY_IP=103.100.50.2
SECONDARY_IP=103.100.50.3
ZONE_FILE_PATH=/etc/bind/zones/db.ispanda.net.id
TARGET_RPZ=/var/lib/bind/kominfo.rpz
KOMINFO_FEED_URL=https://trustpositif.kominfo.go.id/assets/db/domains.txt
ADMIN_USER=admin
ADMIN_PASS=GantiDenganSandiKuatISP2026!
AUTH_TOKEN_SECRET=kunci-rahasia-random-string-hash-32-karakter-min
EOF

# Kunci permission agar hanya bisa dibaca pemilik file
chmod 600 /opt/dns-panel/.env
```

---

### Langkah 4: Setup Linux Systemd Service (Auto-Start & Auto-Restart)
Agar Web Panel otomatis menyala saat server restart dan otomatis hidup kembali jika terjadi crash:

1. Buat unit file systemd:
```bash
sudo tee /etc/systemd/system/dns-panel.service << 'EOF'
[Unit]
Description=ISP DNS Control Center & Orchestrator Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/dns-panel
EnvironmentFile=/opt/dns-panel/.env
ExecStart=/usr/bin/node /opt/dns-panel/src/server.js
Restart=always
RestartSec=5
LimitNOFILE=65535

# Proteksi memori agar tidak membengkak
Environment=NODE_OPTIONS="--max-old-space-size=512"

[Install]
WantedBy=multi-user.target
EOF
```

2. Aktifkan dan jalankan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable dns-panel
sudo systemctl restart dns-panel

# Cek status service
sudo systemctl status dns-panel
```

---

### Langkah 5: Konfigurasi Reverse Proxy Nginx & SSL HTTPS (Sangat Direkomendasikan)
Jangan mengekspos Port 3000 langsung tanpa enkripsi. Gunakan Nginx dengan SSL HTTPS (Let's Encrypt):

```bash
# 1. Pasang Nginx dan Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# 2. Buat konfigurasi vhost Nginx
sudo tee /etc/nginx/sites-available/dns-panel << 'EOF'
server {
    listen 80;
    server_name panel-dns.ispanda.net.id; # Ganti dengan domain/subdomain Anda

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeout handling untuk proses sync besar
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }
}
EOF

# 3. Aktifkan site dan uji konfigurasi
sudo ln -s /etc/nginx/sites-available/dns-panel /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# 4. Pasang SSL Gratis (Let's Encrypt)
sudo certbot --nginx -d panel-dns.ispanda.net.id --non-interactive --agree-tos -m noc@ispanda.net.id
```

Sekarang panel dapat diakses secara aman di: **`https://panel-dns.ispanda.net.id`**

---

### Langkah 6: Firewall Hardening (UFW)
Kunci port firewall server:
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS

# Aktifkan UFW
sudo ufw enable
```

---

## 4. Panduan Deploy DNS Server BIND9 (Primary & Secondary)

Jika Anda melakukan setup manual pada kedua node DNS:

### Setup Server 1 (Primary / NS1: `103.100.50.2`)
1. **Pasang paket BIND9:**
   ```bash
   sudo apt update && sudo apt install -y bind9 bind9utils dnsutils
   ```
2. **Salin template konfigurasi dari proyek:**
   ```bash
   sudo cp config/named.conf.options /etc/bind/named.conf.options
   sudo cp config/primary/named.conf.local /etc/bind/named.conf.local
   sudo cp config/primary/authoritative.zones /etc/bind/authoritative.zones
   sudo mkdir -p /etc/bind/zones /var/lib/bind
   sudo cp config/zones/db.ispanda.net.id /etc/bind/zones/db.ispanda.net.id
   ```
3. **Inisialisasi file RPZ kosong awal:**
   ```bash
   sudo bash scripts/init-rpz.sh
   ```
4. **Perbaiki permission hak akses:**
   ```bash
   sudo chown -R bind:bind /etc/bind/zones /var/lib/bind
   sudo chmod 775 /var/lib/bind
   ```
5. **Cek sintaks dan restart BIND9:**
   ```bash
   sudo named-checkconf
   sudo systemctl restart named
   ```

---

### Setup Server 2 (Secondary / NS2: `103.100.50.3`)
1. **Pasang paket BIND9:**
   ```bash
   sudo apt update && sudo apt install -y bind9 bind9utils dnsutils
   ```
2. **Salin konfigurasi Secondary:**
   ```bash
   sudo cp config/named.conf.options /etc/bind/named.conf.options
   sudo cp config/secondary/named.conf.local /etc/bind/named.conf.local
   sudo mkdir -p /var/lib/bind
   sudo chown -R bind:bind /var/lib/bind
   ```
3. **Cek sintaks dan restart:**
   ```bash
   sudo named-checkconf
   sudo systemctl restart named
   ```

---

### Generasi Kunci TSIG untuk Zone Transfer
Kedua server wajib memiliki kunci yang sama agar Secondary diizinkan mereplikasi zona:
```bash
# Generate secret baru:
tsig-keygen -a hmac-sha256 transfer-key

# Letakkan hasilnya di kedua server pada file: /etc/bind/tsig.key
sudo chmod 640 /etc/bind/tsig.key
sudo chown root:bind /etc/bind/tsig.key
```

---

## 5. Otomatisasi Sinkronisasi RPZ Kominfo via Cronjob

Agar database Trustpositif Kominfo otomatis diperbarui secara berkala (misalnya setiap 6 jam sekali pada jam 00:00, 06:00, 12:00, 18:00):

Buka cron server BIND9 Primary:
```bash
sudo crontab -e
```
Tambahkan baris berikut di bagian paling bawah:
```cron
# Sinkronisasi RPZ Trustpositif Kominfo setiap 6 jam
0 */6 * * * cd /opt/dns-panel && /usr/bin/node --max-old-space-size=512 src/rpz-worker.js >> /var/log/rpz-sync.log 2>&1
```

---

## 6. Verifikasi Pasca-Deployment (Post-Flight Check)

Setelah seluruh instalasi selesai, lakukan 4 langkah validasi ini:

### 1. Uji Login & Akses Web Panel
- Buka browser ke alamat domain/IP panel Anda.
- Login menggunakan akun default:
  - Super Admin: `admin` / Password yang Anda setel di `.env`
  - Operator: `operator1` / `operator2026`
  - Auditor: `auditor1` / `auditor2026`

### 2. Uji Status Sinkronisasi RPZ
- Buka tab **"Trustpositif Kominfo (RPZ)"**, lalu klik tombol **"🔄 Sync Kominfo Now"**.
- Pastikan Total Domain terisi ratusan ribu domain dan Serial Zone naik.

### 3. Uji Replikasi Master-Slave (AXFR)
Di Server Secondary (NS2), pastikan transfer zona berhasil ditarik dari Primary:
```bash
sudo rndc retransfer ispanda.net.id
# Cek isi file hasil replikasi otomatis:
ls -l /var/lib/bind/
```

### 4. Uji Anti-Open Resolver (Kepatuhan Keamanan ISP)
Uji dari IP publik luar (bukan dari subnet ISP):
```bash
dig @103.100.50.2 google.com
```
*Respon status wajib: **`REFUSED`** (artinya server aman dan tidak bisa dimanfaatkan untuk serangan DDoS Amplification).*

---

## 7. Troubleshooting & Pemeliharaan Harian

| Gejala Insiden | Penyebab Umum | Solusi Cepat |
|---|---|---|
| **Web Panel status 502 Bad Gateway** | Node.js service mati | Jalankan `sudo systemctl status dns-panel` dan cek log via `sudo journalctl -u dns-panel -n 50`. |
| **Error "Permission Denied" saat Sync RPZ** | User node tidak bisa menulis ke folder BIND | Jalankan `sudo chown -R bind:bind /var/lib/bind /etc/bind/zones && sudo chmod 775 /var/lib/bind`. |
| **Secondary tidak mau sinkron dari Primary** | TSIG secret beda atau port 53 TCP tertutup firewall | Pastikan isi `/etc/bind/tsig.key` identik di kedua node dan firewall mengizinkan Port 53 TCP antar kedua IP server. |
| **Pelanggan tidak bisa browsing** | Subnet klien belum didaftarkan di ACL | Tambahkan subnet IP pelanggan ISP Anda pada blok `acl "isp_clients"` di file `/etc/bind/named.conf.options`, lalu jalankan `rndc reconfig`. |
| **Memory Server membengkak saat update** | Node.js menggunakan buffer RAM berlebih | Pastikan perintah eksekusi selalu menyertakan flag `--max-old-space-size=512`. |
EOF
