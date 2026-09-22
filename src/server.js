import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG } from './config.js';
import { ZoneManager } from './zone-manager.js';
import { runRPZSync, getRPZStatus } from './rpz-worker.js';
import { Orchestrator } from './orchestrator.js';
import { HealthMonitor } from './health-monitor.js';
import { UserManager } from './user-manager.js';
import { SystemMetrics } from './system-metrics.js';
import { CustomBlockManager } from './custom-block-manager.js';

// Cache active sessions: token -> { username, role, fullName, expiresAt }
const activeSessions = new Map();

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 jam
    activeSessions.set(token, {
        username: user.username,
        role: user.role,
        fullName: user.fullName,
        expiresAt
    });
    return token;
}

function getSession(token) {
    if (!token) return null;
    const session = activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(token);
        return null;
    }
    return session;
}

function serveStatic(res, filePath, contentType) {
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function checkAuth(req, res, allowedRoles = null) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const session = getSession(token);

    if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Sesi tidak valid atau telah kedaluwarsa.' }));
        return null;
    }

    if (allowedRoles && !allowedRoles.includes(session.role)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Forbidden: Role '${session.role}' tidak memiliki izin untuk aksi ini.` }));
        return null;
    }

    return session;
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    // --- AUTHENTICATION ROUTES ---

    // 1. POST /api/login
    if (req.method === 'POST' && url.pathname === '/api/login') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = UserManager.authenticate(username, password);
                if (user) {
                    const token = createSession(user);
                    UserManager.logAudit({
                        user: user.username,
                        role: user.role,
                        action: 'USER_LOGIN',
                        details: `Berhasil login ke dashboard control center`
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        message: 'Login berhasil',
                        token,
                        username: user.username,
                        role: user.role,
                        fullName: user.fullName
                    }));
                } else {
                    UserManager.logAudit({
                        user: username,
                        role: 'guest',
                        action: 'LOGIN_FAILED',
                        details: `Percobaan login gagal untuk user '${username}'`
                    });
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username atau password salah.' }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Request' }));
            }
        });
        return;
    }

    // 2. POST /api/logout
    if (req.method === 'POST' && url.pathname === '/api/logout') {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        const session = getSession(token);
        if (session) {
            UserManager.logAudit({
                user: session.username,
                role: session.role,
                action: 'USER_LOGOUT',
                details: `Logout dari sesi`
            });
            activeSessions.delete(token);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Logout berhasil' }));
        return;
    }

    // --- RBAC: USER MANAGEMENT ROUTES (Admin Only) ---

    // 3. GET /api/users
    if (req.method === 'GET' && url.pathname === '/api/users') {
        const session = checkAuth(req, res, ['admin']);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ users: UserManager.getAllUsers() }));
        return;
    }

    // 4. POST /api/users
    if (req.method === 'POST' && url.pathname === '/api/users') {
        const session = checkAuth(req, res, ['admin']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const newUser = UserManager.createUser(payload);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'USER_CREATED',
                    details: `Membuat user baru: ${newUser.username} (Role: ${newUser.role})`
                });
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'User berhasil dibuat', user: newUser }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 5. DELETE /api/users
    if (req.method === 'DELETE' && url.pathname === '/api/users') {
        const session = checkAuth(req, res, ['admin']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { username } = JSON.parse(body);
                UserManager.deleteUser(username);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'USER_DELETED',
                    details: `Menghapus user: ${username}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: `User '${username}' berhasil dihapus` }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- SYSTEM METRICS & AUDIT LOGS ---

    // 6. GET /api/system/metrics (Enterprise Telemetry)
    if (req.method === 'GET' && url.pathname === '/api/system/metrics') {
        const session = checkAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(SystemMetrics.getMetrics()));
        return;
    }

    // 7. GET /api/audit-logs
    if (req.method === 'GET' && url.pathname === '/api/audit-logs') {
        const session = checkAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: UserManager.getAuditLogs() }));
        return;
    }

    // --- STATUS & HEALTH ROUTES ---

    // 8. GET /api/status
    if (req.method === 'GET' && url.pathname === '/api/status') {
        const zoneSettings = ZoneManager.getZoneSettings();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ONLINE',
            domain: zoneSettings.domain || CONFIG.ZONE_DOMAIN,
            primary: CONFIG.PRIMARY_IP,
            secondary: CONFIG.SECONDARY_IP,
            platform: process.platform,
            time: new Date().toISOString()
        }));
        return;
    }

    // 8B. GET & POST /api/zone/settings (Master Zone Configuration)
    if (req.method === 'GET' && url.pathname === '/api/zone/settings') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ZoneManager.getZoneSettings()));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/zone/settings') {
        const session = checkAuth(req, res, ['admin']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const settings = JSON.parse(body);
                if (!settings.domain || !settings.primaryNS) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Domain dan Primary NS wajib diisi.' }));
                    return;
                }
                const currentRecords = ZoneManager.parseRecords();
                const result = ZoneManager.updateZoneFile(currentRecords, settings);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'ZONE_CONFIG_UPDATED',
                    details: `Mengubah pengaturan zone: domain=${settings.domain}, primaryNS=${settings.primaryNS}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Pengaturan zone berhasil diperbarui', result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- ADGUARD / PI-HOLE CUSTOM BLOCKING ROUTES ---

    // GET /api/blocking/rules
    if (req.method === 'GET' && url.pathname === '/api/blocking/rules') {
        const session = checkAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rules: CustomBlockManager.getRules() }));
        return;
    }

    // POST /api/blocking/rules (Add custom domain block / whitelist)
    if (req.method === 'POST' && url.pathname === '/api/blocking/rules') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { domain, type, category } = JSON.parse(body);
                const newRule = CustomBlockManager.addRule({ domain, type, category });
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: type === 'whitelist' ? 'WHITELIST_RULE_ADDED' : 'BLACKLIST_RULE_ADDED',
                    details: `Menambah aturan ${type}: ${domain} (${category})`
                });
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Rule berhasil ditambahkan', rule: newRule }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // POST /api/blocking/rules/toggle
    if (req.method === 'POST' && url.pathname === '/api/blocking/rules/toggle') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                const updatedRule = CustomBlockManager.toggleRule(id);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'BLOCK_RULE_TOGGLED',
                    details: `Toggle status rule ${updatedRule.domain} -> ${updatedRule.enabled ? 'AKTIF' : 'NONAKTIF'}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Rule status diubah', rule: updatedRule }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // DELETE /api/blocking/rules
    if (req.method === 'DELETE' && url.pathname === '/api/blocking/rules') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                CustomBlockManager.deleteRule(id);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'BLOCK_RULE_DELETED',
                    details: `Menghapus rule id ${id}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Rule berhasil dihapus' }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // GET /api/blocking/stats (AdGuard/Pi-hole Telemetry & Hit Counts)
    if (req.method === 'GET' && url.pathname === '/api/blocking/stats') {
        const session = checkAuth(req, res);
        if (!session) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(CustomBlockManager.getBlockStats()));
        return;
    }

    // 9. GET /api/health
    if (req.method === 'GET' && url.pathname === '/api/health') {
        try {
            const healthData = await HealthMonitor.checkNodes();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(healthData));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 10. GET /api/rpz/status
    if (req.method === 'GET' && url.pathname === '/api/rpz/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getRPZStatus()));
        return;
    }

    // --- DNS RECORDS ROUTES ---

    // 11. GET /api/records (All logged users)
    if (req.method === 'GET' && url.pathname === '/api/records') {
        try {
            const zoneSettings = ZoneManager.getZoneSettings();
            const records = ZoneManager.parseRecords();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ domain: zoneSettings.domain, zoneSettings, records }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 12. POST /api/records (Admin & Operator only)
    if (req.method === 'POST' && url.pathname === '/api/records') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { name, type, ttl, priority, data: recData, target } = JSON.parse(body);
                const finalTarget = recData || target;
                if (!name || !type || !finalTarget) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Field name, type, dan data wajib diisi.' }));
                    return;
                }

                const currentRecords = ZoneManager.parseRecords();
                const zoneSettings = ZoneManager.getZoneSettings();
                const domainLower = (zoneSettings.domain || '').toLowerCase();
                let cleanName = name.trim().toLowerCase();
                if (cleanName === domainLower || cleanName === `${domainLower}.` || cleanName === '') {
                    cleanName = '@';
                }

                currentRecords.push({
                    name: cleanName,
                    type: type.toUpperCase(),
                    ttl: parseInt(ttl, 10) || 86400,
                    priority: type.toUpperCase() === 'MX' ? (parseInt(priority, 10) || 10) : '-',
                    data: finalTarget
                });

                const result = ZoneManager.updateZoneFile(currentRecords);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'RECORD_ADDED',
                    details: `Menambah record ${cleanName} IN ${type.toUpperCase()} (TTL: ${ttl || 86400}) ${finalTarget}`
                });
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Record berhasil ditambahkan', result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 13. PUT /api/records (Admin & Operator only)
    if (req.method === 'PUT' && url.pathname === '/api/records') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { oldRecord, newRecord } = JSON.parse(body);
                if (!oldRecord || !newRecord || !newRecord.name || !newRecord.type || (!newRecord.data && !newRecord.target)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Parameter oldRecord dan newRecord tidak lengkap.' }));
                    return;
                }

                let currentRecords = ZoneManager.parseRecords();
                const zoneSettings = ZoneManager.getZoneSettings();
                const domainLower = (zoneSettings.domain || '').toLowerCase();
                let found = false;

                const oldTarget = (oldRecord.data || oldRecord.target || '').trim().replace(/\.$/, '').toLowerCase();

                currentRecords = currentRecords.map(r => {
                    if (found) return r;

                    const matchName = r.name.toLowerCase() === oldRecord.name.toLowerCase() ||
                        ((oldRecord.name === '@' || oldRecord.name.toLowerCase() === domainLower) &&
                         (r.name === '@' || r.name.toLowerCase() === domainLower));
                    const matchType = r.type.toUpperCase() === oldRecord.type.toUpperCase();

                    if (matchName && matchType) {
                        if (oldTarget) {
                            const rData = (r.data || '').trim().replace(/\.$/, '').toLowerCase();
                            if (rData !== oldTarget) return r;
                        }

                        found = true;
                        let cleanNewName = newRecord.name.trim().toLowerCase();
                        if (cleanNewName === domainLower || cleanNewName === `${domainLower}.` || cleanNewName === '') {
                            cleanNewName = '@';
                        }

                        return {
                            name: cleanNewName,
                            type: newRecord.type.toUpperCase(),
                            ttl: parseInt(newRecord.ttl, 10) || r.ttl || 86400,
                            priority: newRecord.type.toUpperCase() === 'MX' ? (parseInt(newRecord.priority, 10) || 10) : '-',
                            data: newRecord.data || newRecord.target
                        };
                    }
                    return r;
                });

                if (!found) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Record yang ingin diedit tidak ditemukan.' }));
                    return;
                }

                const result = ZoneManager.updateZoneFile(currentRecords);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'RECORD_UPDATED',
                    details: `Update record ${oldRecord.name} (${oldRecord.type}) -> ${newRecord.data || newRecord.target}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Record berhasil diperbarui', result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 14. DELETE /api/records (Admin & Operator only)
    if (req.method === 'DELETE' && url.pathname === '/api/records') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { name, type, data: recData, target } = JSON.parse(body);
                let currentRecords = ZoneManager.parseRecords();
                const initialLength = currentRecords.length;
                const zoneSettings = ZoneManager.getZoneSettings();
                const domainLower = (zoneSettings.domain || '').toLowerCase();
                const targetMatch = (recData || target || '').trim().replace(/\.$/, '').toLowerCase();

                let removed = false;
                currentRecords = currentRecords.filter(r => {
                    if (removed) return true;
                    const matchName = r.name.toLowerCase() === name.toLowerCase() ||
                        ((name === '@' || name.toLowerCase() === domainLower) &&
                         (r.name === '@' || r.name.toLowerCase() === domainLower));
                    const matchType = r.type.toUpperCase() === type.toUpperCase();

                    if (!matchName || !matchType) return true;

                    if (targetMatch) {
                        const rData = (r.data || '').trim().replace(/\.$/, '').toLowerCase();
                        if (rData === targetMatch) {
                            removed = true;
                            return false;
                        }
                        return true;
                    }

                    removed = true;
                    return false;
                });

                if (currentRecords.length === initialLength) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Record tidak ditemukan' }));
                    return;
                }

                const result = ZoneManager.updateZoneFile(currentRecords);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'RECORD_DELETED',
                    details: `Menghapus record ${name} (${type})`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Record berhasil dihapus', result }));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // 15. POST /api/sync-rpz (Admin & Operator only)
    if (req.method === 'POST' && url.pathname === '/api/sync-rpz') {
        const session = checkAuth(req, res, ['admin', 'operator']);
        if (!session) return;
        try {
            const syncResult = await runRPZSync();
            UserManager.logAudit({
                user: session.username,
                role: session.role,
                action: 'RPZ_SYNC_TRIGGERED',
                details: `Pemicu sinkronisasi RPZ Kominfo (${syncResult.recordsProcessed} domain, ${syncResult.durationMs}ms)`
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Sinkronisasi RPZ selesai', data: syncResult }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    // 16. POST /api/provision (Admin only)
    if (req.method === 'POST' && url.pathname === '/api/provision') {
        const session = checkAuth(req, res, ['admin']);
        if (!session) return;
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const result = await Orchestrator.provisionDualNode(payload);
                UserManager.logAudit({
                    user: session.username,
                    role: session.role,
                    action: 'SERVERS_PROVISIONED',
                    details: `Provisioning dual-node DNS untuk domain ${payload.domain}`
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // --- STATIC FILES ---
    if (url.pathname === '/' || url.pathname === '/index.html') {
        serveStatic(res, path.join(CONFIG.PUBLIC_DIR, 'index.html'), 'text/html');
        return;
    }
    if (url.pathname === '/app.js') {
        serveStatic(res, path.join(CONFIG.PUBLIC_DIR, 'app.js'), 'application/javascript');
        return;
    }
    if (url.pathname === '/style.css') {
        serveStatic(res, path.join(CONFIG.PUBLIC_DIR, 'style.css'), 'text/css');
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

UserManager.init();

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
    console.log(`====================================================`);
    console.log(`🚀 ISP DNS Orchestrator Control Panel (Enterprise RBAC)`);
    console.log(`📡 URL Akses: http://${CONFIG.HOST === '0.0.0.0' ? 'localhost' : CONFIG.HOST}:${CONFIG.PORT}`);
    console.log(`👥 Multi-User RBAC: Super Admin, NOC Operator, Auditor`);
    console.log(`🌐 Managed Domain: ${CONFIG.ZONE_DOMAIN}`);
    console.log(`====================================================`);
});
