import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { CONFIG } from './config.js';

export class ZoneManager {
    static getZoneSettings() {
        if (fs.existsSync(CONFIG.ZONE_SETTINGS_FILE)) {
            try {
                const s = JSON.parse(fs.readFileSync(CONFIG.ZONE_SETTINGS_FILE, 'utf-8'));
                return {
                    domain: s.domain || CONFIG.ZONE_DOMAIN,
                    primaryNS: s.primaryNS || `ns1.${CONFIG.ZONE_DOMAIN}`,
                    secondaryNS: s.secondaryNS || `ns2.${CONFIG.ZONE_DOMAIN}`,
                    hostmaster: s.hostmaster || `hostmaster.${CONFIG.ZONE_DOMAIN}`,
                    defaultTTL: s.defaultTTL || 86400,
                    refresh: s.refresh || 3600,
                    retry: s.retry || 1800,
                    expire: s.expire || 1209600,
                    minTTL: s.minTTL || 86400,
                    serial: s.serial || Math.floor(Date.now() / 1000)
                };
            } catch {}
        }
        return {
            domain: CONFIG.ZONE_DOMAIN,
            primaryNS: `ns1.${CONFIG.ZONE_DOMAIN}`,
            secondaryNS: `ns2.${CONFIG.ZONE_DOMAIN}`,
            hostmaster: `hostmaster.${CONFIG.ZONE_DOMAIN}`,
            defaultTTL: 86400,
            refresh: 3600,
            retry: 1800,
            expire: 1209600,
            minTTL: 86400,
            serial: Math.floor(Date.now() / 1000)
        };
    }

