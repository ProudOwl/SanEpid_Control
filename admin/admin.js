// Admin Panel JavaScript
const API_BASE = '';

let currentView = 'dashboard';

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

async function apiCall(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAdminToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
    
    if (res.status === 401) {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        window.location.href = '/admin/login';
        throw new Error('Unauthorized');
    }
    
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    
    return res.json();
}

function showModal(title, bodyHtml, onSave) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const saveBtn = document.getElementById('modal-save');
    
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modal.classList.remove('hidden');
    
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    newSaveBtn.onclick = async () => {
        if (onSave) await onSave();
        closeModal();
    };
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
}

// Получаем токен из localStorage
function getAdminToken() {
    return localStorage.getItem('admin_token');
}

// ========== Проверка авторизации ==========

async function checkAdminAuth() {
    const token = getAdminToken();
    if (!token) {
        window.location.href = '/admin/login';
        return false;
    }
    
    try {
        const response = await fetch('/api/admin/check-auth', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            localStorage.removeItem('admin_token');
            localStorage.removeItem('admin_user');
            window.location.href = '/admin/login';
            return false;
        }
        
        const data = await response.json();
        if (data.authenticated && data.user) {
            document.getElementById('admin-name').textContent = data.user.full_name || data.user.username;
        }
        return true;
    } catch (e) {
        window.location.href = '/admin/login';
        return false;
    }
}

// ========== Dashboard ==========
async function renderDashboard() {
    const stats = await apiCall('/api/admin/dashboard-stats');
    const system = await apiCall('/api/admin/system-info');
    
    return `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="num">${stats.total_users}</div>
                <div class="label">Пользователей</div>
            </div>
            <div class="stat-card">
                <div class="num">${stats.total_employees}</div>
                <div class="label">Сотрудников</div>
            </div>
            <div class="stat-card">
                <div class="num">${stats.total_zones}</div>
                <div class="label">Зон доступа</div>
            </div>
            <div class="stat-card">
                <div class="num">${stats.today_passes}</div>
                <div class="label">Проходов сегодня</div>
            </div>
            <div class="stat-card">
                <div class="num">${stats.pending_registrations}</div>
                <div class="label">Заявок на регистрацию</div>
            </div>
            <div class="stat-card">
                <div class="num">${stats.open_incidents}</div>
                <div class="label">Открытых инцидентов</div>
            </div>
        </div>
        
        <div class="card">
            <h3>📋 Быстрые действия</h3>
            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
                <button class="btn btn-primary" onclick="loadView('users')">👥 Управление пользователями</button>
                <button class="btn btn-primary" onclick="loadView('registrations')">📝 Проверить заявки</button>
                <button class="btn btn-primary" onclick="loadView('employees')">👨‍⚕️ Сотрудники</button>
            </div>
        </div>
        
        <div class="card">
            <h3>💻 Системная информация</h3>
            <table style="width: auto;">
                <tr><td style="padding: 0.5rem 0;">Python версия:</td><td style="padding: 0.5rem 0.5rem;">${system.python_version}</td></tr>
                <tr><td style="padding: 0.5rem 0;">Платформа:</td><td style="padding: 0.5rem 0.5rem;">${system.platform}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Серверное время:</td><td style="padding: 0.5rem 0.5rem;">${system.server_time}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">SMTP:</td><td style="padding: 0.5rem 0.5rem;">${stats.smtp_configured ? '✅ Настроен' : '❌ Не настроен'}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Размер БД:</td><td style="padding: 0.5rem 0.5rem;">${(stats.db_size / 1024).toFixed(1)} KB<\/td></tr>
            </table>
        </div>
    `;
}

// ========== Users Management ==========
async function renderUsers() {
    const data = await apiCall('/api/admin/users');
    return `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">👥 Список пользователей</h3>
                <button class="btn btn-primary btn-sm" onclick="adminCreateUser()">+ Добавить пользователя</button>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>ID</th><th>Логин</th><th>ФИО</th><th>Роль</th><th>Email</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${data.items.map(u => `
                            <tr>
                                <td>${u.id}</td>
                                <td>${escapeHtml(u.username)}</td>
                                <td>${escapeHtml(u.full_name)}</td>
                                <td><span class="badge badge-info">${escapeHtml(u.role)}</span></td>
                                <td>${escapeHtml(u.email || '—')}</td>
                                <td class="actions">
                                    <button class="btn btn-secondary btn-sm" onclick="adminEditUser(${u.id})">✏️</button>
                                    <button class="btn btn-danger btn-sm" onclick="adminDeleteUser(${u.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminCreateUser = function() {
    showModal('Создание пользователя', `
        <div class="form-group">
            <label>Логин *</label>
            <input type="text" id="user-username" placeholder="username">
        </div>
        <div class="form-group">
            <label>Пароль *</label>
            <input type="password" id="user-password" placeholder="минимум 8 символов">
        </div>
        <div class="form-group">
            <label>ФИО *</label>
            <input type="text" id="user-fullname" placeholder="Иванов Иван Иванович">
        </div>
        <div class="form-group">
            <label>Email</label>
            <input type="email" id="user-email" placeholder="email@example.com">
        </div>
        <div class="form-group">
            <label>Роль *</label>
            <select id="user-role">
                <option value="employee">Сотрудник</option>
                <option value="guard">Пост охраны</option>
                <option value="nurse_chief">Старшая медсестра</option>
                <option value="admin">Администратор</option>
            </select>
        </div>
    `, async () => {
        const username = document.getElementById('user-username')?.value.trim();
        const password = document.getElementById('user-password')?.value;
        const full_name = document.getElementById('user-fullname')?.value.trim();
        const email = document.getElementById('user-email')?.value.trim();
        const role = document.getElementById('user-role')?.value;
        
        if (!username || !password || !full_name) {
            toast('Заполните обязательные поля', 'error');
            return;
        }
        
        await apiCall('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, full_name, email, role })
        });
        
        toast('Пользователь создан', 'success');
        loadView('users');
    });
};

