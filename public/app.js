// Authentication State
function getAuthToken() {
    return localStorage.getItem('dns_auth_token');
}

function getUserRole() {
    return localStorage.getItem('dns_auth_role') || 'viewer';
}

function setAuthSession(token, username, role, fullName) {
    localStorage.setItem('dns_auth_token', token);
    localStorage.setItem('dns_auth_user', username);
    localStorage.setItem('dns_auth_role', role);
    localStorage.setItem('dns_auth_name', fullName || username);
}

function clearAuthSession() {
    localStorage.removeItem('dns_auth_token');
    localStorage.removeItem('dns_auth_user');
    localStorage.removeItem('dns_auth_role');
    localStorage.removeItem('dns_auth_name');
}

function checkAuthState() {
    const token = getAuthToken();
    const loginScreen = document.getElementById('login-screen');
    const dashboardScreen = document.getElementById('dashboard-screen');

    if (!token) {
        loginScreen.style.setProperty('display', 'flex', 'important');
        dashboardScreen.style.setProperty('display', 'none', 'important');
    } else {
        loginScreen.style.setProperty('display', 'none', 'important');
        dashboardScreen.style.setProperty('display', 'flex', 'important');
        const user = localStorage.getItem('dns_auth_user') || 'Admin';
        const role = getUserRole();
        const roleUpper = role.toUpperCase();
        
        document.getElementById('user-badge').innerHTML = `User: <strong>${user}</strong> <span class="role-badge ${role}">${roleUpper}</span>`;

        const btnProv = document.getElementById('tab-btn-provision');
        const btnUsers = document.getElementById('tab-btn-users');

        if (role === 'admin') {
            if (btnProv) btnProv.style.display = 'flex';
            if (btnUsers) btnUsers.style.display = 'flex';
        } else {
            if (btnProv) btnProv.style.display = 'none';
            if (btnUsers) btnUsers.style.display = 'none';
        }

        // Pastikan tab default aktif dengan styling sidebar yang sinkron
        const defaultTabBtn = document.getElementById('tab-btn-records');
        switchTab('records', defaultTabBtn);

        fetchStatus();
        fetchHealth();
        fetchRecords();
        fetchRPZStatus();
        fetchSystemMetrics();
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('login-username').value.trim();
    const passwordInput = document.getElementById('login-password').value;
    const errBox = document.getElementById('login-error');

    errBox.style.display = 'none';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        const data = await res.json();
        if (res.ok) {
            setAuthSession(data.token, data.username, data.role, data.fullName);
            checkAuthState();
        } else {
            errBox.innerText = data.error || 'Login gagal.';
            errBox.style.display = 'block';
        }
    } catch (err) {
        errBox.innerText = `Network error: ${err.message}`;
        errBox.style.display = 'block';
    }
}

async function handleLogout() {
    const token = getAuthToken();
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
    } catch {}
    clearAuthSession();
    checkAuthState();
}

function authHeaders() {
    const token = getAuthToken();
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// UI Tabs / Sidebar Navigation
function switchTab(tabName, el) {
    document.querySelectorAll('.sidebar-link').forEach(btn => btn.classList.remove('active'));
    if (el) {
        el.classList.add('active');
    }

    const tabRecords = document.getElementById('tab-records');
    const tabZone = document.getElementById('tab-zone');
    const tabBlocking = document.getElementById('tab-blocking');
    const tabRpz = document.getElementById('tab-rpz');
    const tabMetrics = document.getElementById('tab-metrics');
    const tabProvision = document.getElementById('tab-provision');
    const tabUsers = document.getElementById('tab-users');
    const tabAudit = document.getElementById('tab-audit');

    if (tabRecords) tabRecords.style.display = tabName === 'records' ? 'block' : 'none';
    if (tabZone) tabZone.style.display = tabName === 'zone' ? 'block' : 'none';
    if (tabBlocking) tabBlocking.style.display = tabName === 'blocking' ? 'block' : 'none';
    if (tabRpz) tabRpz.style.display = tabName === 'rpz' ? 'block' : 'none';
    if (tabMetrics) tabMetrics.style.display = tabName === 'metrics' ? 'block' : 'none';
    if (tabProvision) tabProvision.style.display = tabName === 'provision' ? 'block' : 'none';
    if (tabUsers) tabUsers.style.display = tabName === 'users' ? 'block' : 'none';
    if (tabAudit) tabAudit.style.display = tabName === 'audit' ? 'block' : 'none';

    if (tabName === 'records') fetchRecords();
    if (tabName === 'zone') loadZoneSettingsTab();
    if (tabName === 'blocking') fetchBlockingData();
    if (tabName === 'rpz') fetchRPZStatus();
    if (tabName === 'metrics') fetchSystemMetrics();
    if (tabName === 'users') fetchUsers();
    if (tabName === 'audit') fetchAuditLogs();
}

function openAddModal() {
    if (getUserRole() === 'viewer') {
        alert('Akses Ditolak: Role Viewer hanya memiliki izin Read-Only.');
        return;
    }
    document.getElementById('rec-name').value = '';
    document.getElementById('rec-target').value = '';
    document.getElementById('rec-ttl').value = '1800';
    document.getElementById('rec-priority').value = '10';
    document.getElementById('rec-priority-group').style.display = 'none';
    document.getElementById('add-modal').style.display = 'flex';
}

function togglePriorityField(typeSelectId, groupContainerId) {
    const type = document.getElementById(typeSelectId).value;
    const group = document.getElementById(groupContainerId);
    if (group) {
        group.style.display = type === 'MX' ? 'block' : 'none';
    }
}

async function openZoneSettingsModal() {
    if (getUserRole() !== 'admin') {
        alert('Akses Ditolak: Hanya Administrator yang dapat mengubah pengaturan Authoritative Zone.');
        return;
    }
    try {
        const res = await fetch('/api/zone/settings');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('zs-domain').value = data.domain || '';
            document.getElementById('zs-primary-ns').value = data.primaryNS || '';
            document.getElementById('zs-secondary-ns').value = data.secondaryNS || '';
            document.getElementById('zs-hostmaster').value = data.hostmaster || '';
            document.getElementById('zs-ttl').value = data.defaultTTL || 86400;
            document.getElementById('zs-refresh').value = data.refresh || 3600;
            document.getElementById('zs-retry').value = data.retry || 1800;
        }
    } catch (e) {
        console.warn('Gagal memuat pengaturan zone:', e);
    }
    document.getElementById('zone-settings-modal').style.display = 'flex';
}

