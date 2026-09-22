import net from 'node:net';
import dns from 'node:dns/promises';
import { CONFIG } from './config.js';

export class HealthMonitor {
    /**
     * Memeriksa konektivitas port TCP ke host target
     */
    static checkTCPPort(host, port = 53, timeout = 2000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const socket = new net.Socket();

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                const latency = Date.now() - start;
                socket.destroy();
                resolve({ open: true, latency });
            });

            socket.on('timeout', () => {
                socket.destroy();
                resolve({ open: false, error: 'TIMEOUT' });
            });

            socket.on('error', (err) => {
                socket.destroy();
                resolve({ open: false, error: err.code || err.message });
            });

            socket.connect(port, host);
        });
    }

    /**
     * Melakukan pengecekan status keseluruhan kedua Node DNS
     */
    static async checkNodes() {
        const primaryHost = CONFIG.PRIMARY_IP;
        const secondaryHost = CONFIG.SECONDARY_IP;

        // Cek TCP 53
        const [pPort, sPort] = await Promise.all([
            this.checkTCPPort(primaryHost, 53),
            this.checkTCPPort(secondaryHost, 53)
        ]);

        // Coba DNS query authoritatif domain ISP
        let dnsResolving = false;
        let dnsLatency = null;
        try {
            const startDns = Date.now();
            // Resolver lokal
            await dns.resolve4('localhost');
            dnsResolving = true;
            dnsLatency = Date.now() - startDns;
        } catch {
            dnsResolving = false;
        }

        const isPrimaryHealthy = pPort.open;
        const isSecondaryHealthy = sPort.open;

        return {
            timestamp: new Date().toISOString(),
            overallStatus: (isPrimaryHealthy && isSecondaryHealthy) ? 'HEALTHY' : (isPrimaryHealthy || isSecondaryHealthy ? 'DEGRADED' : 'OFFLINE'),
            nodes: {
                primary: {
                    ip: primaryHost,
                    role: 'Master Authoritative & Recursor (RPZ)',
                    port53: pPort.open ? 'LISTENING' : 'UNREACHABLE',
                    latencyMs: pPort.latency || null,
                    status: pPort.open ? 'ONLINE' : 'DOWN',
                    details: pPort.error || 'Normal operational'
                },
                secondary: {
                    ip: secondaryHost,
                    role: 'Slave Authoritative & Slave RPZ',
                    port53: sPort.open ? 'LISTENING' : 'UNREACHABLE',
                    latencyMs: sPort.latency || null,
                    status: sPort.open ? 'ONLINE' : 'DOWN',
                    details: sPort.error || 'Normal operational'
                }
            },
            dnsEngine: {
                domain: CONFIG.ZONE_DOMAIN,
                resolving: dnsResolving,
                latencyMs: dnsLatency
            }
        };
    }
}
