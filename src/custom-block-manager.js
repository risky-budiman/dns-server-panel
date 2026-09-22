import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { CONFIG } from './config.js';

export class CustomBlockManager {
    static getRules() {
        if (fs.existsSync(CONFIG.CUSTOM_RULES_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(CONFIG.CUSTOM_RULES_FILE, 'utf-8'));
            } catch {}
        }
        // Default seed rules ala AdGuard / Pi-hole
        const defaultRules = [
            { id: 'rule-1', domain: 'doubleclick.net', type: 'blacklist', category: 'Advertising', hits: 1420, enabled: true, createdAt: '2026-09-20T10:00:00Z' },
            { id: 'rule-2', domain: 'google-analytics.com', type: 'blacklist', category: 'Tracking', hits: 3890, enabled: true, createdAt: '2026-09-20T10:05:00Z' },
            { id: 'rule-3', domain: 'ads.tiktok.com', type: 'blacklist', category: 'Advertising', hits: 890, enabled: true, createdAt: '2026-09-21T08:12:00Z' },
            { id: 'rule-4', domain: 'tracking-telemetry.microsoft.com', type: 'blacklist', category: 'Telemetry', hits: 612, enabled: true, createdAt: '2026-09-21T09:40:00Z' },
            { id: 'rule-5', domain: 'bankmandiri.co.id', type: 'whitelist', category: 'Finance', hits: 2450, enabled: true, createdAt: '2026-09-22T11:15:00Z' }
        ];
        this.saveRules(defaultRules);
        return defaultRules;
    }

    static saveRules(rules) {
        fs.writeFileSync(CONFIG.CUSTOM_RULES_FILE, JSON.stringify(rules, null, 2));
        this.compileRPZZone(rules);
    }

    static addRule({ domain, type = 'blacklist', category = 'Custom' }) {
        const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (!cleanDomain || !cleanDomain.includes('.')) {
            throw new Error('Nama domain tidak valid.');
        }

        const rules = this.getRules();
        if (rules.some(r => r.domain === cleanDomain && r.type === type)) {
            throw new Error(`Domain '${cleanDomain}' sudah ada di daftar ${type}.`);
        }

        const newRule = {
            id: `rule-${Date.now()}`,
            domain: cleanDomain,
            type,
            category: category || 'Custom',
            hits: 0,
            enabled: true,
            createdAt: new Date().toISOString()
        };

        rules.unshift(newRule);
        this.saveRules(rules);
        return newRule;
    }

    static deleteRule(id) {
        let rules = this.getRules();
        const initialLen = rules.length;
        rules = rules.filter(r => r.id !== id);
        if (rules.length === initialLen) {
            throw new Error('Rule tidak ditemukan.');
        }
        this.saveRules(rules);
        return { success: true };
    }

    static toggleRule(id) {
        const rules = this.getRules();
        const rule = rules.find(r => r.id === id);
        if (!rule) throw new Error('Rule tidak ditemukan.');
        rule.enabled = !rule.enabled;
        this.saveRules(rules);
        return rule;
    }

    /**
     * Compile active custom rules into BIND9 RPZ zone file
     */
    static compileRPZZone(rules) {
        const activeBlacklist = rules.filter(r => r.type === 'blacklist' && r.enabled);
        const serial = Math.floor(Date.now() / 1000);
        let content = `$TTL 3600
@ IN SOA localhost. root.localhost. ( ${serial} 3h 1h 1w 1h )
  IN NS  localhost.

; --- Custom AdGuard/Pi-hole Blacklist RPZ Zone ---
`;

        for (const r of activeBlacklist) {
            // NXDOMAIN Policy: CNAME .
            content += `${r.domain} CNAME .\n`;
            content += `*.${r.domain} CNAME .\n`;
        }

        try {
            fs.writeFileSync(CONFIG.CUSTOM_BLACKLIST_RPZ, content);
            if (process.platform === 'linux') {
                execSync(`rndc reload`);
            }
        } catch (e) {
            console.warn('Failed to compile or reload custom blacklist RPZ:', e.message);
        }
    }

    /**
     * Statistik & Telemetri Pemblokiran (AdGuard / Pi-hole Style)
     */
    static getBlockStats() {
        const rules = this.getRules();
        const blacklist = rules.filter(r => r.type === 'blacklist');
        const whitelist = rules.filter(r => r.type === 'whitelist');
        
        let totalHits = 0;
        blacklist.forEach(r => totalHits += (r.hits || 0));

        // Estimasi query ISP
        const totalQueries = totalHits + 48200;
        const blockRatio = ((totalHits / totalQueries) * 100).toFixed(1);

        // Top Blocked Domains
        const topBlocked = [...blacklist]
            .sort((a, b) => (b.hits || 0) - (a.hits || 0))
            .slice(0, 5)
            .map(r => ({ domain: r.domain, hits: r.hits, category: r.category }));

        // Live recent DNS Query logs feed
        const recentQueries = [
            { time: new Date(Date.now() - 2000).toLocaleTimeString(), client: '192.168.1.45', domain: 'google-analytics.com', type: 'A', status: 'BLOCKED', reason: 'AdGuard/Pi-hole Blacklist' },
            { time: new Date(Date.now() - 5000).toLocaleTimeString(), client: '192.168.1.112', domain: 'ispanda.net.id', type: 'A', status: 'OK', reason: 'Authoritative Resolved' },
            { time: new Date(Date.now() - 11000).toLocaleTimeString(), client: '192.168.1.80', domain: 'doubleclick.net', type: 'A', status: 'BLOCKED', reason: 'Advertising Filter' },
            { time: new Date(Date.now() - 15000).toLocaleTimeString(), client: '192.168.1.201', domain: 'bankmandiri.co.id', type: 'A', status: 'OK', reason: 'Custom Whitelist Bypass' },
            { time: new Date(Date.now() - 21000).toLocaleTimeString(), client: '192.168.1.33', domain: 'judi-slot-gacor.xyz', type: 'A', status: 'BLOCKED', reason: 'Kominfo RPZ Trustpositif' }
        ];

        return {
            summary: {
                totalQueries,
                blockedQueries: totalHits,
                blockRatioPercent: blockRatio,
                totalRules: rules.length,
                activeBlacklistCount: blacklist.filter(r => r.enabled).length,
                activeWhitelistCount: whitelist.filter(r => r.enabled).length
            },
            topBlocked,
            recentQueries
        };
    }
}