async function loadZoneSettingsTab() {
    try {
        const res = await fetch('/api/zone/settings');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('tab-zs-domain').value = data.domain || '';
            document.getElementById('tab-zs-primary-ns').value = data.primaryNS || '';
            document.getElementById('tab-zs-secondary-ns').value = data.secondaryNS || '';
            document.getElementById('tab-zs-hostmaster').value = data.hostmaster || '';
            document.getElementById('tab-zs-ttl').value = data.defaultTTL || 86400;
            document.getElementById('tab-zs-refresh').value = data.refresh || 3600;
            document.getElementById('tab-zs-retry').value = data.retry || 1800;
        }
    } catch (e) {
        console.warn('Gagal memuat pengaturan zone tab:', e);
    }
}

async function handleSaveZoneTab(e) {
    e.preventDefault();
    if (getUserRole() !== 'admin') {
        alert('Akses Ditolak: Hanya Administrator yang berhak mengubah nama domain master.');
        return;
    }

    const domain = document.getElementById('tab-zs-domain').value.trim();
    const primaryNS = document.getElementById('tab-zs-primary-ns').value.trim();
    const secondaryNS = document.getElementById('tab-zs-secondary-ns').value.trim();
    const hostmaster = document.getElementById('tab-zs-hostmaster').value.trim();
    const defaultTTL = parseInt(document.getElementById('tab-zs-ttl').value, 10) || 86400;
    const refresh = parseInt(document.getElementById('tab-zs-refresh').value, 10) || 3600;
    const retry = parseInt(document.getElementById('tab-zs-retry').value, 10) || 1800;

    const statusBadge = document.getElementById('zone-save-status');
    statusBadge.style.display = 'none';

    try {
        const res = await fetch('/api/zone/settings', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ domain, primaryNS, secondaryNS, hostmaster, defaultTTL, refresh, retry })
        });
        const result = await res.json();
        if (res.ok) {
            statusBadge.style.display = 'inline-block';
            setTimeout(() => { statusBadge.style.display = 'none'; }, 4000);
            fetchStatus();
            fetchRecords();
        } else {
            alert(`Gagal: ${result.error}`);
        }
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
}

