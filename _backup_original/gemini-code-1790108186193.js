import http from 'node:http';
import { Client } from 'ssh2';
import crypto from 'node:crypto';

const PORT = 3000;

// Helper eksekusi remote command via SSH
function runRemoteCommand(sshConfig, command) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let output = '';
        let errOutput = '';

        conn.on('ready', () => {
            conn.exec(command, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }
                stream.on('close', (code) => {
                    conn.end();
                    if (code === 0) resolve(output);
                    else reject(new Error(errOutput || `Exit code ${code}`));
                }).on('data', (data) => {
                    output += data.toString();
                }).stderr.on('data', (data) => {
                    errOutput += data.toString();
                });
            });
        }).on('error', (err) => {
            reject(err);
        }).connect({
            host: sshConfig.host,
            port: sshConfig.port || 22,
            username: sshConfig.username || 'root',
            password: sshConfig.password,
            privateKey: sshConfig.privateKey,
            readyTimeout: 30000
        });
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Endpoint Provisioning Server Otomatis
    if (req.method === 'POST' && req.url === '/api/provision') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const config = JSON.parse(body);
                const { primary, secondary, domain, clientAcl } = config;

                // 1. Generate Shared TSIG Secret
                const tsigSecret = crypto.randomBytes(32).toString('base64');

                // 2. Setup Server 1 (Primary / NS1)
                const primaryBash = `
DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y bind9 bind9utils dnsutils curl nodejs

# TSIG Key
cat << 'EOF' > /etc/bind/tsig.key
key "transfer-key" {
    algorithm hmac-sha256;
    secret "${tsigSecret}";
};
EOF
chown root:bind /etc/bind/tsig.key
chmod 640 /etc/bind/tsig.key

# Named Options
cat << 'EOF' > /etc/bind/named.conf.options
acl "isp_clients" {
    127.0.0.1;
    ::1;
    ${clientAcl};
};

options {
    directory "/var/cache/bind";
    listen-on port 53 { any; };
    listen-on-v6 port 53 { any; };
    version "none";
    dnssec-validation auto;
    rate-limit {
        responses-per-second 25;
        window 5;
    };
};
EOF

# Named Local (Split View)
cat << 'EOF' > /etc/bind/named.conf.local
include "/etc/bind/tsig.key";

server ${secondary.host} {
    keys { "transfer-key"; };
};

view "internal-resolver" {
    match-clients { "isp_clients"; };
    recursion yes;
    allow-recursion { "isp_clients"; };
    forwarders { 1.1.1.1; 8.8.8.8; };

    response-policy {
        zone "rpz.kominfo";
    };

    zone "rpz.kominfo" {
        type primary;
        file "/var/lib/bind/kominfo.rpz";
        allow-transfer { key "transfer-key"; };
        notify yes;
    };

    include "/etc/bind/authoritative.zones";
};

view "external-authoritative" {
    match-clients { any; };
    recursion no;
    allow-query { any; };
    include "/etc/bind/authoritative.zones";
};
EOF

# Authoritative Zone
cat << 'EOF' > /etc/bind/authoritative.zones
zone "${domain}" {
    type primary;
    file "/etc/bind/zones/db.${domain}";
    allow-transfer { key "transfer-key"; };
    notify yes;
};
EOF

mkdir -p /etc/bind/zones
cat << 'EOF' > /etc/bind/zones/db.${domain}
\\$TTL 86400
@   IN  SOA ns1.${domain}. hostmaster.${domain}. (
            ${Math.floor(Date.now() / 1000)} 3600 1800 1209600 86400 )
@       IN  NS      ns1.${domain}.
@       IN  NS      ns2.${domain}.
ns1     IN  A       ${primary.host}
ns2     IN  A       ${secondary.host}
@       IN  A       ${primary.host}
EOF

# RPZ Inisialisasi
cat << 'EOF' > /var/lib/bind/kominfo.rpz
\\$TTL 3600
@ IN SOA localhost. root.localhost. ( 1 3h 1h 1w 1h )
  IN NS  localhost.
EOF

chown -R bind:bind /var/lib/bind/ /etc/bind/zones/
systemctl restart named

# Setup Worker RPZ Kominfo
mkdir -p /opt/dns-worker
cat << 'EOF' > /opt/dns-worker/sync.js
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

const URL = 'https://trustpositif.kominfo.go.id/assets/db/domains.txt';
const TMP = '/tmp/kominfo_raw.txt';
const TARGET = '/var/lib/bind/kominfo.rpz';

try {
    execSync(\`curl -s -L "\${URL}" -o \${TMP}\`, { timeout: 300000 });
    const serial = Math.floor(Date.now() / 1000);
    const header = "\\$TTL 3600\\n@ IN SOA localhost. root.localhost. ( " + serial + " 3h 1h 1w 1h )\\n  IN NS localhost.\\n\\n";
    const ws = fs.createWriteStream(TARGET + '.tmp');
    ws.write(header);

    const rl = readline.createInterface({ input: fs.createReadStream(TMP), crlfDelay: Infinity });
    const seen = new Set();

    for await (const line of rl) {
        let d = line.trim().toLowerCase().replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '').trim();
        if (d && !d.startsWith('#') && !d.includes(' ') && d.includes('.') && !seen.has(d)) {
            seen.add(d);
            ws.write(\`\${d} CNAME .\\n*.\${d} CNAME .\\n\`);
        }
    }
    ws.end();
    ws.on('finish', () => {
        execSync(\`named-checkzone rpz.kominfo \${TARGET}.tmp\`);
        fs.renameSync(TARGET + '.tmp', TARGET);
        execSync(\`chown bind:bind \${TARGET}\`);
        execSync(\`rndc reload rpz.kominfo in internal-resolver\`);
    });
} catch (e) {
    console.error(e.message);
}
EOF

(crontab -l 2>/dev/null; echo "0 */6 * * * /usr/bin/node /opt/dns-worker/sync.js >/dev/null 2>&1") | crontab -
`;

                // 3. Setup Server 2 (Secondary / NS2)
                const secondaryBash = `
DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y bind9 bind9utils dnsutils

cat << 'EOF' > /etc/bind/tsig.key
key "transfer-key" {
    algorithm hmac-sha256;
    secret "${tsigSecret}";
};
EOF
chown root:bind /etc/bind/tsig.key
chmod 640 /etc/bind/tsig.key

cat << 'EOF' > /etc/bind/named.conf.options
acl "isp_clients" {
    127.0.0.1;
    ::1;
    ${clientAcl};
};

options {
    directory "/var/cache/bind";
    listen-on port 53 { any; };
    listen-on-v6 port 53 { any; };
    version "none";
    dnssec-validation auto;
    rate-limit {
        responses-per-second 25;
        window 5;
    };
};
EOF

cat << 'EOF' > /etc/bind/named.conf.local
include "/etc/bind/tsig.key";

server ${primary.host} {
    keys { "transfer-key"; };
};

view "internal-resolver" {
    match-clients { "isp_clients"; };
    recursion yes;
    allow-recursion { "isp_clients"; };
    forwarders { 1.1.1.1; 8.8.8.8; };

    response-policy {
        zone "rpz.kominfo";
    };

    zone "rpz.kominfo" {
        type secondary;
        file "/var/lib/bind/kominfo.rpz";
        primaries { ${primary.host}; };
    };

    zone "${domain}" {
        type secondary;
        file "/var/lib/bind/db.${domain}";
        primaries { ${primary.host}; };
    };
};

view "external-authoritative" {
    match-clients { any; };
    recursion no;
    allow-query { any; };

    zone "${domain}" {
        type secondary;
        file "/var/lib/bind/db.${domain}";
        primaries { ${primary.host}; };
    };
};
EOF

systemctl restart named
`;

                // Eksekusi paralel ke Server 1 dan Server 2
                await Promise.all([
                    runRemoteCommand(primary, primaryBash),
                    runRemoteCommand(secondary, secondaryBash)
                ]);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', message: 'Kedua server BIND9 berhasil di-deploy dan disinkronkan!' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: err.message }));
            }
        });
        return;
    }

    // Serve Single-Page UI
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_DASHBOARD);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const HTML_DASHBOARD = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <title>ISP DNS Auto-Deployer</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-8 font-sans">
    <div class="max-w-4xl mx-auto space-y-6">
        <div>
            <h1 class="text-3xl font-bold text-sky-400">DNS Infrastructure Orchestrator</h1>
            <p class="text-sm text-slate-400">Setup dual-node BIND9 (Primary & Secondary), TSIG Key, RPZ Kominfo langsung via SSH</p>
        </div>

        <form id="setupForm" onsubmit="handleDeploy(event)" class="space-y-6 bg-slate-800 p-6 rounded-xl border border-slate-700">
            <!-- Global Config -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-b border-slate-700 pb-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Domain ISP</label>
                    <input id="domain" required placeholder="ispanda.net.id" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Subnet Pelanggan (ACL)</label>
                    <input id="clientAcl" required placeholder="103.100.50.0/24; 10.0.0.0/8;" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                </div>
            </div>

            <!-- Server 1 & Server 2 Credentials -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Server 1 -->
                <div class="space-y-3 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <h3 class="font-bold text-sky-400 text-sm">Primary Node (NS1 + RPZ Worker)</h3>
                    <input id="pHost" required placeholder="IP Server 1" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                    <input id="pUser" required value="root" placeholder="SSH Username" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                    <input id="pPass" type="password" required placeholder="SSH Root Password" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                </div>

                <!-- Server 2 -->
                <div class="space-y-3 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                    <h3 class="font-bold text-sky-400 text-sm">Secondary Node (NS2 Slave)</h3>
                    <input id="sHost" required placeholder="IP Server 2" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                    <input id="sUser" required value="root" placeholder="SSH Username" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                    <input id="sPass" type="password" required placeholder="SSH Root Password" class="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm">
                </div>
            </div>

            <button id="btnSubmit" type="submit" class="w-full bg-sky-600 hover:bg-sky-500 font-semibold py-3 rounded-lg transition duration-200">
                Deploy & Konfigurasi Kedua Server Sekarang
            </button>
        </form>

        <div id="statusBox" class="hidden p-4 rounded-lg text-sm border font-mono whitespace-pre-wrap"></div>
    </div>

    <script>
        async function handleDeploy(e) {
            e.preventDefault();
            const btn = document.getElementById('btnSubmit');
            const box = document.getElementById('statusBox');

            btn.disabled = true;
            btn.innerText = 'Memproses instalasi ke kedua server... (Bisa memakan waktu 1-2 menit)';
            box.className = 'p-4 rounded-lg text-sm border font-mono bg-slate-800 border-sky-600 text-sky-300';
            box.innerText = '[*] Menginisiasi koneksi SSH ke Server 1 dan Server 2...\\n[*] Memasang BIND9 & Mengatur Split-Horizon Views...\\n[*] Mengaitkan TSIG Key & Replikasi Slave...';
            box.classList.remove('hidden');

            const payload = {
                domain: document.getElementById('domain').value.trim(),
                clientAcl: document.getElementById('clientAcl').value.trim(),
                primary: {
                    host: document.getElementById('pHost').value.trim(),
                    username: document.getElementById('pUser').value.trim(),
                    password: document.getElementById('pPass').value
                },
                secondary: {
                    host: document.getElementById('sHost').value.trim(),
                    username: document.getElementById('sUser').value.trim(),
                    password: document.getElementById('sPass').value
                }
            };

            try {
                const res = await fetch('/api/provision', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (res.ok) {
                    box.className = 'p-4 rounded-lg text-sm border font-mono bg-emerald-950/50 border-emerald-500 text-emerald-300';
                    box.innerText = '[+] SUCCESS:\\n' + data.message;
                } else {
                    box.className = 'p-4 rounded-lg text-sm border font-mono bg-rose-950/50 border-rose-500 text-rose-300';
                    box.innerText = '[-] ERROR:\\n' + data.message;
                }
            } catch (err) {
                box.className = 'p-4 rounded-lg text-sm border font-mono bg-rose-950/50 border-rose-500 text-rose-300';
                box.innerText = '[-] NETWORK ERROR:\\n' + err.message;
            } finally {
                btn.disabled = false;
                btn.innerText = 'Deploy & Konfigurasi Kedua Server Sekarang';
            }
        }
    </script>
</body>
</html>`;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[+] DNS Orchestrator Panel berjalan di http://localhost:${PORT}`);
});