import crypto from 'node:crypto';

export class Orchestrator {
    static async runRemoteCommand(sshConfig, command) {
        let Client;
        try {
            const ssh2Module = await import('ssh2');
            Client = ssh2Module.Client;
        } catch (e) {
            throw new Error("Modul 'ssh2' belum terinstal. Jalankan 'npm install' terlebih dahulu.");
        }
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

    static generateTSIGKey(name = 'transfer-key') {
        const secret = crypto.randomBytes(32).toString('base64');
        return {
            name,
            algorithm: 'hmac-sha256',
            secret,
            conf: `key "${name}" {\n    algorithm hmac-sha256;\n    secret "${secret}";\n};\n`
        };
    }

    static async provisionDualNode(payload) {
        const { server1, server2, domain } = payload;
        const tsig = this.generateTSIGKey();
        const logs = [];

        logs.push(`[*] Memulai provisioning Dual-Node DNS untuk domain: ${domain}`);

        // Helper command generator dengan auto-sudo untuk non-root
        const getDeployCmd = (user, tsigConf) => {
            const sudoPrefix = (user && user !== 'root') ? 'sudo ' : '';
            return `
                ${sudoPrefix}apt-get update && ${sudoPrefix}apt-get install -y bind9 bind9utils dnsutils curl nodejs
                ${sudoPrefix}mkdir -p /etc/bind/zones /var/lib/bind
                echo '${tsigConf}' | ${sudoPrefix}tee /etc/bind/tsig.key > /dev/null
                ${sudoPrefix}chmod 640 /etc/bind/tsig.key
                ${sudoPrefix}chown root:bind /etc/bind/tsig.key
            `;
        };

        // 1. Setup Server 1 (Primary / Master)
        const s1User = server1.username || 'root';
        logs.push(`[*] Menyiapkan Primary Server (NS1) pada ${server1.host} (User: ${s1User}, Sudo: ${s1User !== 'root' ? 'YES' : 'NO'})...`);
        await this.runRemoteCommand(server1, getDeployCmd(s1User, tsig.conf));
        logs.push(`[+] BIND9 terpasang dan TSIG Key dikonfigurasi di Server 1.`);

        // 2. Setup Server 2 (Secondary / Slave)
        const s2User = server2.username || 'root';
        logs.push(`[*] Menyiapkan Secondary Server (NS2) pada ${server2.host} (User: ${s2User}, Sudo: ${s2User !== 'root' ? 'YES' : 'NO'})...`);
        await this.runRemoteCommand(server2, getDeployCmd(s2User, tsig.conf));
        logs.push(`[+] BIND9 terpasang dan TSIG Key dikonfigurasi di Server 2.`);

        return {
            success: true,
            domain,
            primary: server1.host,
            secondary: server2.host,
            logs
        };
    }
}