    static saveZoneSettings(settings) {
        fs.writeFileSync(CONFIG.ZONE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
    }

    static getZonePath() {
        if (fs.existsSync(CONFIG.ZONE_FILE_PATH)) {
            return CONFIG.ZONE_FILE_PATH;
        }
        return CONFIG.FALLBACK_ZONE_PATH;
    }

    /**
     * Membaca seluruh record DNS secara komprehensif (SOA, NS, A, AAAA, CNAME, MX, TXT)
     * persis format tabel Hurricane Electric / cPanel
     */
    static parseRecords() {
        const filePath = this.getZonePath();
        const settings = this.getZoneSettings();
        const records = [];

        if (!fs.existsSync(filePath)) return records;

        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        let defaultTTL = settings.defaultTTL || 86400;

        let inSOA = false;
        let inParenTXT = false;
        let txtBuffer = '';
        const processedLines = [];

        for (const line of lines) {
            // Hilangkan komentar inline ';'
            const cleanLine = line.replace(/;.*$/, '').trim();
            if (!cleanLine) continue;

            if (cleanLine.startsWith('$TTL')) {
                const ttlParts = cleanLine.split(/\s+/);
                if (ttlParts[1]) defaultTTL = parseInt(ttlParts[1], 10) || defaultTTL;
                continue;
            }

            // Tangani blok SOA (bisa 1 baris atau multiline dengan kurung)
            if (cleanLine.includes('SOA')) {
                if (cleanLine.includes('(') && !cleanLine.includes(')')) {
                    inSOA = true;
                }
                continue;
            }
            if (inSOA) {
                if (cleanLine.includes(')')) {
                    inSOA = false;
                }
                continue;
            }

            // Tangani multiline TXT / DKIM yang dibungkus tanda kurung ( ... )
            if (!inParenTXT) {
                if (cleanLine.includes('(') && !cleanLine.includes(')')) {
                    inParenTXT = true;
                    txtBuffer = cleanLine.replace('(', ' ');
                } else {
                    processedLines.push(cleanLine.replace('(', ' ').replace(')', ' ').trim());
                }
            } else {
                txtBuffer += ' ' + cleanLine.replace(')', ' ');
                if (cleanLine.includes(')')) {
                    inParenTXT = false;
                    processedLines.push(txtBuffer.trim());
                    txtBuffer = '';
                }
            }
        }

        // Valid record types in BIND9 zone
        const validTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA'];

        for (const cleanLine of processedLines) {
            // Pattern: [Name] [TTL]? [Class]? [Type] [Priority]? [Data...]
            const tokens = cleanLine.split(/\s+/);
            if (tokens.length < 3) continue;

            let name = tokens[0];
            let idx = 1;
            let ttl = defaultTTL;

            // Cek jika token berikutnya adalah angka TTL
            if (/^\d+$/.test(tokens[idx])) {
                ttl = parseInt(tokens[idx], 10);
                idx++;
            }

            // Cek jika ada token 'IN'
            if (tokens[idx] && tokens[idx].toUpperCase() === 'IN') {
                idx++;
            }

            if (!tokens[idx]) continue;
            const type = tokens[idx].toUpperCase();
            if (!validTypes.includes(type)) continue;
            idx++;

            let priority = '-';
            if (type === 'MX' && tokens[idx] && /^\d+$/.test(tokens[idx])) {
                priority = parseInt(tokens[idx], 10);
                idx++;
            }

            let data = tokens.slice(idx).join(' ');
            if (!data) continue;

            // Bersihkan tanda kurung dan pecahan kutip ganda multiline (seperti string DKIM: "chunk1" "chunk2")
            data = data.replace(/[()]/g, '').trim();
            data = data.replace(/"\s+"/g, '');
            if (data.startsWith('"') && data.endsWith('"')) {
                data = data.slice(1, -1);
            }

            // Bersihkan trailing dot pada data hostname (NS, CNAME, MX, PTR) untuk konsistensi tampilan UI
            if (['NS', 'CNAME', 'MX', 'PTR'].includes(type) && data.endsWith('.')) {
                data = data.slice(0, -1);
            }

            // Normalisasi name ke FQDN dan cegah domain ganda (misal: ids.net.id.ids.net.id)
            let fqdn = name;
            const domainLower = (settings.domain || '').toLowerCase();
            const nameLower = name.toLowerCase();

            if (name === '@' || nameLower === domainLower || nameLower === `${domainLower}.`) {
                name = '@';
                fqdn = settings.domain;
            } else if (nameLower.endsWith(`.${domainLower}`)) {
                fqdn = name;
                name = name.slice(0, -(domainLower.length + 1));
            } else if (nameLower.endsWith(`.${domainLower}.`)) {
                fqdn = name.slice(0, -1);
                name = name.slice(0, -(domainLower.length + 2));
            } else if (!name.endsWith('.')) {
                fqdn = `${name}.${settings.domain}`;
            } else {
                fqdn = name.replace(/\.$/, '');
            }

            records.push({
                name,
                fqdn,
                type,
                ttl,
                priority,
                data,
                ddns: false
            });
        }

        // Urutkan record DNS identik dengan Hurricane Electric:
        // NS record selalu paling atas berurutan tepat di bawah SOA, diikuti A, AAAA, MX, CNAME, TXT, dll.
        const typePriority = {
            'NS': 1,
            'A': 2,
            'AAAA': 3,
            'MX': 4,
            'CNAME': 5,
            'TXT': 6,
            'PTR': 7,
            'SRV': 8,
            'CAA': 9
        };

        records.sort((a, b) => {
            const pA = typePriority[a.type] || 99;
            const pB = typePriority[b.type] || 99;
            if (pA !== pB) return pA - pB;
            if (a.type === 'MX' && b.type === 'MX') {
                const prioA = parseInt(a.priority, 10) || 10;
                const prioB = parseInt(b.priority, 10) || 10;
                if (prioA !== prioB) return prioA - prioB;
            }
            if (a.fqdn === b.fqdn) {
                return (a.data || '').localeCompare(b.data || '');
            }
            return a.fqdn.localeCompare(b.fqdn);
        });

        return records;
    }

    /**
     * Menyusun file zone BIND9 lengkap dan valid
     */
    static updateZoneFile(newRecords, updatedSettings = null) {
        const filePath = this.getZonePath();
        const settings = updatedSettings || this.getZoneSettings();
        const serial = Math.floor(Date.now() / 1000);
        settings.serial = serial;
        this.saveZoneSettings(settings);

        const domain = settings.domain;
        const primaryNS = settings.primaryNS.endsWith('.') ? settings.primaryNS : `${settings.primaryNS}.`;
        const hostmaster = settings.hostmaster.endsWith('.') ? settings.hostmaster : `${settings.hostmaster}.`;

        // Filter dan urutkan records (NS paling atas)
        const typePriority = {
            'NS': 1,
            'A': 2,
            'AAAA': 3,
            'MX': 4,
            'CNAME': 5,
            'TXT': 6,
            'PTR': 7,
            'SRV': 8,
            'CAA': 9
        };

        // Jika tidak ada record NS sama sekali, inisialisasi NS primer & sekunder dari settings
        const hasNS = newRecords.some(r => r.type === 'NS');
        let recordsToWrite = [...newRecords];
        if (!hasNS) {
            recordsToWrite.unshift(
                { name: '@', fqdn: domain, type: 'NS', ttl: settings.defaultTTL || 86400, priority: '-', data: primaryNS },
                { name: '@', fqdn: domain, type: 'NS', ttl: settings.defaultTTL || 86400, priority: '-', data: settings.secondaryNS.endsWith('.') ? settings.secondaryNS : `${settings.secondaryNS}.` }
            );
        }

        recordsToWrite.sort((a, b) => {
            const pA = typePriority[a.type] || 99;
            const pB = typePriority[b.type] || 99;
            if (pA !== pB) return pA - pB;
            if (a.type === 'MX' && b.type === 'MX') {
                const prioA = parseInt(a.priority, 10) || 10;
                const prioB = parseInt(b.priority, 10) || 10;
                if (prioA !== prioB) return prioA - prioB;
            }
            if (a.fqdn === b.fqdn) {
                return (a.data || '').localeCompare(b.data || '');
            }
            return (a.fqdn || a.name).localeCompare(b.fqdn || b.name);
        });

        let content = `$TTL ${settings.defaultTTL || 86400}
@   IN  SOA ${primaryNS} ${hostmaster} (
            ${serial} ; Serial auto-increment (Epoch)
            ${settings.refresh || 3600} ; Refresh
            ${settings.retry || 1800} ; Retry
            ${settings.expire || 1209600} ; Expire
            ${settings.minTTL || 86400} ) ; Minimum TTL
`;

        let currentSection = '';

        for (const r of recordsToWrite) {
            if (r.type === 'SOA') continue;

            // Header bagian
            if (r.type === 'NS' && currentSection !== 'NS') {
                content += `\n; Nameservers (NS Records)\n`;
                currentSection = 'NS';
            } else if (r.type !== 'NS' && currentSection !== 'RECORDS') {
                content += `\n; Zone Records\n`;
                currentSection = 'RECORDS';
            }

            let name = r.name || '@';
            const domainLower = domain.toLowerCase();
            const nameLower = name.toLowerCase();

            if (nameLower === domainLower || nameLower === `${domainLower}.` || name === '') {
                name = '@';
            } else if (nameLower.endsWith(`.${domainLower}`)) {
                name = name.slice(0, -(domainLower.length + 1));
            } else if (nameLower.endsWith(`.${domainLower}.`)) {
                name = name.slice(0, -(domainLower.length + 2));
            }

            let data = r.data || r.target;
            // Pastikan hostname target (NS, CNAME, MX, PTR) selalu memiliki titik penutup di zone file BIND9
            if (['NS', 'CNAME', 'MX', 'PTR'].includes(r.type)) {
                if (data && !data.endsWith('.') && data.includes('.')) {
                    data = `${data}.`;
                }
            }

            const ttlStr = r.ttl ? `${r.ttl}`.padEnd(7) : '       ';
            const typeStr = r.type.padEnd(6);
            
            if (r.type === 'MX') {
                const prio = r.priority !== '-' ? r.priority : 10;
                content += `${name.padEnd(16)} ${ttlStr} IN  ${typeStr} ${prio} ${data}\n`;
            } else if (r.type === 'TXT') {
                const escapedData = data.replace(/"/g, '\\"');
                content += `${name.padEnd(16)} ${ttlStr} IN  ${typeStr} "${escapedData}"\n`;
            } else {
                content += `${name.padEnd(16)} ${ttlStr} IN  ${typeStr} ${data}\n`;
            }
        }

        const tempPath = `${filePath}.tmp`;
        fs.writeFileSync(tempPath, content);

        try {
            if (process.platform === 'linux') {
                execSync(`named-checkzone ${domain} ${tempPath}`);
            }
            fs.renameSync(tempPath, filePath);

            if (process.platform === 'linux') {
                execSync(`rndc reload ${domain}`);
            }
            return { success: true, serial, count: newRecords.length };
        } catch (err) {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            throw new Error(`Validasi zone BIND9 gagal: ${err.message}`);
        }
    }
}
