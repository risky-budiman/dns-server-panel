import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PORT = 3000;
const ZONE_FILE_PATH = '/etc/bind/zones/db.ispanda.net.id';

function parseRecords() {
    if (!fs.existsSync(ZONE_FILE_PATH)) return [];
    const content = fs.readFileSync(ZONE_FILE_PATH, 'utf-8');
    const lines = content.split('\n');
    const records = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('$') || trimmed.startsWith('@')) continue;
        
        // Parsing record format: name IN type target
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 4 && parts[1] === 'IN') {
            records.push({ name: parts[0], type: parts[2], target: parts[3] });
        }
    }
    return records;
}

function updateZoneFile(newRecords) {
    const serial = Math.floor(Date.now() / 1000);
    let content = `$TTL 86400
@   IN  SOA ns1.ispanda.net.id. hostmaster.ispanda.net.id. (
            ${serial} ; Serial auto-increment
            3600 1800 1209600 86400 )

@       IN  NS      ns1.ispanda.net.id.
@       IN  NS      ns2.ispanda.net.id.

ns1     IN  A       103.100.50.2
ns2     IN  A       103.100.50.3
`;

    for (const r of newRecords) {
        content += `${r.name.padEnd(10)} IN  ${r.type.padEnd(6)} ${r.target}\n`;
    }

    fs.writeFileSync(ZONE_FILE_PATH, content);
    execSync(`named-checkzone ispanda.net.id ${ZONE_FILE_PATH}`);
    execSync(`rndc reload ispanda.net.id`);
}

const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Endpoint API: Ambil Records
    if (req.method === 'GET' && req.url === '/api/records') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(parseRecords()));
        return;
    }

    // Endpoint API: Tambah Record
    if (req.method === 'POST' && req.url === '/api/records') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const newRecord = JSON.parse(body);
                const current = parseRecords();
                current.push(newRecord);
                updateZoneFile(current);

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Record ditambahkan dan zone disinkronkan' }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Endpoint API: Trigger Sync Kominfo Manual
    if (req.method === 'POST' && req.url === '/api/rpz/sync') {
        try {
            execSync(`node /opt/dns-panel/worker/sync-kominfo.js &`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Proses sinkronisasi RPZ berjalan di latar belakang.' }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // Serve Static Frontend
    if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_UI);
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

const HTML_UI = `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ISP DNS Control Center</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6 font-sans">
    <div class="max-w-5xl mx-auto space-y-6">
        <header class="flex justify-between items-center border-b border-slate-800 pb-4">
            <div>
                <h1 class="text-2xl font-bold text-sky-400">ISP DNS Control Center</h1>
                <p class="text-sm text-slate-400">Primary: 103.100.50.2 (NS1) | Secondary: 103.100.50.3 (NS2)</p>
            </div>
            <button onclick="triggerRpzSync()" class="bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded font-medium text-sm transition">
                Sync Kominfo RPZ
            </button>
        </header>

        <!-- Form Tambah Record -->
        <div class="bg-slate-800 p-5 rounded-lg border border-slate-700 space-y-4">
            <h2 class="text-lg font-semibold">Pointing Domain (ispanda.net.id)</h2>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input id="recName" placeholder="Subdomain (misal: mail)" class="bg-slate-900 border border-slate-700 px-3 py-2 rounded focus:outline-none focus:border-sky-500">
                <select id="recType" class="bg-slate-900 border border-slate-700 px-3 py-2 rounded focus:outline-none focus:border-sky-500">
                    <option value="A">A Record (IPv4)</option>
                    <option value="CNAME">CNAME</option>
                    <option value="TXT">TXT</option>
                </select>
                <input id="recTarget" placeholder="Target / IP Address" class="bg-slate-900 border border-slate-700 px-3 py-2 rounded focus:outline-none focus:border-sky-500">
                <button onclick="addRecord()" class="bg-sky-600 hover:bg-sky-500 font-semibold py-2 rounded transition">Simpan Record</button>
            </div>
        </div>

        <!-- Tabel Record Aktif -->
        <div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="bg-slate-700/50 text-slate-400 text-sm">
                        <th class="p-3">Host / Subdomain</th>
                        <th class="p-3">Tipe</th>
                        <th class="p-3">Target Value</th>
                    </tr>
                </thead>
                <tbody id="recordTableBody" class="divide-y divide-slate-700 text-sm">
                    <tr><td colspan="3" class="p-4 text-center text-slate-500">Memuat data record...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <script>
        async function fetchRecords() {
            const res = await fetch('/api/records');
            const data = await res.json();
            const tbody = document.getElementById('recordTableBody');
            tbody.innerHTML = data.map(r => \`
                <tr>
                    <td class="p-3 font-mono text-sky-300">\${r.name}.ispanda.net.id</td>
                    <td class="p-3"><span class="bg-slate-700 px-2 py-0.5 rounded text-xs">\${r.type}</span></td>
                    <td class="p-3 font-mono text-slate-300">\${r.target}</td>
                </tr>
            \`).join('') || '<tr><td colspan="3" class="p-4 text-center text-slate-500">Belum ada record custom.</td></tr>';
        }

        async function addRecord() {
            const name = document.getElementById('recName').value.trim();
            const type = document.getElementById('recType').value;
            const target = document.getElementById('recTarget').value.trim();
            if (!name || !target) return alert('Semua form wajib diisi!');

            await fetch('/api/records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type, target })
            });
            document.getElementById('recName').value = '';
            document.getElementById('recTarget').value = '';
            fetchRecords();
        }

        async function triggerRpzSync() {
            const res = await fetch('/api/rpz/sync', { method: 'POST' });
            const data = await res.json();
            alert(data.message);
        }

        fetchRecords();
    </script>
</body>
</html>`;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[+] DNS Web Panel aktif di http://0.0.0.0:${PORT}`);
});