async function submitZoneSettings() {
    const domain = document.getElementById('zs-domain').value.trim();
    const primaryNS = document.getElementById('zs-primary-ns').value.trim();
    const secondaryNS = document.getElementById('zs-secondary-ns').value.trim();
    const hostmaster = document.getElementById('zs-hostmaster').value.trim();
    const defaultTTL = parseInt(document.getElementById('zs-ttl').value, 10) || 86400;
    const refresh = parseInt(document.getElementById('zs-refresh').value, 10) || 3600;
    const retry = parseInt(document.getElementById('zs-retry').value, 10) || 1800;

    if (!domain || !primaryNS) {
        alert('Nama domain dan Primary NS wajib diisi!');
        return;
    }

    try {
        const res = await fetch('/api/zone/settings', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ domain, primaryNS, secondaryNS, hostmaster, defaultTTL, refresh, retry })
        });
        const result = await res.json();
        if (res.ok) {
            closeModal('zone-settings-modal');
            alert('Pengaturan zone master BIND9 berhasil disimpan!');
            fetchStatus();
            fetchRecords();
        } else {
            alert(`Gagal: ${result.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

function openAddUserModal() {
    document.getElementById('add-user-modal').style.display = 'flex';
}

function openEditModal(name, type, target, ttl, priority) {
    if (getUserRole() === 'viewer') {
        alert('Akses Ditolak: Role Viewer hanya memiliki izin Read-Only.');
        return;
    }
    document.getElementById('edit-old-name').value = name;
    document.getElementById('edit-old-type').value = type;
    const oldTargetEl = document.getElementById('edit-old-target');
    if (oldTargetEl) oldTargetEl.value = target;
    document.getElementById('edit-name').value = name;
    document.getElementById('edit-type').value = type;
    document.getElementById('edit-target').value = target;
    document.getElementById('edit-ttl').value = ttl || 1800;
    document.getElementById('edit-priority').value = priority !== '-' ? priority : 10;
    togglePriorityField('edit-type', 'edit-priority-group');
    document.getElementById('edit-modal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// Live Status & Health
async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('primary-ip').innerText = data.primary;
        document.getElementById('secondary-ip').innerText = data.secondary;
        document.getElementById('active-domain').innerText = data.domain;
        const topDomain = document.getElementById('top-domain-badge');
        if (topDomain) topDomain.innerText = data.domain;
    } catch (e) {
        console.error('Error fetch status:', e);
    }
}

async function fetchHealth() {
    try {
        const res = await fetch('/api/health');
        const data = await res.json();

        const globalDot = document.getElementById('global-dot');
        const globalText = document.getElementById('global-status-text');

        globalDot.className = 'dot-pulse';
        if (data.overallStatus === 'HEALTHY') {
            globalText.innerText = 'Cluster: Healthy & Operational';
        } else if (data.overallStatus === 'DEGRADED') {
            globalDot.classList.add('degraded');
            globalText.innerText = 'Cluster: Degraded (1 Node Active)';
        } else {
            globalDot.classList.add('offline');
            globalText.innerText = 'Cluster: Node Unreachable (Dev/Offline)';
        }

        // Primary Node Badge
        const pNode = data.nodes.primary;
        const pBadge = document.getElementById('p-badge');
        pBadge.className = `health-badge ${pNode.status === 'ONLINE' ? 'online' : 'offline'}`;
        pBadge.innerText = pNode.status;
        document.getElementById('p-meta').innerText = `Port 53: ${pNode.port53} | Latency: ${pNode.latencyMs ? pNode.latencyMs + 'ms' : 'N/A'}`;

        // Secondary Node Badge
        const sNode = data.nodes.secondary;
        const sBadge = document.getElementById('s-badge');
        sBadge.className = `health-badge ${sNode.status === 'ONLINE' ? 'online' : 'offline'}`;
        sBadge.innerText = sNode.status;
        document.getElementById('s-meta').innerText = `Port 53: ${sNode.port53} | Latency: ${sNode.latencyMs ? sNode.latencyMs + 'ms' : 'N/A'}`;

    } catch (e) {
        document.getElementById('global-status-text').innerText = 'Health Check: Service Offline';
    }
}

// DNS Records Operations (Hurricane Electric / cPanel Full Table)
async function fetchRecords() {
    try {
        const res = await fetch('/api/records');
        const data = await res.json();
        const tbody = document.getElementById('records-table-body');
        tbody.innerHTML = '';

        const zs = data.zoneSettings || {};
        const zoneDomain = data.domain || zs.domain || 'ids.net.id';
        const primaryNS = zs.primaryNS || `ns1.${zoneDomain}`;
        const hostmaster = zs.hostmaster || `hostmaster.${zoneDomain}`;
        const serial = zs.serial || 2026092301;
        const refresh = zs.refresh || 3600;
        const retry = zs.retry || 1800;
        const expire = zs.expire || 1209600;
        const minTTL = zs.minTTL || 86400;
        const defaultTTL = zs.defaultTTL || 86400;

        // 1. Baris Pertama: SOA Record (Start of Authority) dengan Gembok Pengunci
        const soaTr = document.createElement('tr');
        soaTr.className = 'soa-row';
        const cleanPrimaryNS = primaryNS.replace(/\.$/, '');
        const cleanHostmaster = hostmaster.replace(/\.$/, '');
        const soaDataText = `${cleanPrimaryNS} ${cleanHostmaster} ${serial} ${refresh} ${retry} ${expire} ${minTTL}`;
        soaTr.innerHTML = `
            <td style="font-weight: 700; color: #f9fafb;">${zoneDomain}</td>
            <td style="text-align: center;"><span class="type-badge soa">SOA</span></td>
            <td>${defaultTTL}</td>
            <td style="text-align: center; color: var(--text-secondary);">-</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: #e2e8f0;">${soaDataText}</td>
            <td style="text-align: center; color: var(--text-secondary);">-</td>
            <td style="text-align: center;">
                <span class="he-lock-icon" title="SOA dilindungi gembok sistem (Gunakan tombol 'Pengaturan Zone & SOA' untuk mengubah)">🔒</span>
            </td>
        `;
        tbody.appendChild(soaTr);

        // 2. Baris-baris record DNS lainnya
        if (!data.records || data.records.length === 0) {
            document.getElementById('records-count').innerText = `Total Records: 1 (SOA)`;
            return;
        }

        document.getElementById('records-count').innerText = `Total Records: ${data.records.length + 1}`;
        const role = getUserRole();

        // Urutkan records DNS persis HE.net: NS pertama di bawah SOA, lalu A, AAAA, MX, CNAME, TXT
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

        const sortedRecords = [...data.records].sort((a, b) => {
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

        sortedRecords.forEach(r => {
            const tr = document.createElement('tr');
            const typeLower = (r.type || 'A').toLowerCase();
            const badgeClass = ['soa', 'ns', 'a', 'aaaa', 'cname', 'mx', 'txt'].includes(typeLower) ? typeLower : 'other';

            let recordData = r.data || r.target || '';
            if (['NS', 'CNAME', 'MX', 'PTR'].includes(r.type) && recordData.endsWith('.')) {
                recordData = recordData.slice(0, -1);
            }
            const safeDataForAttr = recordData.replace(/"/g, '&quot;').replace(/'/g, "\\'");
            const safeNameForAttr = (r.name || '').replace(/'/g, "\\'");

            let actionHtml = `
                <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                    <button class="he-action-btn" title="Edit Record" style="color: #fbbf24;" onclick="openEditModal('${safeNameForAttr}', '${r.type}', '${safeDataForAttr}', ${r.ttl || 1800}, '${r.priority || '-'}')">✏️</button>
                    <button class="he-action-btn" title="Hapus Record" style="color: #ef4444;" onclick="deleteRecord('${safeNameForAttr}', '${r.type}', '${safeDataForAttr}')">⛔</button>
                </div>
            `;
            if (role === 'viewer') {
                actionHtml = `<span style="color: var(--text-secondary); font-size: 0.75rem;">(Read-Only)</span>`;
            }

            const priorityText = r.type === 'MX' ? (r.priority || 10) : '-';
            
            // Format FQDN yang bersih dan cegah duplikasi domain (ids.net.id.ids.net.id)
            let fqdn = r.fqdn;
            const dLower = zoneDomain.toLowerCase();
            const rNameLower = (r.name || '').toLowerCase();
            if (!fqdn || r.name === '@' || rNameLower === dLower || rNameLower === `${dLower}.`) {
                fqdn = zoneDomain;
            } else if (rNameLower.endsWith(`.${dLower}`)) {
                fqdn = r.name;
            } else if (!r.name.endsWith('.')) {
                fqdn = `${r.name}.${zoneDomain}`;
            }

            // Pemendekan inisial (...) seperti di Hurricane Electric (HE.net) agar tabel tetap rapi
            let displayText = recordData;
            if (r.type === 'TXT') {
                const quoteWrapped = displayText.startsWith('"') ? displayText : `"${displayText}"`;
                if (quoteWrapped.length > 46) {
                    displayText = quoteWrapped.slice(0, 43) + '...';
                } else {
                    displayText = quoteWrapped;
                }
            } else if (displayText.length > 48) {
                displayText = displayText.slice(0, 45) + '...';
            }

            tr.innerHTML = `
                <td style="font-weight: 600; color: #f1f5f9; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${fqdn}">${fqdn}</td>
                <td style="text-align: center;"><span class="type-badge ${badgeClass}">${r.type}</span></td>
                <td>${r.ttl || 1800}</td>
                <td style="text-align: center; color: ${r.type === 'MX' ? '#f0abfc' : 'var(--text-secondary)'}; font-weight: 600;">${priorityText}</td>
                <td style="font-family: monospace; font-size: 0.85rem; color: #94a3b8; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${safeDataForAttr}">
                    ${displayText}
                </td>
                <td style="text-align: center;">
                    <input type="checkbox" ${r.ddns ? 'checked' : ''} disabled title="Dynamic DNS flag" style="cursor: default;">
                </td>
                <td style="text-align: center;">
                    ${actionHtml}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Error fetching records:', e);
    }
}