window.adminEditUser = async function(id) {
    const users = await apiCall('/api/admin/users');
    const user = users.items.find(u => u.id === id);
    if (!user) return;
    
    showModal('Редактирование пользователя', `
        <div class="form-group">
            <label>ФИО</label>
            <input type="text" id="user-fullname" value="${escapeHtml(user.full_name)}">
        </div>
        <div class="form-group">
            <label>Email</label>
            <input type="email" id="user-email" value="${escapeHtml(user.email || '')}">
        </div>
        <div class="form-group">
            <label>Роль</label>
            <select id="user-role">
                <option value="employee" ${user.role === 'employee' ? 'selected' : ''}>Сотрудник</option>
                <option value="guard" ${user.role === 'guard' ? 'selected' : ''}>Пост охраны</option>
                <option value="nurse_chief" ${user.role === 'nurse_chief' ? 'selected' : ''}>Старшая медсестра</option>
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Администратор</option>
            </select>
        </div>
        <div class="form-group">
            <label>Новый пароль (оставьте пустым, чтобы не менять)</label>
            <input type="password" id="user-password" placeholder="новый пароль">
        </div>
    `, async () => {
        const body = {
            full_name: document.getElementById('user-fullname')?.value,
            email: document.getElementById('user-email')?.value,
            role: document.getElementById('user-role')?.value
        };
        const password = document.getElementById('user-password')?.value;
        if (password) body.password = password;
        
        await apiCall(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
        toast('Пользователь обновлён', 'success');
        loadView('users');
    });
};

window.adminDeleteUser = async function(id) {
    if (!confirm('Удалить пользователя? Это действие необратимо.')) return;
    try {
        await apiCall(`/api/admin/users/${id}`, { method: 'DELETE' });
        toast('Пользователь удалён', 'success');
        loadView('users');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Employees Management ==========
async function renderEmployees() {
    const data = await apiCall('/api/admin/employees');
    return `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">👨‍⚕️ Сотрудники</h3>
                <button class="btn btn-primary btn-sm" onclick="adminCreateEmployee()">+ Добавить сотрудника</button>
            </div>
            <div class="table-wrapper">
                <tr>
                    <thead><tr><th>Табельный №</th><th>ФИО</th><th>Должность</th><th>Отделение</th><th>Статус</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${data.items.map(e => `
                            <tr>
                                <td>${escapeHtml(e.badge_number)}</td>
                                <td>${escapeHtml(e.full_name)}</td>
                                <td>${escapeHtml(e.position)}</td>
                                <td>${escapeHtml(e.department || '—')}</td>
                                <td>${e.is_active ? '<span class="badge badge-success">Активен</span>' : '<span class="badge badge-danger">Деактивирован</span>'}</td>
                                <td class="actions">
                                    <button class="btn btn-secondary btn-sm" onclick="adminEditEmployee(${e.id})">✏️</button>
                                    <button class="btn btn-danger btn-sm" onclick="adminDeleteEmployee(${e.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminCreateEmployee = function() {
    showModal('Создание сотрудника', `
        <div class="form-group">
            <label>Табельный номер *</label>
            <input type="text" id="emp-badge" placeholder="E-001">
        </div>
        <div class="form-group">
            <label>ФИО *</label>
            <input type="text" id="emp-name" placeholder="Иванов Иван Иванович">
        </div>
        <div class="form-group">
            <label>Должность *</label>
            <input type="text" id="emp-position" placeholder="Врач">
        </div>
        <div class="form-group">
            <label>Отделение</label>
            <input type="text" id="emp-department" placeholder="Хирургия">
        </div>
    `, async () => {
        await apiCall('/api/admin/employees', {
            method: 'POST',
            body: JSON.stringify({
                badge_number: document.getElementById('emp-badge')?.value,
                full_name: document.getElementById('emp-name')?.value,
                position: document.getElementById('emp-position')?.value,
                department: document.getElementById('emp-department')?.value
            })
        });
        toast('Сотрудник создан', 'success');
        loadView('employees');
    });
};

window.adminEditEmployee = async function(id) {
    const employees = await apiCall('/api/admin/employees');
    const e = employees.items.find(emp => emp.id === id);
    if (!e) return;
    
    showModal('Редактирование сотрудника', `
        <div class="form-group">
            <label>Табельный номер</label>
            <input type="text" id="emp-badge" value="${escapeHtml(e.badge_number)}">
        </div>
        <div class="form-group">
            <label>ФИО</label>
            <input type="text" id="emp-name" value="${escapeHtml(e.full_name)}">
        </div>
        <div class="form-group">
            <label>Должность</label>
            <input type="text" id="emp-position" value="${escapeHtml(e.position)}">
        </div>
        <div class="form-group">
            <label>Отделение</label>
            <input type="text" id="emp-department" value="${escapeHtml(e.department || '')}">
        </div>
        <div class="form-group">
            <label><input type="checkbox" id="emp-active" ${e.is_active ? 'checked' : ''}> Активен</label>
        </div>
    `, async () => {
        await apiCall(`/api/admin/employees/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                badge_number: document.getElementById('emp-badge')?.value,
                full_name: document.getElementById('emp-name')?.value,
                position: document.getElementById('emp-position')?.value,
                department: document.getElementById('emp-department')?.value,
                is_active: document.getElementById('emp-active')?.checked ? 1 : 0
            })
        });
        toast('Сотрудник обновлён', 'success');
        loadView('employees');
    });
};

window.adminDeleteEmployee = async function(id) {
    if (!confirm('Деактивировать сотрудника?')) return;
    try {
        await apiCall(`/api/admin/employees/${id}`, { method: 'DELETE' });
        toast('Сотрудник деактивирован', 'success');
        loadView('employees');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Zones Management ==========
async function renderZones() {
    const data = await apiCall('/api/admin/zones');
    return `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">🏥 Зоны доступа</h3>
                <button class="btn btn-primary btn-sm" onclick="adminCreateZone()">+ Добавить зону</button>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Название</th><th>Тип</th><th>Уровень</th><th>Описание</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${data.items.map(z => `
                            <tr>
                                <td>${escapeHtml(z.name)}</td>
                                <td><span class="badge badge-info">${escapeHtml(z.zone_type)}</span></td>
                                <td>${z.access_level}</td>
                                <td>${escapeHtml(z.description || '—')}</td>
                                <td class="actions">
                                    <button class="btn btn-secondary btn-sm" onclick="adminEditZone(${z.id})">✏️</button>
                                    <button class="btn btn-danger btn-sm" onclick="adminDeleteZone(${z.id})">🗑️</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminCreateZone = function() {
    showModal('Создание зоны', `
        <div class="form-group">
            <label>Название *</label>
            <input type="text" id="zone-name" placeholder="Операционная №1">
        </div>
        <div class="form-group">
            <label>Тип *</label>
            <select id="zone-type">
                <option value="operating">Операционная</option>
                <option value="reanimation">Реанимация</option>
                <option value="isolation">Изолятор</option>
                <option value="warehouse">Склад</option>
            </select>
        </div>
        <div class="form-group">
            <label>Уровень доступа</label>
            <input type="number" id="zone-level" value="1" min="1" max="5">
        </div>
        <div class="form-group">
            <label>Описание</label>
            <textarea id="zone-desc" rows="3"></textarea>
        </div>
    `, async () => {
        await apiCall('/api/admin/zones', {
            method: 'POST',
            body: JSON.stringify({
                name: document.getElementById('zone-name')?.value,
                zone_type: document.getElementById('zone-type')?.value,
                access_level: parseInt(document.getElementById('zone-level')?.value),
                description: document.getElementById('zone-desc')?.value
            })
        });
        toast('Зона создана', 'success');
        loadView('zones');
    });
};

window.adminEditZone = async function(id) {
    const zones = await apiCall('/api/admin/zones');
    const z = zones.items.find(zone => zone.id === id);
    if (!z) return;
    
    showModal('Редактирование зоны', `
        <div class="form-group">
            <label>Название</label>
            <input type="text" id="zone-name" value="${escapeHtml(z.name)}">
        </div>
        <div class="form-group">
            <label>Тип</label>
            <select id="zone-type">
                <option value="operating" ${z.zone_type === 'operating' ? 'selected' : ''}>Операционная</option>
                <option value="reanimation" ${z.zone_type === 'reanimation' ? 'selected' : ''}>Реанимация</option>
                <option value="isolation" ${z.zone_type === 'isolation' ? 'selected' : ''}>Изолятор</option>
                <option value="warehouse" ${z.zone_type === 'warehouse' ? 'selected' : ''}>Склад</option>
            </select>
        </div>
        <div class="form-group">
            <label>Уровень доступа</label>
            <input type="number" id="zone-level" value="${z.access_level}" min="1" max="5">
        </div>
        <div class="form-group">
            <label>Описание</label>
            <textarea id="zone-desc" rows="3">${escapeHtml(z.description || '')}</textarea>
        </div>
        <div class="form-group">
            <label><input type="checkbox" id="zone-active" ${z.is_active ? 'checked' : ''}> Активна</label>
        </div>
    `, async () => {
        await apiCall(`/api/admin/zones/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: document.getElementById('zone-name')?.value,
                zone_type: document.getElementById('zone-type')?.value,
                access_level: parseInt(document.getElementById('zone-level')?.value),
                description: document.getElementById('zone-desc')?.value,
                is_active: document.getElementById('zone-active')?.checked ? 1 : 0
            })
        });
        toast('Зона обновлена', 'success');
        loadView('zones');
    });
};

window.adminDeleteZone = async function(id) {
    if (!confirm('Деактивировать зону?')) return;
    try {
        await apiCall(`/api/admin/zones/${id}`, { method: 'DELETE' });
        toast('Зона деактивирована', 'success');
        loadView('zones');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Permissions ==========
async function renderPermissions() {
    const [permissions, employees, zones] = await Promise.all([
        apiCall('/api/admin/permissions'),
        apiCall('/api/admin/employees'),
        apiCall('/api/admin/zones')
    ]);
    
    return `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">🔑 Выдать допуск</h3>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Сотрудник</label>
                    <select id="perm-employee">
                        ${employees.items.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)} (${escapeHtml(e.badge_number)})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Зона</label>
                    <select id="perm-zone">
                        ${zones.items.map(z => `<option value="${z.id}">${escapeHtml(z.name)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <button class="btn btn-primary" onclick="adminGrantPermission()">Выдать допуск</button>
        </div>
        
        <div class="card">
            <h3>📋 Существующие допуски</h3>
            <div class="table-wrapper">
                </table>
                    <thead><tr><th>Сотрудник</th><th>Зона</th><th>Выдан</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${permissions.items.map(p => `
                            <tr>
                                <td>${escapeHtml(p.employee_name)} (${escapeHtml(p.badge_number)})</td>
                                <td>${escapeHtml(p.zone_name)}</td>
                                <td>${escapeHtml(p.granted_at)}</td>
                                <td class="actions">
                                    <button class="btn btn-danger btn-sm" onclick="adminRevokePermission(${p.id})">Отозвать</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminGrantPermission = async function() {
    try {
        await apiCall('/api/admin/permissions', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: parseInt(document.getElementById('perm-employee')?.value),
                zone_id: parseInt(document.getElementById('perm-zone')?.value)
            })
        });
        toast('Допуск выдан', 'success');
        loadView('permissions');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminRevokePermission = async function(id) {
    if (!confirm('Отозвать допуск?')) return;
    try {
        await apiCall(`/api/admin/permissions/${id}`, { method: 'DELETE' });
        toast('Допуск отозван', 'success');
        loadView('permissions');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Documents ==========
async function renderDocuments() {
    const [books, exams, employees] = await Promise.all([
        apiCall('/api/admin/sanitary-books'),
        apiCall('/api/admin/medical-exams'),
        apiCall('/api/admin/employees')
    ]);
    
    return `
        <div class="card">
            <h3>📋 Добавить санитарную книжку</h3>
            <div class="form-row">
                <div class="form-group">
                    <label>Сотрудник</label>
                    <select id="book-employee">
                        ${employees.items.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Номер книжки</label>
                    <input type="text" id="book-number">
                </div>
                <div class="form-group">
                    <label>Дата выдачи</label>
                    <input type="date" id="book-issue">
                </div>
                <div class="form-group">
                    <label>Действует до</label>
                    <input type="date" id="book-expiry">
                </div>
            </div>
            <button class="btn btn-primary" onclick="adminAddSanitaryBook()">Добавить</button>
        </div>
        
        <div class="card">
            <h3>🩺 Добавить медосмотр</h3>
            <div class="form-row">
                <div class="form-group">
                    <label>Сотрудник</label>
                    <select id="exam-employee">
                        ${employees.items.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Дата осмотра</label>
                    <input type="date" id="exam-date">
                </div>
                <div class="form-group">
                    <label>Действует до</label>
                    <input type="date" id="exam-expiry">
                </div>
            </div>
            <button class="btn btn-primary" onclick="adminAddMedicalExam()">Добавить</button>
        </div>
        
        <div class="card">
            <h3>📖 Санитарные книжки</h3>
            <div class="table-wrapper">
                <tr>
                    <thead><tr><th>Сотрудник</th><th>№ книжки</th><th>Действует до</th><th>Статус</th><th></th></tr></thead>
                    <tbody>
                        ${books.items.map(b => `
                            <tr>
                                <td>${escapeHtml(b.employee_name)}</td>
                                <td>${escapeHtml(b.book_number)}</td>
                                <td>${escapeHtml(b.expiry_date)}</td>
                                <td><span class="badge ${b.status === 'valid' ? 'badge-success' : 'badge-danger'}">${escapeHtml(b.status)}</span></td>
                                <td><button class="btn btn-danger btn-sm" onclick="adminDeleteBook(${b.id})">Удалить</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="card">
            <h3>📖 Медосмотры</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Сотрудник</th><th>Дата</th><th>Действует до</th><th>Статус</th><th></th></tr></thead>
                    <tbody>
                        ${exams.items.map(e => `
                            <tr>
                                <td>${escapeHtml(e.employee_name)}</td>
                                <td>${escapeHtml(e.exam_date)}</td>
                                <td>${escapeHtml(e.expiry_date)}</td>
                                <td><span class="badge ${e.status === 'valid' ? 'badge-success' : 'badge-danger'}">${escapeHtml(e.status)}</span></td>
                                <td><button class="btn btn-danger btn-sm" onclick="adminDeleteExam(${e.id})">Удалить</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminAddSanitaryBook = async function() {
    try {
        await apiCall('/api/admin/sanitary-books', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: parseInt(document.getElementById('book-employee')?.value),
                book_number: document.getElementById('book-number')?.value,
                issue_date: document.getElementById('book-issue')?.value,
                expiry_date: document.getElementById('book-expiry')?.value
            })
        });
        toast('Санкнижка добавлена', 'success');
        loadView('documents');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminAddMedicalExam = async function() {
    try {
        await apiCall('/api/admin/medical-exams', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: parseInt(document.getElementById('exam-employee')?.value),
                exam_date: document.getElementById('exam-date')?.value,
                expiry_date: document.getElementById('exam-expiry')?.value
            })
        });
        toast('Медосмотр добавлен', 'success');
        loadView('documents');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminDeleteBook = async function(id) {
    if (!confirm('Удалить запись?')) return;
    try {
        await apiCall(`/api/admin/sanitary-books/${id}`, { method: 'DELETE' });
        toast('Удалено', 'success');
        loadView('documents');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminDeleteExam = async function(id) {
    if (!confirm('Удалить запись?')) return;
    try {
        await apiCall(`/api/admin/medical-exams/${id}`, { method: 'DELETE' });
        toast('Удалено', 'success');
        loadView('documents');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Registrations ==========
async function renderRegistrations() {
    const data = await apiCall('/api/admin/registrations');
    if (!data.items.length) {
        return '<div class="card"><p class="empty">Нет активных заявок</p></div>';
    }
    
    return `
        <div class="card">
            <h3>📝 Заявки на регистрацию</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Дата</th><th>ФИО</th><th>Логин</th><th>Email</th><th>Роль</th><th>Статус</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${data.items.map(r => `
                            <tr>
                                <td>${escapeHtml(r.created_at)}</td>
                                <td>${escapeHtml(r.full_name)}</td>
                                <td>${escapeHtml(r.username)}</td>
                                <td>${escapeHtml(r.email)}</td>
                                <td><span class="badge badge-info">${escapeHtml(r.role)}</span></td>
                                <td>${r.status === 'pending_admin' ? '<span class="badge badge-warning">Ждёт админа</span>' : '<span class="badge badge-info">Ждёт email</span>'}</td>
                                <td class="actions">
                                    ${r.status === 'pending_admin' ? `
                                        <button class="btn btn-primary btn-sm" onclick="adminApproveReg(${r.id})">✅ Одобрить</button>
                                        <button class="btn btn-danger btn-sm" onclick="adminRejectReg(${r.id})">❌ Отклонить</button>
                                    ` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminApproveReg = async function(id) {
    if (!confirm('Одобрить регистрацию?')) return;
    try {
        await apiCall(`/api/admin/registrations/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
        toast('Заявка одобрена', 'success');
        loadView('registrations');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminRejectReg = async function(id) {
    const note = prompt('Причина отклонения:');
    try {
        await apiCall(`/api/admin/registrations/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
        toast('Заявка отклонена', 'success');
        loadView('registrations');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Incidents ==========
async function renderIncidents() {
    const data = await apiCall('/api/admin/incidents');
    return `
        <div class="card">
            <h3>⚠️ Инциденты</h3>
            <div class="table-wrapper">
                <tr>
                    <thead><tr><th>Дата</th><th>Сотрудник</th><th>Тип</th><th>Описание</th><th>Статус</th><th>Действия</th></tr></thead>
                    <tbody>
                        ${data.items.map(i => `
                            <tr>
                                <td>${escapeHtml(i.created_at)}</td>
                                <td>${escapeHtml(i.employee_name)}</td>
                                <td>${escapeHtml(i.incident_type)}</td>
                                <td>${escapeHtml(i.description)}</td>
                                <td><span class="badge ${i.status === 'resolved' ? 'badge-success' : 'badge-warning'}">${escapeHtml(i.status)}</span></td>
                                <td class="actions">
                                    ${i.status !== 'resolved' ? `<button class="btn btn-primary btn-sm" onclick="adminResolveIncident(${i.id})">✅ Обработать</button>` : ''}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminResolveIncident = function(id) {
    showModal('Обработка инцидента', `
        <div class="form-group">
            <label>Примечание</label>
            <textarea id="incident-note" rows="4"></textarea>
        </div>
        <div class="form-group">
            <label>Статус</label>
            <select id="incident-status">
                <option value="in_progress">В работе</option>
                <option value="resolved">Закрыт</option>
            </select>
        </div>
    `, async () => {
        await apiCall(`/api/admin/incidents/${id}`, {
            method: 'PUT',
            body: JSON.stringify({
                status: document.getElementById('incident-status')?.value,
                resolution_note: document.getElementById('incident-note')?.value
            })
        });
        toast('Инцидент обновлён', 'success');
        loadView('incidents');
    });
};

// ========== Access Logs ==========
async function renderAccessLogs() {
    const data = await apiCall('/api/admin/access-logs');
    return `
        <div class="card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h3 style="margin: 0;">📊 Журнал проходов</h3>
                <button class="btn btn-primary btn-sm" onclick="adminExportAccessLogs()">📥 Экспорт CSV</button>
            </div>
            <div class="table-wrapper">
                <table>
                    <thead>
                        <tr><th>Время</th><th>Сотрудник</th><th>Зона</th><th>Направление</th><th>Темп.</th><th>Результат</th><th>Причина</th></tr>
                    </thead>
                    <tbody>
                        ${data.items.map(l => `
                            <tr>
                                <td>${escapeHtml(l.event_time)}</td>
                                <td>${escapeHtml(l.employee_name)}</td>
                                <td>${escapeHtml(l.zone_name)}</td>
                                <td>${l.direction === 'in' ? 'Вход' : 'Выход'}</td>
                                <td>${l.temperature || '—'}</td>
                                <td>${l.allowed ? '<span class="badge badge-success">Разрешён</span>' : '<span class="badge badge-danger">Блокировка</span>'}</td>
                                <td>${escapeHtml(l.block_reason || '—')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

window.adminExportAccessLogs = async function() {
    try {
        const data = await apiCall('/api/admin/access-logs?per_page=1000');
        const rows = [['Время', 'Сотрудник', 'Зона', 'Направление', 'Температура', 'Результат', 'Причина']];
        data.items.forEach(l => {
            rows.push([
                l.event_time, l.employee_name, l.zone_name,
                l.direction === 'in' ? 'Вход' : 'Выход',
                l.temperature || '', l.allowed ? 'Разрешён' : 'Блокировка',
                l.block_reason || ''
            ]);
        });
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `access_logs_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        toast('Экспорт завершён', 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
};

// ========== Audit ==========
async function renderAudit() {
    const data = await apiCall('/api/admin/audit');
    return `
        <div class="card">
            <h3>📋 Журнал аудита</h3>
            <div class="table-wrapper">
                <table>
                    <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Таблица</th><th>Детали</th></tr></thead>
                    <tbody>
                        ${data.items.map(a => `
                            <tr>
                                <td>${escapeHtml(a.created_at)}</td>
                                <td>${escapeHtml(a.username || '—')}</td>
                                <td>${escapeHtml(a.action)}</td>
                                <td>${escapeHtml(a.table_name || '—')}</td>
                                <td>${escapeHtml((a.details || '').substring(0, 100))}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// ========== Settings ==========
async function renderSettings() {
    return `
        <div class="card">
            <h3>📧 Настройки SMTP</h3>
            <div class="form-group" style="margin-top: 1rem;">
                <label>Тестовый email</label>
                <input type="email" id="test-email" placeholder="test@example.com">
            </div>
            <button class="btn btn-primary" onclick="adminTestSmtp()">Отправить тестовое письмо</button>
        </div>
        
        <div class="card">
            <h3>🔧 Действия</h3>
            <button class="btn btn-danger" onclick="adminClearCache()">Очистить кэш</button>
        </div>
    `;
}

window.adminTestSmtp = async function() {
    const email = document.getElementById('test-email')?.value;
    if (!email) {
        toast('Введите email', 'error');
        return;
    }
    try {
        await apiCall('/api/admin/smtp-test', { method: 'POST', body: JSON.stringify({ email }) });
        toast('Письмо отправлено!', 'success');
    } catch (e) {
        toast(e.message, 'error');
    }
};

window.adminClearCache = function() {
    if (confirm('Очистить кэш браузера для этого сайта?')) {
        localStorage.clear();
        sessionStorage.clear();
        toast('Кэш очищен, страница будет перезагружена', 'success');
        setTimeout(() => window.location.reload(), 1000);
    }
};

// ========== System ==========
async function renderSystem() {
    const stats = await apiCall('/api/admin/dashboard-stats');
    const system = await apiCall('/api/admin/system-info');
    
    return `
        <div class="card">
            <h3>💻 Системная информация</h3>
            <table style="width: auto;">
                <tr><td style="padding: 0.5rem 0;">Версия Python:</td><td style="padding: 0.5rem 1rem;">${system.python_version}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Платформа:</td><td style="padding: 0.5rem 1rem;">${system.platform}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Серверное время:</td><td style="padding: 0.5rem 1rem;">${system.server_time}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">SMTP:</td><td style="padding: 0.5rem 1rem;">${stats.smtp_configured ? '✅ Настроен' : '❌ Не настроен'}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Размер БД:</td><td style="padding: 0.5rem 1rem;">${(stats.db_size / 1024).toFixed(1)} KB<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Всего пользователей:</td><td style="padding: 0.5rem 1rem;">${stats.total_users}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Всего сотрудников:</td><td style="padding: 0.5rem 1rem;">${stats.total_employees}<\/td></tr>
                <tr><td style="padding: 0.5rem 0;">Всего зон:</td><td style="padding: 0.5rem 1rem;">${stats.total_zones}<\/td></tr>
            </table>
        </div>
    `;
}

// ========== TERMINAL (ПРОХОД) - ДОБАВЛЕНАЯ ЧАСТЬ ==========

let terminalPreviewFn = null;

async function renderTerminal() {
    const [employees, zones] = await Promise.all([
        apiCall('/api/admin/employees'),
        apiCall('/api/admin/zones')
    ]);
    
    setTimeout(() => {
        initTerminalEvents();
    }, 100);
    
    return `
        <div class="card">
            <div class="card-head">
                <h3>🚪 Терминал прохода</h3>
                <button class="btn btn-secondary btn-sm" id="terminal-kiosk-btn">⛶ Киоск режим</button>
            </div>
            
            <div id="terminal-led" class="terminal-led idle">
                <div class="led-icon">⏳</div>
                <div class="led-text">Выберите сотрудника и зону</div>
            </div>
            
            <div class="form-group">
                <label>🔍 Скан табельного номера / QR</label>
                <input type="text" id="pass-scan" placeholder="Поднесите бейдж или введите номер..." autocomplete="off">
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>👤 Сотрудник</label>
                    <select id="pass-employee">
                        <option value="">-- Выберите сотрудника --</option>
                        ${employees.items.map(e => `<option value="${e.id}">${escapeHtml(e.badge_number)} — ${escapeHtml(e.full_name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>📍 Зона доступа</label>
                    <select id="pass-zone">
                        <option value="">-- Выберите зону --</option>
                        ${zones.items.filter(z => z.is_active).map(z => `<option value="${z.id}">${escapeHtml(z.name)} (${escapeHtml(z.zone_type)})</option>`).join('')}
                    </select>
                </div>
            </div>
            
            <div class="form-row">
                <div class="form-group">
                    <label>↔️ Направление</label>
                    <select id="pass-direction">
                        <option value="in">🚪 Вход</option>
                        <option value="out">🚶‍♂️ Выход</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>🌡️ Температура °C</label>
                    <input type="number" id="pass-temp" step="0.1" value="36.6">
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <button class="btn btn-secondary" id="btn-precheck" style="flex:1">🔍 Предварительная проверка</button>
                <button class="btn btn-primary" id="btn-pass" style="flex:1">✅ Зарегистрировать проход</button>
            </div>
            
            <div id="precheck-result" class="precheck-result"></div>
            <div id="pass-result"></div>
        </div>
        
        <div class="card">
            <h3>📋 Чек-лист санэпидконтроля</h3>
            <ul style="list-style: none; padding: 0;">
                <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border);">✓ Допуск в зону по матрице прав</li>
                <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border);">✓ Действующая санитарная книжка</li>
                <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border);">✓ Актуальный медосмотр</li>
                <li style="padding: 0.5rem 0;">✓ Температурный скрининг ≤ 37.0°C</li>
            </ul>
        </div>
    `;
}

function initTerminalEvents() {
    const led = document.getElementById('terminal-led');
    
    function updateLed(allowed, text) {
        if (!led) return;
        led.className = `terminal-led ${allowed === null ? 'idle' : allowed ? 'green' : 'red'}`;
        led.innerHTML = `<div class="led-icon">${allowed === null ? '⏳' : allowed ? '✓' : '✗'}</div><div class="led-text">${text}</div>`;
    }
    
    terminalPreviewFn = updateLed;
    
    // Скан по Enter
    const scanInput = document.getElementById('pass-scan');
    const empSelect = document.getElementById('pass-employee');
    
    scanInput?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = scanInput.value.trim().toLowerCase();
        if (!val || !empSelect) return;
        const option = [...empSelect.options].find(o => o.text.toLowerCase().includes(val) || o.value === val);
        if (option && option.value) {
            empSelect.value = option.value;
            scanInput.value = '';
            updateLed(null, 'Сотрудник выбран');
            runPrecheckTerminal();
        } else {
            updateLed(false, 'БЕЙДЖ НЕ НАЙДЕН');
            setTimeout(() => updateLed(null, 'Выберите сотрудника и зону'), 2000);
        }
    });
    
    // Киоск режим
    document.getElementById('terminal-kiosk-btn')?.addEventListener('click', () => {
        document.body.classList.toggle('kiosk-mode');
        toast(document.body.classList.contains('kiosk-mode') ? 'Режим киоска включен' : 'Обычный режим', 'info');
    });
    
    // Предпроверка
    document.getElementById('btn-precheck')?.addEventListener('click', runPrecheckTerminal);
    document.getElementById('btn-pass')?.addEventListener('click', registerPassTerminal);
    document.getElementById('pass-employee')?.addEventListener('change', runPrecheckTerminal);
    document.getElementById('pass-zone')?.addEventListener('change', runPrecheckTerminal);
    document.getElementById('pass-temp')?.addEventListener('change', runPrecheckTerminal);
}

async function runPrecheckTerminal() {
    const employeeId = document.getElementById('pass-employee')?.value;
    const zoneId = document.getElementById('pass-zone')?.value;
    const temperature = parseFloat(document.getElementById('pass-temp')?.value || 36.6);
    
    if (!employeeId || !zoneId) {
        if (terminalPreviewFn) terminalPreviewFn(null, 'Выберите сотрудника и зону');
        return;
    }
    
    try {
        const res = await apiCall('/api/access/precheck', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: parseInt(employeeId),
                zone_id: parseInt(zoneId),
                temperature: temperature
            })
        });
        
        const resultDiv = document.getElementById('precheck-result');
        resultDiv.innerHTML = `
            <div class="card" style="margin-top: 1rem; padding: 1rem;">
                <h4>Проверка: ${escapeHtml(res.employee_name)} → ${escapeHtml(res.zone_name)}</h4>
                <ul class="check-list">
                    ${res.checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}"><span>${escapeHtml(c.name)}</span><span>${c.ok ? '✓' : '✗'} ${escapeHtml(c.detail || '')}</span></li>`).join('')}
                </ul>
                <p style="font-weight: 700; color: ${res.allowed ? 'var(--success)' : 'var(--danger)'}">${res.allowed ? '✅ Допуск возможен' : '❌ Проход будет заблокирован'}</p>
            </div>
        `;
        
        if (terminalPreviewFn) {
            terminalPreviewFn(res.allowed, res.allowed ? 'ДОПУСК РАЗРЕШЁН' : 'ДОПУСК ЗАПРЕЩЁН');
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function registerPassTerminal() {
    const employeeId = document.getElementById('pass-employee')?.value;
    const zoneId = document.getElementById('pass-zone')?.value;
    const direction = document.getElementById('pass-direction')?.value;
    const temperature = parseFloat(document.getElementById('pass-temp')?.value || 36.6);
    
    if (!employeeId || !zoneId) {
        toast('Выберите сотрудника и зону', 'error');
        return;
    }
    
    try {
        const res = await apiCall('/api/access/pass', {
            method: 'POST',
            body: JSON.stringify({
                employee_id: parseInt(employeeId),
                zone_id: parseInt(zoneId),
                direction: direction,
                temperature: temperature
            })
        });
        
        const resultDiv = document.getElementById('pass-result');
        resultDiv.className = `pass-result ${res.allowed ? 'allowed' : 'denied'}`;
        resultDiv.innerHTML = res.allowed
            ? `<h3>✓ Проход разрешён</h3><p>${escapeHtml(res.log.employee_name)} → ${escapeHtml(res.log.zone_name)} (${direction === 'in' ? 'вход' : 'выход'})</p>`
            : `<h3>✗ Проход заблокирован</h3><p>${res.violations.join('; ')}</p>${res.incident_id ? '<p>⚠️ Инцидент создан</p>' : ''}`;
        
        if (terminalPreviewFn) {
            terminalPreviewFn(res.allowed, res.allowed ? 'ПРОХОД ЗАРЕГИСТРИРОВАН' : 'ПРОХОД ЗАБЛОКИРОВАН');
            setTimeout(() => terminalPreviewFn(null, 'Выберите сотрудника и зону'), 3000);
        }
        
        toast(res.allowed ? 'Проход разрешён!' : 'Проход заблокирован!', res.allowed ? 'success' : 'error');
        
        // Очищаем скан
        document.getElementById('pass-scan').value = '';
        
    } catch (e) {
        toast(e.message, 'error');
    }
}

// ========== Navigation & Routing ==========
const views = {
    dashboard: renderDashboard,
    terminal: renderTerminal,
    users: renderUsers,
    employees: renderEmployees,
    zones: renderZones,
    permissions: renderPermissions,
    documents: renderDocuments,
    registrations: renderRegistrations,
    incidents: renderIncidents,
    'access-logs': renderAccessLogs,
    audit: renderAudit,
    settings: renderSettings,
    system: renderSystem
};

const viewTitles = {
    dashboard: 'Панель управления',
    terminal: 'Терминал прохода',
    users: 'Управление пользователями',
    employees: 'Сотрудники',
    zones: 'Зоны доступа',
    permissions: 'Допуски',
    documents: 'Документы',
    registrations: 'Заявки на регистрацию',
    incidents: 'Инциденты',
    'access-logs': 'Журнал проходов',
    audit: 'Журнал аудита',
    settings: 'Настройки',
    system: 'Системная информация'
};

async function loadView(viewName) {
    currentView = viewName;
    const content = document.getElementById('view-content');
    const pageTitle = document.getElementById('page-title');
    
    if (pageTitle) {
        pageTitle.textContent = viewTitles[viewName] || 'Админ-панель';
    }
    
    content.innerHTML = '<div class="loading">Загрузка...</div>';
    
    const fn = views[viewName];
    if (fn) {
        try {
            content.innerHTML = await fn();
        } catch (e) {
            content.innerHTML = `<div class="card"><p class="empty">Ошибка: ${escapeHtml(e.message)}</p></div>`;
            toast(e.message, 'error');
        }
    } else {
        content.innerHTML = '<div class="card"><p class="empty">Страница не найдена</p></div>';
    }
    
    document.querySelectorAll('.admin-nav a[data-view]').forEach(a => {
        if (a.getAttribute('data-view') === viewName) {
            a.classList.add('active');
        } else {
            a.classList.remove('active');
        }
    });
    
    window.location.hash = viewName;
}

function handleHashChange() {
    const hash = window.location.hash.slice(1);
    if (hash && views[hash]) {
        loadView(hash);
    } else {
        loadView('dashboard');
    }
}

async function logout() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    window.location.href = '/admin/login';
}

async function init() {
    initTheme();
    const authenticated = await checkAdminAuth();
    if (!authenticated) return;
    
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        logout();
    });
    
    document.querySelectorAll('.admin-nav a[data-view]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const view = a.getAttribute('data-view');
            if (view) loadView(view);
        });
    });
    
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
}

// Инициализация темы
function initTheme() {
    const saved = localStorage.getItem('sanepid_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    syncThemeToggle();
}

function syncThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
}

function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sanepid_theme', next);
    syncThemeToggle();
}

// Запуск
init();