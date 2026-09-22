import path from 'node:path';
import { fileURLToPath } from 'node:url';

import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isLinux = process.platform === 'linux';

export const CONFIG = {
    PORT: process.env.PORT || 3000,
    HOST: process.env.HOST || '0.0.0.0',
    ZONE_FILE_PATH: process.env.ZONE_FILE_PATH || (isLinux ? '/etc/bind/zones/db.ispanda.net.id' : path.join(__dirname, '..', 'config', 'zones', 'db.ispanda.net.id')),
    FALLBACK_ZONE_PATH: path.join(__dirname, '..', 'config', 'zones', 'db.ispanda.net.id'),
    TARGET_RPZ: process.env.TARGET_RPZ || (isLinux ? '/var/lib/bind/kominfo.rpz' : path.join(os.tmpdir(), 'kominfo.rpz')),
    CUSTOM_WHITELIST_RPZ: process.env.CUSTOM_WHITELIST_RPZ || (isLinux ? '/var/lib/bind/custom_whitelist.rpz' : path.join(os.tmpdir(), 'custom_whitelist.rpz')),
    CUSTOM_BLACKLIST_RPZ: process.env.CUSTOM_BLACKLIST_RPZ || (isLinux ? '/var/lib/bind/custom_blacklist.rpz' : path.join(os.tmpdir(), 'custom_blacklist.rpz')),
    KOMINFO_FEED_URL: process.env.KOMINFO_FEED_URL || 'https://trustpositif.kominfo.go.id/assets/db/domains.txt',
    TEMP_RAW_RPZ: process.env.TEMP_RAW_RPZ || path.join(os.tmpdir(), 'kominfo_raw.txt'),
    ZONE_DOMAIN: process.env.ZONE_DOMAIN || 'ispanda.net.id',
    ZONE_SETTINGS_FILE: path.join(__dirname, '..', 'data', 'zone-settings.json'),
    CUSTOM_RULES_FILE: path.join(__dirname, '..', 'data', 'custom-rules.json'),
    BLOCK_STATS_FILE: path.join(__dirname, '..', 'data', 'block-stats.json'),
    PRIMARY_IP: process.env.PRIMARY_IP || '103.100.50.2',
    SECONDARY_IP: process.env.SECONDARY_IP || '103.100.50.3',
    ADMIN_USER: process.env.ADMIN_USER || 'admin',
    ADMIN_PASS: process.env.ADMIN_PASS || 'ispadmin2026',
    AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET || 'isp-secure-dns-token-secret-2026',
    RPZ_STATUS_FILE: path.join(__dirname, '..', 'data', 'rpz-status.json'),
    USERS_FILE: path.join(__dirname, '..', 'data', 'users.json'),
    AUDIT_LOGS_FILE: path.join(__dirname, '..', 'data', 'audit-logs.json'),
    PUBLIC_DIR: path.join(__dirname, '..', 'public')
};