// Enterprise System Metrics Fetcher
async function fetchSystemMetrics() {
    try {
        const res = await fetch('/api/system/metrics', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();

        // CPU
        const cpuLoad = data.system.loadAverage1m;
        document.getElementById('metric-cpu-val').innerText = `Load: ${cpuLoad}`;
        const cpuPercent = Math.min(Math.round(parseFloat(cpuLoad) * 25), 100);
        document.getElementById('meter-cpu').style.width = `${Math.max(cpuPercent, 10)}%`;
        document.getElementById('metric-cpu-cores').innerText = `Cores: ${data.system.cpuCount} | Host: ${data.system.hostname}`;

        // RAM
        const mem = data.system.memory;
        document.getElementById('metric-ram-val').innerText = `${mem.used} / ${mem.total}`;
        document.getElementById('meter-ram').style.width = `${mem.percent}%`;
        document.getElementById('metric-ram-percent').innerText = `Used: ${mem.percent}% | Free: ${mem.free}`;

        // Disk
        const disk = data.system.disk;
        document.getElementById('metric-disk-val').innerText = `${disk.free} free / ${disk.total}`;
        document.getElementById('meter-disk').style.width = `${disk.usedPercent}%`;
        document.getElementById('metric-disk-percent').innerText = `Capacity: ${disk.usedPercent}% Used`;

        // DNS Traffic QPS
        document.getElementById('metric-qps-val').innerText = `${data.dnsTraffic.currentQPS} QPS`;
        document.getElementById('metric-rrl-mitigated').innerText = `DDoS RRL Mitigated: ${data.dnsTraffic.rrlMitigationsDDoS} drops/sec`;
        document.getElementById('metric-uptime').innerText = data.system.uptime;
    } catch (e) {
        console.error('Failed to fetch metrics:', e);
    }
}

// User Management (RBAC) Fetcher & Operations
async function fetchUsers() {
    try {
        const res = await fetch('/api/users', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';

        data.users.forEach(u => {
            const tr = document.createElement('tr');
            const d = new Date(u.createdAt);
            const safeFullName = encodeURIComponent(u.fullName || '');

            let actionHtml = `
                <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openEditUserModal('${u.username}', '${safeFullName}', '${u.role}')">✏️ Edit</button>
                    ${u.username === 'admin' ? 
                        '<span style="color: var(--text-secondary); font-size: 0.75rem; margin-left: 4px;">(Master Admin)</span>' : 
                        `<button class="btn btn-danger" style="padding: 4px 10px; font-size: 0.75rem;" onclick="deleteUser('${u.username}')">Hapus</button>`
                    }
                </div>
            `;

            tr.innerHTML = `
                <td style="font-weight: 600;">${u.username}</td>
                <td>${u.fullName}</td>
                <td><span class="role-badge ${u.role}">${u.role.toUpperCase()}</span></td>
                <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</td>
                <td style="text-align: right;">${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to fetch users:', e);
    }
}

function openEditUserModal(username, fullNameEnc, role) {
    document.getElementById('edit-usr-username').value = username;
    document.getElementById('edit-usr-fullname').value = decodeURIComponent(fullNameEnc);
    const roleSelect = document.getElementById('edit-usr-role');
    roleSelect.value = role;
    if (username === 'admin') {
        roleSelect.disabled = true;
        roleSelect.title = 'Role Super Admin utama tidak dapat diubah';
    } else {
        roleSelect.disabled = false;
        roleSelect.title = '';
    }
    document.getElementById('edit-usr-password').value = '';
    document.getElementById('edit-user-modal').style.display = 'flex';
}

async function submitEditUser() {
    const username = document.getElementById('edit-usr-username').value;
    const fullName = document.getElementById('edit-usr-fullname').value.trim();
    const role = document.getElementById('edit-usr-role').value;
    const password = document.getElementById('edit-usr-password').value;

    if (!fullName) {
        alert('Nama lengkap tidak boleh kosong!');
        return;
    }

    try {
        const payload = { username, fullName, role };
        if (password && password.trim().length > 0) {
            payload.password = password;
        }

        const res = await fetch('/api/users', {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (res.ok) {
            closeModal('edit-user-modal');
            fetchUsers();
        } else {
            alert(`Gagal: ${result.error}`);
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function submitCreateUser() {
    const username = document.getElementById('usr-username').value.trim();
    const fullName = document.getElementById('usr-fullname').value.trim();
    const password = document.getElementById('usr-password').value;
    const role = document.getElementById('usr-role').value;

    if (!username || !password) {
        alert('Username dan password wajib diisi!');
        return;
    }

    try {
        const res = await fetch('/api/users', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ username, fullName, password, role })
        });
        const result = await res.json();
        if (res.ok) {
            closeModal('add-user-modal');
            document.getElementById('usr-username').value = '';
            document.getElementById('usr-fullname').value = '';
            document.getElementById('usr-password').value = '';
            fetchUsers();
        } else {
            alert(`Gagal: ${result.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function deleteUser(username) {
    if (!confirm(`Hapus pengguna ${username}?`)) return;
    try {
        const res = await fetch('/api/users', {
            method: 'DELETE',
            headers: authHeaders(),
            body: JSON.stringify({ username })
        });
        const result = await res.json();
        if (res.ok) {
            fetchUsers();
        } else {
            alert(`Gagal: ${result.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// Audit Logs Fetcher
async function fetchAuditLogs() {
    try {
        const res = await fetch('/api/audit-logs', { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const tbody = document.getElementById('audit-table-body');
        tbody.innerHTML = '';

        if (!data.logs || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Belum ada log audit.</td></tr>';
            return;
        }

        data.logs.forEach(l => {
            const tr = document.createElement('tr');
            const d = new Date(l.timestamp);
            tr.innerHTML = `
                <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">${d.toLocaleDateString()} ${d.toLocaleTimeString()}</td>
                <td style="font-weight: 600;">${l.user}</td>
                <td><span class="role-badge ${l.role}">${l.role.toUpperCase()}</span></td>
                <td><span class="type-badge">${l.action}</span></td>
                <td style="font-size: 0.85rem;">${l.details}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to fetch audit logs:', e);
    }
}

async function submitAddRecord() {
    const name = document.getElementById('rec-name').value.trim();
    const type = document.getElementById('rec-type').value;
    const target = document.getElementById('rec-target').value.trim();
    const ttl = parseInt(document.getElementById('rec-ttl').value, 10) || 1800;
    const priority = type === 'MX' ? (parseInt(document.getElementById('rec-priority').value, 10) || 10) : '-';

    if (!name || !target) {
        alert('Mohon lengkapi subdomain dan target!');
        return;
    }

    try {
        const res = await fetch('/api/records', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ name, type, target, ttl, priority })
        });
        const result = await res.json();
        if (res.ok) {
            closeModal('add-modal');
            document.getElementById('rec-name').value = '';
            document.getElementById('rec-target').value = '';
            fetchRecords();
        } else {
            alert(`Gagal: ${result.error}`);
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function submitEditRecord() {
    const oldName = document.getElementById('edit-old-name').value;
    const oldType = document.getElementById('edit-old-type').value;
    const name = document.getElementById('edit-name').value.trim();
    const type = document.getElementById('edit-type').value;
    const target = document.getElementById('edit-target').value.trim();
    const ttl = parseInt(document.getElementById('edit-ttl').value, 10) || 1800;
    const priority = type === 'MX' ? (parseInt(document.getElementById('edit-priority').value, 10) || 10) : '-';

    if (!name || !target) {
        alert('Nama dan target tidak boleh kosong!');
        return;
    }

    try {
        const oldTarget = document.getElementById('edit-old-target') ? document.getElementById('edit-old-target').value : '';
        const res = await fetch('/api/records', {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                oldRecord: { name: oldName, type: oldType, data: oldTarget, target: oldTarget },
                newRecord: { name, type, target, data: target, ttl, priority }
            })
        });
        const result = await res.json();
        if (res.ok) {
            closeModal('edit-modal');
            fetchRecords();
        } else {
            alert(`Gagal: ${result.error}`);
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

// --- ADGUARD / PI-HOLE CUSTOM BLOCKING & STATS HANDLERS ---
async function fetchBlockingData() {
    try {
        // 1. Fetch Rules
        const resRules = await fetch('/api/blocking/rules', { headers: authHeaders() });
        if (resRules.ok) {
            const dataRules = await resRules.json();
            renderBlockingRules(dataRules.rules || []);
        }

        // 2. Fetch Stats & Hit Telemetry
        const resStats = await fetch('/api/blocking/stats', { headers: authHeaders() });
        if (resStats.ok) {
            const stats = await resStats.json();
            renderBlockingStats(stats);
        }
    } catch (e) {
        console.error('Error fetching blocking data:', e);
    }
}

function renderBlockingRules(rules) {
    const tbody = document.getElementById('blocking-rules-table-body');
    tbody.innerHTML = '';

    if (rules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">Belum ada aturan filter manual.</td></tr>';
        return;
    }

    rules.forEach(r => {
        const tr = document.createElement('tr');
        const isBlacklist = r.type === 'blacklist';
        const typeBadge = isBlacklist ? 
            `<span class="health-badge offline" style="font-size: 0.7rem;">BLACKLIST</span>` : 
            `<span class="health-badge online" style="font-size: 0.7rem;">WHITELIST</span>`;

        const statusBadge = r.enabled ? 
            `<span style="color: #34d399; font-size: 0.8rem; font-weight: 600;">● Aktif</span>` : 
            `<span style="color: #94a3b8; font-size: 0.8rem;">○ Nonaktif</span>`;

        tr.innerHTML = `
            <td style="font-family: monospace; font-weight: 600; color: #f1f5f9;">${r.domain}</td>
            <td>${typeBadge}</td>
            <td><span class="role-badge viewer" style="font-size: 0.7rem;">${r.category}</span></td>
            <td style="text-align: center; font-weight: 700; color: ${isBlacklist ? '#f87171' : '#fbbf24'};">${(r.hits || 0).toLocaleString()}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: right; display: flex; justify-content: flex-end; gap: 6px;">
                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.7rem;" onclick="toggleBlockRule('${r.id}')">${r.enabled ? 'Pause' : 'Enable'}</button>
                <button class="btn btn-danger" style="padding: 3px 8px; font-size: 0.7rem;" onclick="deleteBlockRule('${r.id}')">Hapus</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderBlockingStats(stats) {
    const sum = stats.summary || {};
    document.getElementById('blk-total-queries').innerText = (sum.totalQueries || 0).toLocaleString();
    document.getElementById('blk-total-blocked').innerText = (sum.blockedQueries || 0).toLocaleString();
    document.getElementById('blk-ratio').innerText = `${sum.blockRatioPercent || 0}%`;
    document.getElementById('blk-whitelist-count').innerText = `${sum.activeWhitelistCount || 0} Domain`;
    document.getElementById('blk-rules-active').innerText = `Rules Aktif: ${sum.activeBlacklistCount || 0}`;

    // Top Blocked List
    const topContainer = document.getElementById('top-blocked-list');
    topContainer.innerHTML = '';
    (stats.topBlocked || []).forEach((t, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;';
        row.innerHTML = `
            <div style="font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">
                <span style="color: var(--text-secondary); margin-right: 6px;">#${i+1}</span>
                <strong style="color: #f1f5f9;">${t.domain}</strong>
            </div>
            <div style="font-size: 0.75rem; font-weight: 700; color: #f87171;">
                ${t.hits.toLocaleString()} hits
            </div>
        `;
        topContainer.appendChild(row);
    });

    // Recent Live Query Log Feed
    const logBody = document.getElementById('live-query-log-body');
    logBody.innerHTML = '';
    (stats.recentQueries || []).forEach(q => {
        const tr = document.createElement('tr');
        const isBlocked = q.status === 'BLOCKED';
        const statusHtml = isBlocked ? 
            `<span class="health-badge offline" style="font-size: 0.7rem;">BLOCKED</span>` : 
            `<span class="health-badge online" style="font-size: 0.7rem;">RESOLVED</span>`;

        tr.innerHTML = `
            <td style="font-family: monospace; font-size: 0.8rem; color: var(--text-secondary);">${q.time}</td>
            <td style="font-family: monospace; font-size: 0.8rem; color: #93c5fd;">${q.client}</td>
            <td style="font-weight: 600; color: #f1f5f9;">${q.domain}</td>
            <td><span class="type-badge a">${q.type}</span></td>
            <td>${statusHtml}</td>
            <td style="font-size: 0.8rem; color: var(--text-secondary);">${q.reason}</td>
        `;
        logBody.appendChild(tr);
    });
}

async function handleCreateBlockRule(e) {
    e.preventDefault();
    const domain = document.getElementById('blk-domain').value.trim();
    const type = document.getElementById('blk-type').value;
    const category = document.getElementById('blk-category').value;

    try {
        const res = await fetch('/api/blocking/rules', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ domain, type, category })
        });
        const result = await res.json();
        if (res.ok) {
            document.getElementById('blk-domain').value = '';
            fetchBlockingData();
        } else {
            alert(`Gagal: ${result.error}`);
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function toggleBlockRule(id) {
    try {
        const res = await fetch('/api/blocking/rules/toggle', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ id })
        });
        if (res.ok) {
            fetchBlockingData();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function deleteBlockRule(id) {
    if (!confirm('Hapus aturan pemblokiran ini?')) return;
    try {
        const res = await fetch('/api/blocking/rules', {
            method: 'DELETE',
            headers: authHeaders(),
            body: JSON.stringify({ id })
        });
        if (res.ok) {
            fetchBlockingData();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function deleteRecord(name, type, target) {
    const displayTarget = target ? ` (${target})` : '';
    if (!confirm(`Hapus DNS record ${name} [${type}]${displayTarget}?`)) return;

    try {
        const res = await fetch('/api/records', {
            method: 'DELETE',
            headers: authHeaders(),
            body: JSON.stringify({ name, type, data: target, target: target })
        });
        if (res.ok) {
            fetchRecords();
        } else {
            const result = await res.json();
            alert(`Gagal: ${result.error}`);
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
}

async function fetchRPZStatus() {
    try {
        const res = await fetch('/api/rpz/status');
        const data = await res.json();
        const latest = data.latest || {};

        document.getElementById('rpz-total-domains').innerText = (latest.recordsProcessed || 0).toLocaleString();
        document.getElementById('rpz-serial').innerText = latest.serial || '--';
        document.getElementById('rpz-file-size').innerText = `Zone File: ${latest.fileSizeFormatted || '-- MB'}`;

        if (latest.timestamp) {
            const dateObj = new Date(latest.timestamp);
            document.getElementById('rpz-last-sync').innerText = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString();
        } else {
            document.getElementById('rpz-last-sync').innerText = '--';
        }

        document.getElementById('rpz-duration').innerText = `Durasi Pipeline: ${latest.durationMs || 0} ms`;

        // Render tabel riwayat
        const tbody = document.getElementById('rpz-history-table');
        if (tbody) {
            tbody.innerHTML = '';
            const history = data.history || [];
            if (history.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">Belum ada catatan riwayat.</td></tr>';
                return;
            }

            history.forEach(item => {
                const tr = document.createElement('tr');
                const tDate = new Date(item.timestamp);
                tr.innerHTML = `
                    <td style="font-family: monospace;">${tDate.toLocaleDateString()} ${tDate.toLocaleTimeString()}</td>
                    <td><span class="health-badge online">${item.status}</span></td>
                    <td style="font-weight: 700; color: #f87171;">${(item.recordsProcessed || 0).toLocaleString()} domain</td>
                    <td style="font-family: monospace;">${item.serial}</td>
                    <td style="color: var(--text-secondary);">${item.fileSizeFormatted || '--'}</td>
                    <td style="color: #34d399;">${item.durationMs} ms</td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error('Failed to fetch RPZ status:', e);
    }
}

async function triggerRPZSync() {
    const btn = document.getElementById('btn-sync-rpz');
    const logBox = document.getElementById('rpz-log');
    btn.disabled = true;
    btn.innerText = '⏳ Syncing...';
    logBox.innerText = `[*] [${new Date().toLocaleTimeString()}] Meminta eksekusi sinkronisasi RPZ Kominfo...\n`;

    try {
        const res = await fetch('/api/sync-rpz', {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();
        if (res.ok) {
            logBox.innerText += `[+] Status: ${data.message}\n`;
            logBox.innerText += `[+] Total Domain: ${data.data.recordsProcessed}\n`;
            logBox.innerText += `[+] Serial Zone: ${data.data.serial}\n`;
            logBox.innerText += `[+] Durasi: ${data.data.durationMs}ms\n`;
            logBox.innerText += `[✓] Zero-downtime hot reload selesai.\n`;
            fetchRPZStatus(); // Refresh kartu metrik parameter
        } else {
            logBox.innerText += `[-] Error: ${data.error}\n`;
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        logBox.innerText += `[-] Network error: ${e.message}\n`;
    } finally {
        btn.disabled = false;
        btn.innerText = '🔄 Sync Kominfo Now';
    }
}

async function startProvisioning() {
    const log = document.getElementById('prov-log');
    log.style.display = 'block';
    log.innerText = '[*] Menginisiasi Hardened Dual-Node Deployment (Non-Root/Sudo)...\n';

    const payload = {
        domain: document.getElementById('active-domain').innerText,
        server1: {
            host: document.getElementById('prov-p-ip').value,
            port: parseInt(document.getElementById('prov-p-port').value),
            username: document.getElementById('prov-p-user').value,
            password: document.getElementById('prov-p-pass').value
        },
        server2: {
            host: document.getElementById('prov-s-ip').value,
            port: parseInt(document.getElementById('prov-s-port').value),
            username: document.getElementById('prov-s-user').value,
            password: document.getElementById('prov-s-pass').value
        }
    };

    try {
        const res = await fetch('/api/provision', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.logs) log.innerText += result.logs.join('\n') + '\n';
        if (res.ok) {
            log.innerText += `[✓] Dual-Node Provisioning selesai!\n`;
        } else {
            log.innerText += `[-] Gagal: ${result.error}\n`;
            if (res.status === 401) handleLogout();
        }
    } catch (e) {
        log.innerText += `[-] Request error: ${e.message}\n`;
    }
}

// Inisialisasi & Interval Health Check berkala setiap 10 detik
document.addEventListener('DOMContentLoaded', () => {
    checkAuthState();
    setInterval(() => {
        if (getAuthToken()) {
            fetchHealth();
            fetchRPZStatus();
        }
    }, 10000);
});
