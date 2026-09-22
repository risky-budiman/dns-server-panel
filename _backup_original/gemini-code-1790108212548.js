import fs from 'node:fs';
import { execSync } from 'node:child_process';
import readline from 'node:readline';

const KOMINFO_URL = '[https://trustpositif.kominfo.go.id/assets/db/domains.txt](https://trustpositif.kominfo.go.id/assets/db/domains.txt)';
const TEMP_RAW = '/tmp/kominfo_raw.txt';
const TARGET_RPZ = '/var/lib/bind/kominfo.rpz';

async function runSync() {
    console.log('[*] Memulai sinkronisasi RPZ Kominfo...');
    try {
        execSync(`curl -s -L "${KOMINFO_URL}" -o ${TEMP_RAW}`, { timeout: 300000 });
    } catch (err) {
        console.error('[-] Gagal fetch list Kominfo:', err.message);
        return;
    }

    const serial = Math.floor(Date.now() / 1000);
    const header = [
        '$TTL 3600',
        `@ IN SOA localhost. root.localhost. ( ${serial} 3h 1h 1w 1h )`,
        '  IN NS  localhost.',
        '',
        '; Auto-generated RPZ Trustpositif Zone File',
        ''
    ].join('\n');

    const writeStream = fs.createWriteStream(TARGET_RPZ + '.tmp', { flags: 'w' });
    writeStream.write(header);

    const fileStream = fs.createReadStream(TEMP_RAW);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const seenDomains = new Set();
    let count = 0;

    for await (const line of rl) {
        let domain = line.trim().toLowerCase();
        domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();

        if (!domain || domain.startsWith('#') || domain.includes(' ') || !domain.includes('.')) {
            continue;
        }

        if (!seenDomains.has(domain)) {
            seenDomains.add(domain);
            writeStream.write(`${domain} CNAME .\n*.${domain} CNAME .\n`);
            count++;
        }
    }

    writeStream.end();

    writeStream.on('finish', () => {
        try {
            execSync(`named-checkzone rpz.kominfo ${TARGET_RPZ}.tmp`);
            fs.renameSync(TARGET_RPZ + '.tmp', TARGET_RPZ);
            execSync(`chown bind:bind ${TARGET_RPZ}`);
            execSync(`rndc reload rpz.kominfo in internal-resolver`);
            console.log(`[+] Sinkronisasi sukses. Total domain aktif: ${count}`);
        } catch (e) {
            console.error('[-] Sintaks RPZ gagal divalidasi:', e.message);
        }
    });
}

runSync();