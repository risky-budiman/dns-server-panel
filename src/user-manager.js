import fs from 'node:fs';
import crypto from 'node:crypto';
import { CONFIG } from './config.js';

export class UserManager {
    static init() {
        if (!fs.existsSync(CONFIG.USERS_FILE)) {
            const defaultUsers = [
                {
                    id: 'usr_1',
                    username: CONFIG.ADMIN_USER,
                    passwordHash: this.hashPassword(CONFIG.ADMIN_PASS),
                    role: 'admin',
                    fullName: 'Super Administrator',
                    createdAt: new Date().toISOString()
                },
                {
                    id: 'usr_2',
                    username: 'operator1',
                    passwordHash: this.hashPassword('operator2026'),
                    role: 'operator',
                    fullName: 'NOC Duty Engineer',
                    createdAt: new Date().toISOString()
                },
                {
                    id: 'usr_3',
                    username: 'auditor1',
                    passwordHash: this.hashPassword('auditor2026'),
                    role: 'viewer',
                    fullName: 'Security Auditor (Read-Only)',
                    createdAt: new Date().toISOString()
                }
            ];
            fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        }

        if (!fs.existsSync(CONFIG.AUDIT_LOGS_FILE)) {
            const initialLog = [
                {
                    timestamp: new Date().toISOString(),
                    user: 'system',
                    role: 'system',
                    action: 'SYSTEM_INITIALIZED',
                    details: 'Enterprise RBAC & Telemetry Engine active'
                }
            ];
            fs.writeFileSync(CONFIG.AUDIT_LOGS_FILE, JSON.stringify(initialLog, null, 2));
        }
    }

    static hashPassword(password) {
        return crypto.createHash('sha256').update(password + CONFIG.AUTH_TOKEN_SECRET).digest('hex');
    }

    static getAllUsers() {
        this.init();
        const users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
        return users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            fullName: u.fullName,
            createdAt: u.createdAt
        }));
    }

    static authenticate(username, password) {
        this.init();
        const users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
        const hash = this.hashPassword(password);
        const user = users.find(u => u.username === username && u.passwordHash === hash);
        if (!user) return null;
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            fullName: user.fullName
        };
    }

    static createUser({ username, password, role, fullName }) {
        this.init();
        const users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
        if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            throw new Error(`Username '${username}' sudah digunakan.`);
        }

        const validRoles = ['admin', 'operator', 'viewer'];
        if (!validRoles.includes(role)) {
            throw new Error(`Role tidak valid. Pilihan: ${validRoles.join(', ')}`);
        }

        const newUser = {
            id: `usr_${Date.now()}`,
            username: username.toLowerCase().trim(),
            passwordHash: this.hashPassword(password),
            role,
            fullName: fullName || username,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(users, null, 2));
        return {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            fullName: newUser.fullName
        };
    }

    static updateUser({ username, fullName, role, password }) {
        this.init();
        const users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) {
            throw new Error(`Pengguna '${username}' tidak ditemukan.`);
        }

        if (role) {
            const validRoles = ['admin', 'operator', 'viewer'];
            if (!validRoles.includes(role)) {
                throw new Error(`Role tidak valid. Pilihan: ${validRoles.join(', ')}`);
            }
            if (username.toLowerCase() === CONFIG.ADMIN_USER.toLowerCase() && role !== 'admin') {
                throw new Error('Role Super Admin utama tidak boleh diturunkan.');
            }
            user.role = role;
        }

        if (fullName !== undefined && fullName.trim().length > 0) {
            user.fullName = fullName.trim();
        }

        if (password && password.trim().length > 0) {
            if (password.length < 6) {
                throw new Error('Password baru minimal 6 karakter.');
            }
            user.passwordHash = this.hashPassword(password);
        }

        fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(users, null, 2));
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            fullName: user.fullName
        };
    }

    static deleteUser(username) {
        this.init();
        if (username.toLowerCase() === CONFIG.ADMIN_USER.toLowerCase()) {
            throw new Error('User Super Admin utama tidak boleh dihapus.');
        }

        let users = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
        const initialLen = users.length;
        users = users.filter(u => u.username.toLowerCase() !== username.toLowerCase());

        if (users.length === initialLen) {
            throw new Error('User tidak ditemukan.');
        }

        fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(users, null, 2));
        return true;
    }

    static logAudit({ user, role, action, details }) {
        try {
            this.init();
            let logs = [];
            if (fs.existsSync(CONFIG.AUDIT_LOGS_FILE)) {
                logs = JSON.parse(fs.readFileSync(CONFIG.AUDIT_LOGS_FILE, 'utf-8'));
            }
            logs.unshift({
                timestamp: new Date().toISOString(),
                user: user || 'anonymous',
                role: role || 'guest',
                action,
                details
            });
            if (logs.length > 100) logs = logs.slice(0, 100);
            fs.writeFileSync(CONFIG.AUDIT_LOGS_FILE, JSON.stringify(logs, null, 2));
        } catch (e) {
            console.error('Audit log write error:', e.message);
        }
    }

    static getAuditLogs() {
        this.init();
        if (fs.existsSync(CONFIG.AUDIT_LOGS_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG.AUDIT_LOGS_FILE, 'utf-8'));
        }
        return [];
    }
}
