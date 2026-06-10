const API = '/api';
const TOKEN_KEY = 'sanepid_token';
const USER_KEY = 'sanepid_user';

const ROLE_LABELS = {
  admin: 'Администратор',
  nurse_chief: 'Старшая медсестра',
  guard: 'Пост охраны',
  employee: 'Сотрудник',
};

const ZONE_TYPES = {
  operating: 'Операционная',
  reanimation: 'Реанимация',
  isolation: 'Изолятор',
  warehouse: 'Склад',
};

let state = { user: null, route: 'dashboard', params: {}, reg: { step: 1, requestId: null, captcha: null, role: 'employee', email: '' } };

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

async function apiCall(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (state.route !== 'login') {
      clearAuth();
      state.route = 'login';
      location.hash = '#/login';
    }
    throw new Error(data.error || 'Unauthorized');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}
function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  state.user = user;
}
function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  state.user = null;
}

const api = apiCall;
window.api = apiCall;
window.getToken = getToken;
window.toast = toast;

function navigate(route, params = {}) {
  state.route = route;
  state.params = params;
  const suffix = params.id ? `/${params.id}` : '';
  location.hash = `#/${route}${suffix}`;
  render();
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [route, id] = raw.split('/').filter(Boolean);
  state.route = route || (getUser() ? 'dashboard' : 'login');
  state.params = id ? { id } : {};
}

const NAV = {
  admin: [
    { route: 'dashboard', label: '🏠 Главная' },
    { route: 'terminal', label: '🚪 Проход' },
    { route: 'employees', label: '👥 Сотрудники' },
    { route: 'zones', label: '🏥 Зоны' },
    { route: 'permissions', label: '🔑 Допуски' },
    { route: 'documents', label: '📋 Документы' },
    { route: 'access-logs', label: '📊 Журнал' },
    { route: 'incidents', label: '⚠ Инциденты' },
    { route: 'compliance', label: '📈 Аналитика' },
    { route: 'users', label: '⚙ Пользователи' },
    { route: 'registrations', label: '📝 Заявки' },
    { route: 'settings', label: '📧 Почта' },
    { route: 'audit', label: '📋 Аудит' },
  ],
  nurse_chief: [
    { route: 'dashboard', label: '🏠 Главная' },
    { route: 'employees', label: '👥 Сотрудники' },
    { route: 'documents', label: '📋 Документы' },
    { route: 'access-logs', label: '📊 Журнал' },
    { route: 'incidents', label: '⚠ Инциденты' },
    { route: 'compliance', label: '📈 Аналитика' },
  ],
  guard: [
    { route: 'dashboard', label: '🏠 Главная' },
    { route: 'terminal', label: '🚪 Проход' },
    { route: 'employees', label: '👥 Сотрудники' },
    { route: 'access-logs', label: '📊 Журнал' },
  ],
  employee: [
    { route: 'dashboard', label: '🏠 Главная' },
    { route: 'my-profile', label: '🪪 Мой профиль' },
    { route: 'access-logs', label: '📊 Мои проходы' },
  ],
};

const ROUTE_ACCESS = {
  dashboard: ['admin', 'nurse_chief', 'guard', 'employee'],
  terminal: ['admin', 'guard'],
  employees: ['admin', 'nurse_chief', 'guard'],
  'employee-detail': ['admin', 'nurse_chief', 'guard', 'employee'],
  zones: ['admin'],
  permissions: ['admin'],
  documents: ['admin', 'nurse_chief'],
  'access-logs': ['admin', 'nurse_chief', 'guard', 'employee'],
  incidents: ['admin', 'nurse_chief'],
  compliance: ['admin', 'nurse_chief'],
  users: ['admin'],
  registrations: ['admin'],
  settings: ['admin'],
  audit: ['admin'],
  'my-profile': ['employee'],
  login: ['admin', 'nurse_chief', 'guard', 'employee'],
};

function canAccessRoute(route) {
  if (!state.user) return route === 'login';
  const allowed = ROUTE_ACCESS[route];
  return !allowed || allowed.includes(state.user.role);
}

function canSeeIncidents() {
  return state.user && ['admin', 'nurse_chief'].includes(state.user.role);
}

function roleCan(action) {
  const r = state.user?.role;
  const map = {
    deleteEmployee: ['admin'],
    deleteZone: ['admin'],
    deleteUser: ['admin'],
    deleteBook: ['admin'],
    deleteExam: ['admin'],
    editEmployee: ['admin'],
    editZone: ['admin'],
    editUser: ['admin'],
    grantPerm: ['admin'],
    revokePerm: ['admin'],
    addZone: ['admin'],
    addEmployee: ['admin'],
    exportCsv: ['admin', 'nurse_chief', 'guard'],
  };
  return map[action]?.includes(r);
}

function renderNav() {
  const nav = document.getElementById('nav');
  const ui = document.getElementById('user-info');
  const topbar = document.getElementById('topbar');
  if (!state.user) {
    nav.classList.add('hidden');
    ui.classList.add('hidden');
    document.getElementById('topbar-tools')?.classList.add('hidden');
    return;
  }
  nav.classList.remove('hidden');
  ui.classList.remove('hidden');
  const items = NAV[state.user.role] || NAV.employee;
  nav.innerHTML = items.map(i =>
    `<button class="${state.route === i.route ? 'active' : ''}" onclick="navigate('${i.route}')">${i.label}</button>`
  ).join('') + `<button class="btn btn-ghost btn-sm" onclick="logout()">↩ Выход</button>`;
  ui.innerHTML = `<strong>${esc(state.user.full_name)}</strong><br>${ROLE_LABELS[state.user.role] || state.user.role}`;
  document.getElementById('topbar-tools')?.classList.remove('hidden');
  const bell = document.getElementById('notif-btn');
  if (bell) bell.classList.toggle('hidden', !canSeeIncidents());
  SanEpidUI?.syncThemeToggle?.();
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function badgeAllowed(v) {
  return v ? '<span class="badge badge-success">Разрешён</span>' : '<span class="badge badge-danger">Заблокирован</span>';
}
function badgeStatus(s) {
  const map = { open: 'badge-danger', in_progress: 'badge-warning', resolved: 'badge-success', valid: 'badge-success', expired: 'badge-danger' };
  const labels = { open: 'Открыт', in_progress: 'В работе', resolved: 'Закрыт', valid: 'Действует', expired: 'Просрочен' };
  return `<span class="badge ${map[s] || 'badge-info'}">${labels[s] || s}</span>`;
}

async function logout() {
  SanEpidPolish?.resetWelcome?.();
  clearAuth();
  navigate('login');
}

// --- Views ---
function loginFormHtml() {
  return `<div class="form-group"><label>Логин</label><input id="auth-user" autocomplete="username" placeholder="Введите логин"></div>
        <div class="form-group"><label>Пароль</label><input id="auth-pass" type="password" autocomplete="current-password" placeholder="Введите пароль"></div>
        <button class="btn btn-primary" style="width:100%" id="auth-login-submit">Войти в систему</button>`;
}

async function viewLogin() {
  return `<div class="auth-layout">
    <div class="auth-hero">
      <div class="hero-badge">SanEpid Control · Enterprise</div>
      <h2>Цифровой пропускной<br>и санэпидконтроль</h2>
      <p class="hero-lead">Мониторинг зон в реальном времени, терминал прохода с LED-индикацией, регистрация с подтверждением email и аудит по 152-ФЗ.</p>
      <p class="hero-live-note">● Показатели ниже — из базы клиники в реальном времени</p>
      <div class="hero-demo">
        <div class="hero-stat"><span class="hero-num" id="hero-passes">0</span><small>проходов сегодня</small></div>
        <div class="hero-stat ok"><span class="hero-num" id="hero-zones">0</span><small>зон под контролем</small></div>
        <div class="hero-stat warn"><span class="hero-num" id="hero-blocks">0</span><small>блокировок</small></div>
      </div>
      <ul class="hero-features">
        <li>🗺 Карта зон LIVE · лента проходов каждые 5 сек</li>
        <li>🚦 Терминал с предпроверкой и LED-панелью</li>
        <li>📧 Реальная отправка кода на email через SMTP</li>
        <li>⌨ Быстрый переход Ctrl+K после входа</li>
      </ul>
    </div>
    <div class="auth-wrap">
    <div class="card tilt-card glass-card">
      <div class="auth-card-head">
        <h2>Вход в систему</h2>
        <button type="button" class="theme-btn btn-sm" onclick="SanEpidUI.toggleTheme()" title="Тема">🌙</button>
      </div>
      <p class="auth-subtitle">Контроль проходов, санкнижек, медосмотров и температурного скрининга</p>
      <div class="tabs">
        <button class="btn btn-primary" id="tab-login">Вход</button>
        <button class="btn btn-ghost" id="tab-register">Регистрация</button>
      </div>
      <div id="auth-form">
        ${loginFormHtml()}
      </div>
      <div class="auth-features">
        <div class="auth-feature">🩺 Медосмотры и санкнижки</div>
        <div class="auth-feature">🌡 Температурный скрининг</div>
        <div class="auth-feature">🚪 Пропуск по зонам</div>
        <div class="auth-feature">⚠ Инциденты для медсестры</div>
      </div>
    </div>
    </div>
  </div>`;
}

async function loadCaptcha() {
  const data = await fetch(API + '/auth/captcha').then(r => r.json());
  state.reg.captcha = data;
  const img = document.getElementById('captcha-img');
  const id = document.getElementById('captcha-id');
  const hint = document.getElementById('captcha-hint');
  if (img && data.image) img.src = data.image;
  if (id) id.value = data.captcha_id || '';
  if (hint) hint.textContent = data.hint || 'Введите символы с картинки';
}

function renderCaptchaHtml() {
  const c = state.reg.captcha;
  return `<div class="captcha-box captcha-image-box">
      <img id="captcha-img" class="captcha-img" src="${c?.image || ''}" alt="Капча" title="Нажмите ↻ для обновления">
      <div class="captcha-input-row">
        <input type="hidden" id="captcha-id" value="${c?.captcha_id || ''}">
        <input id="captcha-answer" placeholder="Код с картинки" maxlength="8" autocomplete="off" style="flex:1;text-transform:uppercase">
        <button type="button" class="btn btn-ghost btn-sm" id="captcha-refresh" title="Обновить">↻</button>
      </div>
      <small id="captcha-hint" class="captcha-hint">${esc(c?.hint || 'Загрузка капчи...')}</small>
    </div>`;
}

function regStepsHtml(step) {
  const steps = ['Данные и согласия', 'Код из email', 'Готово'];
  return `<div class="reg-steps">${steps.map((s, i) =>
    `<div class="reg-step ${i + 1 === step ? 'active' : ''} ${i + 1 < step ? 'done' : ''}">${i + 1}. ${s}</div>`
  ).join('')}</div>`;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  const vis = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${vis}***@${domain}`;
}

async function viewRegisterForm() {
  if (state.reg.step === 2) {
    return `${regStepsHtml(2)}
      <div class="email-sent-banner">
        <div class="email-sent-icon">✉</div>
        <div>
          <strong>Письмо отправлено</strong>
          <p>Код подтверждения отправлен на <strong>${esc(maskEmail(state.reg.email))}</strong>. Проверьте «Входящие» и «Спам».</p>
        </div>
      </div>
      <div class="form-group"><label>Код из письма</label>
        <input id="verify-code" maxlength="6" placeholder="6 цифр" inputmode="numeric" autocomplete="one-time-code"></div>
      <button class="btn btn-primary" style="width:100%" id="auth-verify">Подтвердить email</button>
      <button class="btn btn-ghost" style="width:100%;margin-top:.5rem" id="auth-resend">Отправить код повторно</button>
      <p id="resend-timer" class="resend-timer"></p>
      <p style="margin-top:.75rem;font-size:.78rem;color:var(--muted)">Код действует 15 минут. Для ролей «Сотрудник» и «Старшая медсестра» после email потребуется одобрение администратора.</p>`;
  }
  if (state.reg.step === 3) {
    const pending = state.reg.finalStatus === 'pending_admin';
    return `${regStepsHtml(3)}
      <div class="pass-result ${pending ? 'denied' : 'allowed'}">
        <h3>${pending ? '⏳ Ожидает администратора' : '✓ Регистрация завершена'}</h3>
        <p>${esc(state.reg.finalMessage || '')}</p>
      </div>
      <button class="btn btn-primary" style="width:100%;margin-top:1rem" id="back-to-login">Перейти ко входу</button>`;
  }
  await loadCaptcha().catch(() => {});
  return `${regStepsHtml(1)}
    <div class="form-group"><label>Email</label><input id="auth-email" type="email" placeholder="name@clinic.ru"></div>
    <div class="form-group"><label>Логин</label><input id="auth-user" autocomplete="username"></div>
    <div class="form-group"><label>Пароль (мин. 8 символов)</label><input id="auth-pass" type="password"></div>
    <div class="form-group"><label>ФИО</label><input id="auth-name"></div>
    <div class="form-group"><label>Запрашиваемая роль</label>
      <select id="auth-role">
        <option value="employee">Сотрудник (требует одобрения админа)</option>
        <option value="nurse_chief">Старшая медсестра (требует одобрения админа)</option>
        <option value="guard">Пост охраны (после email — сразу доступ)</option>
      </select>
    </div>
    ${renderCaptchaHtml()}
    <div class="consent-box"><label><input type="checkbox" id="consent-pd"> Я даю <strong>согласие на обработку персональных данных</strong> (152-ФЗ) для целей пропускного и санитарного контроля</label></div>
    <div class="consent-box"><label><input type="checkbox" id="consent-privacy"> Я ознакомлен(а) с <a href="/legal/privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a></label></div>
    <div class="consent-box"><label><input type="checkbox" id="consent-terms"> Я принимаю пользовательское соглашение и правила работы с системой</label></div>
    <div class="consent-box"><label><input type="checkbox" id="consent-notify"> Получать уведомления о статусе регистрации и инцидентах на email (необязательно)</label></div>
    <button class="btn btn-primary" style="width:100%" id="auth-register-submit">Продолжить регистрацию</button>`;
}

async function viewDashboard() {
  const data = await api('/dashboard');
  const s = data.stats;
  const role = state.user.role;
  const showLive = ['admin', 'nurse_chief', 'guard'].includes(role);
  const showAnalytics = ['admin', 'nurse_chief'].includes(role);
  return `<h2 class="page-title">Центр мониторинга санэпидконтроля</h2>
    <div class="shortcut-hint" id="shortcut-hint">⌨ Ctrl+K — быстрый переход · 🌙 — тема</div>
    ${role === 'admin' && s.pending_registrations ? `
      <div class="alert-banner pulse">
        <div><strong>${s.pending_registrations} заявок на регистрацию</strong><br><span style="font-size:.82rem;color:var(--muted)">Требуют проверки email или одобрения администратора</span></div>
        <button class="btn btn-primary btn-sm" onclick="navigate('registrations')">Открыть заявки</button>
      </div>` : ''}
    ${canSeeIncidents() && s.open_incidents ? `
      <div class="alert-banner">
        <div><strong>${s.open_incidents} открытых инцидентов</strong><br><span style="font-size:.82rem;color:var(--muted)">Требуют обработки старшей медсестрой</span></div>
        <button class="btn btn-primary btn-sm" onclick="navigate('incidents')">Открыть инциденты</button>
      </div>` : ''}
    <div class="grid grid-4">
      <div class="stat"><div class="num" data-animate="${s.access_today}">0</div><div class="label">Проходов сегодня</div></div>
      <div class="stat danger"><div class="num" data-animate="${s.blocked_today}">0</div><div class="label">Блокировок</div></div>
      ${showAnalytics ? `<div class="stat warning"><div class="num" data-animate="${s.expired_books}">0</div><div class="label">Просроченных санкнижек</div></div>` : ''}
      <div class="stat"><div class="num" data-animate="${s.employees}">0</div><div class="label">Сотрудников в системе</div></div>
    </div>
    ${showLive ? `<div class="grid grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>Карта зон клиники</h3><span class="live-pill">● LIVE</span></div>
        <div id="zone-map" class="zone-map"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Лента проходов</h3><span class="live-pill">обновление 5 сек</span></div>
        <div id="live-feed" class="live-feed"></div>
      </div>
    </div>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card">
        <div class="card-head"><h3>Аналитика проходов</h3></div>
        <canvas id="hourly-chart" class="hourly-chart"></canvas>
        <div class="chart-legend"><span class="lg ok">■ Разрешено</span><span class="lg bad">■ Блокировка</span></div>
      </div>
      ${showAnalytics ? `<div class="card">
        <div class="card-head"><h3>Индекс допуска персонала</h3></div>
        <p class="card-hint">Считается по санкнижке (30), медосмотру (30), температуре (25), проходам (10) и инцидентам (5). Наведите на кольцо — детали.</p>
        <div id="compliance-rings" class="compliance-rings"></div>
      </div>` : `<div class="card"><h3>Сводка</h3><p style="font-size:.88rem;color:var(--muted);line-height:1.6">Активных зон: <strong>${s.zones}</strong></p></div>`}
    </div>` : ''}
    <div class="card" style="margin-top:1rem">
      <h3>Последние проходы через пост</h3>
      ${renderAccessTable(data.recent_access)}
    </div>`;
}

function renderAccessTable(items) {
  if (!items.length) return '<p class="empty">Нет записей</p>';
  return `<table><thead><tr><th>Время</th><th>Сотрудник</th><th>Зона</th><th>Направление</th><th>Результат</th></tr></thead><tbody>
    ${items.map(r => `<tr>
      <td>${esc(r.event_time)}</td><td>${esc(r.employee_name)}</td><td>${esc(r.zone_name)}</td>
      <td>${r.direction === 'in' ? 'Вход' : 'Выход'}</td><td>${badgeAllowed(r.allowed)}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function viewTerminal() {
  const [emps, zones] = await Promise.all([api('/employees?per_page=100'), api('/zones')]);
  return `<h2 class="page-title">Терминал прохода <button class="btn btn-ghost btn-sm" id="terminal-kiosk" title="Полноэкранный режим">⛶ Киоск</button></h2>
    <div class="grid grid-2">
      <div class="card terminal-card tilt-card">
        <div id="terminal-led" class="terminal-led idle"><div class="led-icon">⏳</div><div class="led-text">Выберите сотрудника и зону</div></div>
        <div class="form-group"><label>Скан табельного № / QR</label>
          <input id="pass-scan" placeholder="Поднесите бейдж или введите номер…" autocomplete="off"></div>
        <div class="form-row">
        <div class="form-group"><label>Сотрудник</label>
          <select id="pass-employee">${emps.items.map(e => `<option value="${e.id}">${esc(e.badge_number)} — ${esc(e.full_name)}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Зона</label>
          <select id="pass-zone">${zones.items.map(z => `<option value="${z.id}">${esc(z.name)} (${ZONE_TYPES[z.zone_type]})</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Направление</label>
          <select id="pass-direction"><option value="in">Вход</option><option value="out">Выход</option></select>
        </div>
        <div class="form-group"><label>Температура °C</label><input id="pass-temp" type="number" step="0.1" value="36.6"></div>
      </div>
      <button class="btn btn-primary" id="btn-pass">Зарегистрировать проход</button>
      <button class="btn btn-ghost" id="btn-precheck">🔍 Предварительная проверка</button>
      <div id="precheck-result"></div>
      <div id="pass-result"></div>
      </div>
      <div class="card">
        <h3>Чек-лист санэпидконтроля</h3>
        <ul class="checklist-info">
          <li>✓ Допуск в зону по матрице прав</li>
          <li>✓ Действующая санитарная книжка</li>
          <li>✓ Актуальный медосмотр</li>
          <li>✓ Температурный скрининг ≤ 37.0°C</li>
        </ul>
        <p style="margin-top:1rem;font-size:.82rem;color:var(--muted)">При нарушении система блокирует проход и создаёт инцидент для старшей медсестры.</p>
      </div>
    </div>`;
}

async function viewEmployees() {
  const search = state.params.search || '';
  const data = await api(`/employees?search=${encodeURIComponent(search)}&per_page=50`);
  const canEdit = roleCan('editEmployee');
  const canDel = roleCan('deleteEmployee');
  return `<h2 class="page-title">Сотрудники</h2>
    <div class="toolbar">
      <input id="emp-search" placeholder="Поиск..." value="${esc(search)}">
      <button class="btn btn-ghost btn-sm" id="emp-search-btn">Найти</button>
      ${canEdit ? '<button class="btn btn-primary btn-sm" id="emp-add">+ Добавить</button>' : ''}
    </div>
    <div class="card"><table><thead><tr><th>Табельный №</th><th>ФИО</th><th>Должность</th><th>Отделение</th><th></th></tr></thead><tbody>
      ${data.items.map(e => `<tr>
        <td>${esc(e.badge_number)}</td><td>${esc(e.full_name)}</td><td>${esc(e.position)}</td><td>${esc(e.department||'—')}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="navigate('employee-detail',{id:${e.id}})">Карточка</button>
          ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="editEmployee(${e.id})">Изм.</button>` : ''}
          ${canDel ? `<button class="btn btn-danger btn-sm" onclick="deleteEmployee(${e.id})">Удалить</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>
    <div id="modal-container"></div>`;
}

async function viewEmployeeDetail() {
  const data = await api(`/employees/${state.params.id}`);
  const e = data.employee;
  return `<h2 class="page-title">${esc(e.full_name)}</h2>
    <button class="btn btn-ghost btn-sm" onclick="navigate('employees')">← Назад</button>
    <div class="grid grid-2" style="margin-top:1rem">
      <div class="card"><h3>Данные</h3>
        <p><strong>Табельный №:</strong> ${esc(e.badge_number)}</p>
        <p><strong>Должность:</strong> ${esc(e.position)}</p>
        <p><strong>Отделение:</strong> ${esc(e.department||'—')}</p>
      </div>
      <div class="card"><h3>Допуск в зоны</h3>
        ${data.zones.length ? data.zones.map(z => `<span class="badge badge-info">${esc(z.name)}</span> `).join('') : '<p class="empty">Нет допусков</p>'}
      </div>
      <div class="card"><h3>Санитарные книжки</h3>${renderDocTable(data.sanitary_books, 'book')}</div>
      <div class="card"><h3>Медосмотры</h3>${renderDocTable(data.medical_exams, 'exam')}</div>
    </div>
    <div class="card"><h3>Журнал проходов</h3>${renderAccessTable(data.access_logs)}</div>`;
}

function renderDocTable(items, type) {
  if (!items.length) return '<p class="empty">Нет записей</p>';
  if (type === 'book') return `<table><thead><tr><th>№</th><th>Выдана</th><th>Действует до</th><th>Статус</th></tr></thead><tbody>
    ${items.map(r => `<tr><td>${esc(r.book_number)}</td><td>${esc(r.issue_date)}</td><td>${esc(r.expiry_date)}</td><td>${badgeStatus(r.status)}</td></tr>`).join('')}
  </tbody></table>`;
  return `<table><thead><tr><th>Дата</th><th>Действует до</th><th>Результат</th><th>Статус</th></tr></thead><tbody>
    ${items.map(r => `<tr><td>${esc(r.exam_date)}</td><td>${esc(r.expiry_date)}</td><td>${esc(r.result)}</td><td>${badgeStatus(r.status)}</td></tr>`).join('')}
  </tbody></table>`;
}

async function viewZones() {
  const data = await api('/zones');
  const canEdit = roleCan('editZone');
  return `<h2 class="page-title">Зоны доступа</h2>
    ${canEdit ? '<button class="btn btn-primary btn-sm" id="zone-add">+ Добавить зону</button>' : ''}
    <div class="card" style="margin-top:1rem"><table><thead><tr><th>Название</th><th>Тип</th><th>Уровень</th><th>Описание</th><th></th></tr></thead><tbody>
      ${data.items.map(z => `<tr>
        <td>${esc(z.name)}</td><td>${ZONE_TYPES[z.zone_type]||z.zone_type}</td><td>${z.access_level}</td><td>${esc(z.description||'—')}</td>
        <td class="actions">
          ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="editZone(${z.id})">Изм.</button>` : ''}
          ${canEdit ? `<button class="btn btn-danger btn-sm" onclick="deleteZone(${z.id})">Удалить</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div><div id="modal-container"></div>`;
}

async function viewPermissions() {
  const data = await api('/permissions');
  const [emps, zones] = await Promise.all([api('/employees?per_page=100'), api('/zones')]);
  const canGrant = roleCan('grantPerm');
  return `<h2 class="page-title">Допуски в зоны</h2>
    ${canGrant ? `<div class="card"><h3>Выдать допуск</h3>
      <div class="form-row">
        <div class="form-group"><label>Сотрудник</label><select id="perm-emp">${emps.items.map(e=>`<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Зона</label><select id="perm-zone">${zones.items.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></div>
      </div>
      <button class="btn btn-primary btn-sm" id="perm-grant">Выдать</button>
    </div>` : ''}
    <div class="card"><table><thead><tr><th>Сотрудник</th><th>Зона</th><th>Выдан</th><th></th></tr></thead><tbody>
      ${data.items.map(p => `<tr><td>${esc(p.employee_name)} (${esc(p.badge_number)})</td><td>${esc(p.zone_name)}</td><td>${esc(p.granted_at)}</td>
        <td>${roleCan('revokePerm') ? `<button class="btn btn-danger btn-sm" onclick="revokePerm(${p.id})">Отозвать</button>` : '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
}

async function viewDocuments() {
  const [books, exams] = await Promise.all([api('/sanitary-books'), api('/medical-exams')]);
  const canEdit = ['admin','nurse_chief'].includes(state.user.role);
  const canDel = roleCan('deleteBook');
  const emps = canEdit ? await api('/employees?per_page=100') : { items: [] };
  const delCol = canDel ? '<th></th>' : '';
  return `<h2 class="page-title">Санитарные документы</h2>
    ${canEdit ? `<div class="card"><h3>Добавить санкнижку</h3>
      <div class="form-row">
        <div class="form-group"><label>Сотрудник</label><select id="book-emp">${emps.items.map(e=>`<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>№ книжки</label><input id="book-num"></div>
        <div class="form-group"><label>Выдана</label><input id="book-issue" type="date"></div>
        <div class="form-group"><label>Действует до</label><input id="book-expiry" type="date"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="book-add">Добавить</button>
    </div>
    <div class="card"><h3>Добавить медосмотр</h3>
      <div class="form-row">
        <div class="form-group"><label>Сотрудник</label><select id="exam-emp">${emps.items.map(e=>`<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Дата</label><input id="exam-date" type="date"></div>
        <div class="form-group"><label>Действует до</label><input id="exam-expiry" type="date"></div>
      </div>
      <button class="btn btn-primary btn-sm" id="exam-add">Добавить</button>
    </div>` : ''}
    <div class="card"><h3>Санитарные книжки</h3><table><thead><tr><th>Сотрудник</th><th>№</th><th>До</th><th>Статус</th>${delCol}</tr></thead><tbody>
      ${books.items.map(b=>`<tr><td>${esc(b.employee_name)}</td><td>${esc(b.book_number)}</td><td>${esc(b.expiry_date)}</td><td>${badgeStatus(b.status)}</td>
        ${canDel ? `<td><button class="btn btn-danger btn-sm" onclick="deleteBook(${b.id})">Удалить</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    <div class="card"><h3>Медосмотры</h3><table><thead><tr><th>Сотрудник</th><th>Дата</th><th>До</th><th>Статус</th>${delCol}</tr></thead><tbody>
      ${exams.items.map(e=>`<tr><td>${esc(e.employee_name)}</td><td>${esc(e.exam_date)}</td><td>${esc(e.expiry_date)}</td><td>${badgeStatus(e.status)}</td>
        ${canDel ? `<td><button class="btn btn-danger btn-sm" onclick="deleteExam(${e.id})">Удалить</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

async function viewAccessLogs() {
  const data = await api('/access-logs?per_page=50');
  return `<h2 class="page-title">Журнал проходов</h2>
    <div class="toolbar">
      ${roleCan('exportCsv') ? '<button class="btn btn-ghost btn-sm" onclick="SanEpidUI.exportAccessCsv()">⬇ Экспорт CSV</button>' : ''}
    </div>
    <div class="card">${renderAccessTableFull(data.items)}</div>`;
}

function renderAccessTableFull(items) {
  if (!items.length) return '<p class="empty">Нет записей</p>';
  return `<table><thead><tr><th>Время</th><th>Сотрудник</th><th>Зона</th><th>Направление</th><th>Темп.</th><th>Результат</th><th>Причина</th></tr></thead><tbody>
    ${items.map(r => `<tr>
      <td>${esc(r.event_time)}</td><td>${esc(r.employee_name)}</td><td>${esc(r.zone_name)}</td>
      <td>${r.direction==='in'?'Вход':'Выход'}</td><td>${r.temperature??'—'}</td>
      <td>${badgeAllowed(r.allowed)}</td><td>${esc(r.block_reason||'—')}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

async function viewIncidents() {
  const data = await api('/incidents?per_page=50');
  return `<h2 class="page-title">Инциденты</h2>
    <div class="card"><table><thead><tr><th>Дата</th><th>Сотрудник</th><th>Зона</th><th>Тип</th><th>Описание</th><th>Статус</th><th></th></tr></thead><tbody>
      ${data.items.map(i => `<tr>
        <td>${esc(i.created_at)}</td><td>${esc(i.employee_name)}</td><td>${esc(i.zone_name||'—')}</td>
        <td>${esc(i.incident_type)}</td><td>${esc(i.description)}</td><td>${badgeStatus(i.status)}</td>
        <td>${i.status !== 'resolved' ? `<button class="btn btn-primary btn-sm" onclick="resolveIncident(${i.id})">Обработать</button>` : '—'}</td>
      </tr>`).join('')}
    </tbody></table></div><div id="modal-container"></div>`;
}

async function viewCompliance() {
  const data = await api('/analytics/compliance');
  const total = data.items.length;
  const ok = data.items.filter(r => r.compliant).length;
  const bad = total - ok;
  const pct = data.avg_score ?? (total ? Math.round(data.items.reduce((s, r) => s + (r.score || 0), 0) / total) : 0);
  return `<h2 class="page-title">Аналитика соответствия</h2>
    <div class="grid grid-3" style="margin-bottom:1rem">
      <div class="stat"><div class="num" data-animate="${total}">0</div><div class="label">Сотрудников проверено</div></div>
      <div class="stat"><div class="num" data-animate="${ok}">0</div><div class="label">Полностью допущены</div></div>
      <div class="stat ${pct < 90 ? 'danger' : ''}"><div class="num" data-animate="${pct}" data-suffix="%">0</div><div class="label">Средний индекс допуска</div></div>
    </div>
    <div class="card"><table><thead><tr><th>Сотрудник</th><th>Индекс</th><th>Санкнижка до</th><th>Медосмотр до</th><th>Темп. сегодня</th><th>Факторы</th><th>Статус</th></tr></thead><tbody>
      ${data.items.map(r => `<tr>
        <td>${esc(r.full_name)} (${esc(r.badge_number)})</td>
        <td><strong>${r.score ?? '—'}%</strong></td>
        <td>${esc(r.book_expiry||'—')}</td><td>${esc(r.exam_expiry||'—')}</td>
        <td>${r.temp_today ?? '—'}</td>
        <td class="factor-cells">${(r.factors||[]).map(f => `<span class="rf ${f.status}" title="${esc(f.label)}">${f.points}/${f.max}</span>`).join(' ')}</td>
        <td>${r.compliant ? badgeAllowed(1) : '<span class="badge badge-danger" title="'+esc(r.issues.join('; '))+'">Нарушения</span>'}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

async function viewUsers() {
  const data = await api('/users');
  return `<h2 class="page-title">Пользователи</h2>
    <div class="card"><table><thead><tr><th>Логин</th><th>ФИО</th><th>Роль</th><th>Email</th><th></th></tr></thead><tbody>
      ${data.items.map(u => `<tr>
        <td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td>${ROLE_LABELS[u.role]||u.role}</td><td>${esc(u.email||'—')}</td>
        <td class="actions">
          <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">Изм.</button>
          ${u.id !== state.user.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">Удалить</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div><div id="modal-container"></div>`;
}

async function viewAudit() {
  const data = await api('/audit?per_page=50');
  return `<h2 class="page-title">Журнал аудита</h2>
    <div class="card"><table><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Таблица</th><th>Детали</th></tr></thead><tbody>
      ${data.items.map(a => `<tr>
        <td>${esc(a.created_at)}</td><td>${esc(a.username||'—')}</td><td>${esc(a.action)}</td>
        <td>${esc(a.table_name||'—')}</td><td>${esc(a.details||'—')}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

async function viewMyProfile() {
  const emps = await api('/employees');
  if (!emps.items.length) return '<p class="empty">Профиль сотрудника не привязан</p>';
  state.params.id = emps.items[0].id;
  return viewEmployeeDetail();
}

// --- Modals & actions ---
window.showModal = function(html) {
  document.getElementById('modal-container').innerHTML = `<div class="modal-overlay" id="modal-overlay"><div class="modal">${html}</div></div>`;
  document.getElementById('modal-overlay').onclick = e => { if (e.target.id === 'modal-overlay') closeModal(); };
};
window.closeModal = function() {
  const c = document.getElementById('modal-container');
  if (c) c.innerHTML = '';
};

window.editEmployee = async function(id) {
  const data = await api(`/employees/${id}`);
  const e = data.employee;
  showModal(`<h3>Редактировать сотрудника</h3>
    <div class="form-group"><label>Табельный №</label><input id="m-badge" value="${esc(e.badge_number)}"></div>
    <div class="form-group"><label>ФИО</label><input id="m-name" value="${esc(e.full_name)}"></div>
    <div class="form-group"><label>Должность</label><input id="m-pos" value="${esc(e.position)}"></div>
    <div class="form-group"><label>Отделение</label><input id="m-dept" value="${esc(e.department||'')}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
      <button class="btn btn-primary" id="m-save">Сохранить</button>
    </div>`);
  document.getElementById('m-save').onclick = async () => {
    await api(`/employees/${id}`, { method:'PUT', body: JSON.stringify({
      badge_number: document.getElementById('m-badge').value,
      full_name: document.getElementById('m-name').value,
      position: document.getElementById('m-pos').value,
      department: document.getElementById('m-dept').value,
    })});
    closeModal(); toast('Сохранено','success'); render();
  };
};

window.editZone = async function(id) {
  const zones = await api('/zones');
  const z = zones.items.find(x => x.id === id);
  showModal(`<h3>Редактировать зону</h3>
    <div class="form-group"><label>Название</label><input id="m-name" value="${esc(z.name)}"></div>
    <div class="form-group"><label>Тип</label><select id="m-type">${Object.entries(ZONE_TYPES).map(([k,v])=>`<option value="${k}" ${z.zone_type===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="form-group"><label>Уровень</label><input id="m-level" type="number" value="${z.access_level}"></div>
    <div class="form-group"><label>Описание</label><textarea id="m-desc">${esc(z.description||'')}</textarea></div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Отмена</button><button class="btn btn-primary" id="m-save">Сохранить</button></div>`);
  document.getElementById('m-save').onclick = async () => {
    await api(`/zones/${id}`, { method:'PUT', body: JSON.stringify({
      name: document.getElementById('m-name').value, zone_type: document.getElementById('m-type').value,
      access_level: +document.getElementById('m-level').value, description: document.getElementById('m-desc').value,
    })});
    closeModal(); toast('Сохранено','success'); render();
  };
};

window.editUser = async function(id) {
  const data = await api('/users');
  const u = data.items.find(x => x.id === id);
  showModal(`<h3>Редактировать пользователя</h3>
    <div class="form-group"><label>ФИО</label><input id="m-name" value="${esc(u.full_name)}"></div>
    <div class="form-group"><label>Роль</label><select id="m-role">${Object.entries(ROLE_LABELS).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="form-group"><label>Новый пароль (необяз.)</label><input id="m-pass" type="password"></div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Отмена</button><button class="btn btn-primary" id="m-save">Сохранить</button></div>`);
  document.getElementById('m-save').onclick = async () => {
    const body = { full_name: document.getElementById('m-name').value, role: document.getElementById('m-role').value };
    const p = document.getElementById('m-pass').value; if (p) body.password = p;
    await api(`/users/${id}`, { method:'PUT', body: JSON.stringify(body) });
    closeModal(); toast('Сохранено','success'); render();
  };
};

window.resolveIncident = function(id) {
  showModal(`<h3>Обработка инцидента</h3>
    <div class="form-group"><label>Примечание</label><textarea id="m-note"></textarea></div>
    <div class="form-group"><label>Статус</label><select id="m-status"><option value="in_progress">В работе</option><option value="resolved">Закрыт</option></select></div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Отмена</button><button class="btn btn-primary" id="m-save">Сохранить</button></div>`);
  document.getElementById('m-save').onclick = async () => {
    await api(`/incidents/${id}`, { method:'PUT', body: JSON.stringify({
      status: document.getElementById('m-status').value, resolution_note: document.getElementById('m-note').value,
    })});
    closeModal(); toast('Инцидент обновлён','success');
    SanEpidUI?.refreshLive?.();
    render();
  };
};

window.deleteEmployee = async function(id) {
  if (!confirm('Деактивировать сотрудника?')) return;
  try { await api(`/employees/${id}`, { method: 'DELETE' }); toast('Сотрудник деактивирован', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
};
window.deleteZone = async function(id) {
  if (!confirm('Деактивировать зону?')) return;
  try { await api(`/zones/${id}`, { method: 'DELETE' }); toast('Зона деактивирована', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
};
window.deleteUser = async function(id) {
  if (!confirm('Удалить пользователя?')) return;
  try { await api(`/users/${id}`, { method: 'DELETE' }); toast('Пользователь удалён', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
};
window.deleteBook = async function(id) {
  if (!confirm('Удалить запись санкнижки?')) return;
  try { await api(`/sanitary-books/${id}`, { method: 'DELETE' }); toast('Удалено', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
};
window.deleteExam = async function(id) {
  if (!confirm('Удалить запись медосмотра?')) return;
  try { await api(`/medical-exams/${id}`, { method: 'DELETE' }); toast('Удалено', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
};

window.revokePerm = async function(id) {
  if (!confirm('Отозвать допуск?')) return;
  await api(`/permissions/${id}`, { method:'DELETE' });
  toast('Допуск отозван','success'); render();
};

async function viewSettings() {
  const data = await api('/admin/settings');
  const smtp = data.smtp || {};
  return `<h2 class="page-title">Настройки почты (SMTP)</h2>
    <div class="grid grid-2">
      <div class="card">
        <h3>Статус отправки писем</h3>
        <div class="smtp-status ${smtp.configured ? 'ok' : 'bad'}">
          <span class="smtp-dot"></span>
          ${smtp.configured ? 'SMTP настроен — коды регистрации отправляются на реальный email' : 'SMTP не настроен — регистрация с email не работает'}
        </div>
        ${smtp.configured ? `<ul class="smtp-meta">
          <li><strong>Сервер:</strong> ${esc(smtp.host)}</li>
          <li><strong>Аккаунт:</strong> ${esc(smtp.user_masked || '—')}</li>
          <li><strong>Отправитель:</strong> ${esc(smtp.from || '—')}</li>
        </ul>` : `<div class="alert-banner" style="margin-top:1rem">
          <div><strong>Нужна настройка</strong><br><span style="font-size:.82rem;color:var(--muted)">Запустите <code>НАСТРОЙКА_ПОЧТЫ.bat</code>, укажите SMTP_USER и SMTP_PASSWORD (пароль приложения), затем перезапустите START.bat</span></div>
        </div>`}
        <p style="margin-top:1rem;font-size:.82rem;color:var(--muted)">Код подтверждения <strong>никогда не показывается</strong> на экране — только в письме.</p>
      </div>
      <div class="card">
        <h3>Тестовая отправка</h3>
        <div class="form-group"><label>Email для теста</label>
          <input id="smtp-test-email" type="email" value="${esc(state.user.email || '')}" placeholder="admin@clinic.ru"></div>
        <button class="btn btn-primary" id="smtp-test-btn" ${smtp.configured ? '' : 'disabled'}>Отправить тестовое письмо</button>
        <div id="smtp-test-result"></div>
      </div>
    </div>`;
}

async function viewRegistrations() {
  const data = await api('/registrations/pending');
  const statusLabel = { pending_email: 'Ждёт email', pending_admin: 'Ждёт админа' };
  const roleLabel = { employee: 'Сотрудник', nurse_chief: 'Старшая медсестра', guard: 'Охрана' };
  return `<h2 class="page-title">Заявки на регистрацию</h2>
    <div class="card">
      <p style="margin-bottom:1rem;color:var(--muted);font-size:.88rem">Роли «Сотрудник» и «Старшая медсестра» активируются только после одобрения администратора. «Пост охраны» — после подтверждения email.</p>
      ${data.items.length ? `<table><thead><tr><th>Дата</th><th>ФИО</th><th>Логин</th><th>Email</th><th>Роль</th><th>Статус</th><th></th></tr></thead><tbody>
        ${data.items.map(r => `<tr>
          <td>${esc(r.created_at)}</td><td>${esc(r.full_name)}</td><td>${esc(r.username)}</td><td>${esc(r.email)}</td>
          <td>${roleLabel[r.role] || r.role}</td><td>${badgeStatus(r.status === 'pending_admin' ? 'open' : 'in_progress')} ${statusLabel[r.status] || r.status}</td>
          <td class="reg-table-actions">
            ${r.status === 'pending_admin' ? `<button class="btn btn-primary btn-sm" onclick="approveReg(${r.id})">Одобрить</button><button class="btn btn-danger btn-sm" onclick="rejectReg(${r.id})">Отклонить</button>` : `<button class="btn btn-danger btn-sm" onclick="rejectReg(${r.id})">Отменить</button>`}
          </td>
        </tr>`).join('')}
      </tbody></table>` : '<p class="empty">Нет активных заявок</p>'}
    </div>`;
}

window.approveReg = async function(id) {
  if (!confirm('Одобрить регистрацию и создать учётную запись?')) return;
  try {
    await api(`/registrations/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
    toast('Заявка одобрена', 'success');
    render();
  } catch (e) { toast(e.message, 'error'); }
};

window.rejectReg = async function(id) {
  const note = prompt('Причина отклонения (необязательно):') || '';
  try {
    await api(`/registrations/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
    toast('Заявка отклонена', 'success');
    render();
  } catch (e) { toast(e.message, 'error'); }
};

const VIEWS = {
  login: viewLogin, dashboard: viewDashboard, terminal: viewTerminal,
  employees: viewEmployees, 'employee-detail': viewEmployeeDetail,
  zones: viewZones, permissions: viewPermissions, documents: viewDocuments,
  'access-logs': viewAccessLogs, incidents: viewIncidents, compliance: viewCompliance,
  users: viewUsers, audit: viewAudit, 'my-profile': viewMyProfile, registrations: viewRegistrations,
  settings: viewSettings,
};

function bindEvents() {
  if (state.route === 'login') {
    document.getElementById('tab-login')?.addEventListener('click', () => {
      state.reg = { step: 1, requestId: null, captcha: null, role: 'employee' };
      document.getElementById('auth-form').innerHTML = loginFormHtml();
      bindAuthSubmit();
    });
    document.getElementById('tab-register')?.addEventListener('click', async () => {
      state.reg = { step: 1, requestId: null, captcha: null, role: 'employee' };
      document.getElementById('auth-form').innerHTML = await viewRegisterForm();
      bindRegisterEvents();
    });
    bindAuthSubmit();
  }

  document.getElementById('btn-precheck')?.addEventListener('click', async () => {
    try {
      const res = await api('/access/precheck', { method:'POST', body: JSON.stringify({
        employee_id: +document.getElementById('pass-employee').value,
        zone_id: +document.getElementById('pass-zone').value,
        temperature: +document.getElementById('pass-temp').value,
      })});
      const el = document.getElementById('precheck-result');
      el.innerHTML = `<div class="card" style="margin-top:1rem"><h3>Проверка: ${esc(res.employee_name)} → ${esc(res.zone_name)}</h3>
        <ul class="check-list">${res.checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}"><span>${esc(c.name)}</span><span>${c.ok ? '✓' : '✗'} ${esc(c.detail || '')}</span></li>`).join('')}</ul>
        <p style="font-weight:700;color:${res.allowed ? 'var(--success)' : 'var(--danger)'}">${res.allowed ? 'Допуск возможен' : 'Проход будет заблокирован'}</p></div>`;
      window._terminalPreview?.(res.allowed, res.allowed ? 'ДОПУСК РАЗРЕШЁН' : 'ДОПУСК ЗАПРЕЩЁН');
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('btn-pass')?.addEventListener('click', async (e) => {
    try {
      const res = await api('/access/pass', { method:'POST', body: JSON.stringify({
        employee_id: +document.getElementById('pass-employee').value,
        zone_id: +document.getElementById('pass-zone').value,
        direction: document.getElementById('pass-direction').value,
        temperature: +document.getElementById('pass-temp').value,
      })});
      const el = document.getElementById('pass-result');
      el.className = `pass-result ${res.allowed ? 'allowed' : 'denied'}`;
      el.innerHTML = res.allowed
        ? `<h3>✓ Проход разрешён</h3><p>${esc(res.log.employee_name)} → ${esc(res.log.zone_name)}</p>`
        : `<h3>✗ Проход заблокирован</h3><p>${esc(res.violations.join('; '))}</p><p>Инцидент #${res.incident_id} создан для старшей медсестры</p>`;
      window._terminalPreview?.(res.allowed, res.allowed ? 'ПРОХОД ЗАРЕГИСТРИРОВАН' : 'ПРОХОД ЗАБЛОКИРОВАН');
      SanEpidUI?.playBeep?.(res.allowed);
      SanEpidUI?.confetti?.(res.allowed);
      if (res.allowed && e?.clientX) SanEpidPolish?.sparkle?.(e.clientX, e.clientY);
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('emp-search-btn')?.addEventListener('click', () => {
    state.params.search = document.getElementById('emp-search').value;
    render();
  });
  document.getElementById('emp-add')?.addEventListener('click', () => {
    showModal(`<h3>Новый сотрудник</h3>
      <div class="form-group"><label>Табельный №</label><input id="m-badge"></div>
      <div class="form-group"><label>ФИО</label><input id="m-name"></div>
      <div class="form-group"><label>Должность</label><input id="m-pos"></div>
      <div class="form-group"><label>Отделение</label><input id="m-dept"></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Отмена</button><button class="btn btn-primary" id="m-save">Создать</button></div>`);
    document.getElementById('m-save').onclick = async () => {
      await api('/employees', { method:'POST', body: JSON.stringify({
        badge_number: document.getElementById('m-badge').value, full_name: document.getElementById('m-name').value,
        position: document.getElementById('m-pos').value, department: document.getElementById('m-dept').value,
      })});
      closeModal(); toast('Создан','success'); render();
    };
  });

  document.getElementById('zone-add')?.addEventListener('click', () => {
    showModal(`<h3>Новая зона</h3>
      <div class="form-group"><label>Название</label><input id="m-name"></div>
      <div class="form-group"><label>Тип</label><select id="m-type">${Object.entries(ZONE_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="form-group"><label>Уровень</label><input id="m-level" type="number" value="1"></div>
      <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Отмена</button><button class="btn btn-primary" id="m-save">Создать</button></div>`);
    document.getElementById('m-save').onclick = async () => {
      await api('/zones', { method:'POST', body: JSON.stringify({
        name: document.getElementById('m-name').value, zone_type: document.getElementById('m-type').value,
        access_level: +document.getElementById('m-level').value,
      })});
      closeModal(); toast('Создана','success'); render();
    };
  });

  document.getElementById('perm-grant')?.addEventListener('click', async () => {
    try {
      await api('/permissions', { method:'POST', body: JSON.stringify({
        employee_id: +document.getElementById('perm-emp').value, zone_id: +document.getElementById('perm-zone').value,
      })});
      toast('Допуск выдан','success'); render();
    } catch(e) { toast(e.message,'error'); }
  });

  document.getElementById('book-add')?.addEventListener('click', async () => {
    try {
      await api('/sanitary-books', { method:'POST', body: JSON.stringify({
        employee_id: +document.getElementById('book-emp').value, book_number: document.getElementById('book-num').value,
        issue_date: document.getElementById('book-issue').value, expiry_date: document.getElementById('book-expiry').value,
      })});
      toast('Добавлено','success'); render();
    } catch(e) { toast(e.message,'error'); }
  });

  document.getElementById('exam-add')?.addEventListener('click', async () => {
    try {
      await api('/medical-exams', { method:'POST', body: JSON.stringify({
        employee_id: +document.getElementById('exam-emp').value, exam_date: document.getElementById('exam-date').value,
        expiry_date: document.getElementById('exam-expiry').value,
      })});
      toast('Добавлено','success'); render();
    } catch(e) { toast(e.message,'error'); }
  });

  document.getElementById('smtp-test-btn')?.addEventListener('click', async () => {
    const el = document.getElementById('smtp-test-result');
    try {
      el.innerHTML = '<p class="empty">Отправка…</p>';
      const res = await api('/admin/smtp-test', { method: 'POST', body: JSON.stringify({
        email: document.getElementById('smtp-test-email').value.trim(),
      })});
      el.innerHTML = `<div class="pass-result allowed" style="margin-top:1rem"><p>${esc(res.message)}</p></div>`;
      toast('Тестовое письмо отправлено', 'success');
    } catch (e) {
      el.innerHTML = `<div class="pass-result denied" style="margin-top:1rem"><p>${esc(e.message)}</p></div>`;
      toast(e.message, 'error');
    }
  });
}

function bindRegisterEvents() {
  document.getElementById('captcha-refresh')?.addEventListener('click', async () => {
    await loadCaptcha();
    document.getElementById('captcha-answer').value = '';
  });
  document.getElementById('captcha-img')?.addEventListener('click', () => {
    document.getElementById('captcha-refresh')?.click();
  });

  document.getElementById('auth-register-submit')?.addEventListener('click', async () => {
    try {
      if (!document.getElementById('consent-pd')?.checked || !document.getElementById('consent-privacy')?.checked || !document.getElementById('consent-terms')?.checked) {
        throw new Error('Примите все обязательные согласия по 152-ФЗ');
      }
      const res = await apiCall('/auth/register/start', { method:'POST', body: JSON.stringify({
        username: document.getElementById('auth-user').value.trim(),
        password: document.getElementById('auth-pass').value,
        full_name: document.getElementById('auth-name').value.trim(),
        email: document.getElementById('auth-email').value.trim(),
        role: document.getElementById('auth-role').value,
        captcha_id: document.getElementById('captcha-id').value,
        captcha_answer: document.getElementById('captcha-answer').value,
        consent_pd: true, consent_privacy: true, consent_terms: true,
        consent_notifications: !!document.getElementById('consent-notify')?.checked,
      })});
      state.reg.requestId = res.request_id;
      state.reg.email = res.email || document.getElementById('auth-email').value.trim();
      state.reg.step = 2;
      document.getElementById('auth-form').innerHTML = await viewRegisterForm();
      bindRegisterEvents();
      SanEpidUI?.startResendTimer?.();
      toast('Код отправлен на ' + maskEmail(state.reg.email), 'success');
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('auth-verify')?.addEventListener('click', async () => {
    try {
      const res = await apiCall('/auth/register/verify-email', { method:'POST', body: JSON.stringify({
        request_id: state.reg.requestId,
        code: document.getElementById('verify-code').value.trim(),
      })});
      state.reg.step = 3;
      state.reg.finalStatus = res.status;
      state.reg.finalMessage = res.message;
      document.getElementById('auth-form').innerHTML = await viewRegisterForm();
      bindRegisterEvents();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('auth-resend')?.addEventListener('click', async () => {
    try {
      await apiCall('/auth/register/resend-code', { method:'POST', body: JSON.stringify({ request_id: state.reg.requestId }) });
      toast('Код отправлен повторно на ' + maskEmail(state.reg.email), 'success');
      document.getElementById('auth-form').innerHTML = await viewRegisterForm();
      bindRegisterEvents();
      SanEpidUI?.startResendTimer?.();
    } catch (e) { toast(e.message, 'error'); }
  });

  document.getElementById('back-to-login')?.addEventListener('click', () => {
    state.reg = { step: 1, requestId: null, captcha: null, role: 'employee' };
    document.getElementById('tab-login')?.click();
  });
}

function bindAuthSubmit() {
  document.getElementById('auth-login-submit')?.addEventListener('click', async () => {
    try {
      const username = document.getElementById('auth-user').value.trim();
      const password = document.getElementById('auth-pass').value;
      const res = await apiCall('/auth/login', { method:'POST', body: JSON.stringify({ username, password }) });
      setAuth(res.token, res.user);
      SanEpidPolish?.welcomeSplash?.(res.user.full_name);
      navigate('dashboard');
    } catch(e) { toast(e.message, 'error'); }
  });
}

async function render() {
  parseHash();
  state.user = getUser();
  const view = document.getElementById('view');
  if (!view) return;

  if (!state.user && state.route !== 'login') {
    state.route = 'login';
    if (location.hash !== '#/login') location.hash = '#/login';
  }
  if (state.user && state.route === 'login') {
    navigate('dashboard');
    return;
  }

  if (state.user && !canAccessRoute(state.route)) {
    toast('Недостаточно прав для этого раздела', 'error');
    navigate('dashboard');
    return;
  }

  renderNav();
  const fn = VIEWS[state.route];
  if (!fn) {
    view.innerHTML = '<p class="empty">Страница не найдена</p>';
    return;
  }

    if (state.route === 'login') {
    view.innerHTML = await viewLogin();
    bindEvents();
    SanEpidUI?.initLogin?.();
    SanEpidUI?.syncThemeToggle?.();
    SanEpidPolish?.pageEnter?.();
    return;
  }

  view.innerHTML = '<p class="empty">Загрузка...</p>';
  try {
    SanEpidUI?.cleanup?.();
    view.innerHTML = await fn();
    bindEvents();
    SanEpidPolish?.pageEnter?.();
    SanEpidPolish?.bindCardTilt?.();
    if (state.route === 'dashboard') {
      SanEpidUI?.initDashboard?.();
      SanEpidUI?.maybeStartTour?.();
    }
    if (state.route === 'compliance') {
      document.querySelectorAll('[data-animate]').forEach(el => {
        SanEpidUI?.animateValue?.(el, parseInt(el.dataset.animate, 10), el.dataset.suffix || '');
      });
    }
    if (state.route === 'terminal') {
      SanEpidUI?.initTerminal?.();
      SanEpidPolish?.terminalFx?.();
    }
    SanEpidUI?.bindCommandPalette?.(state.user?.role);
  } catch (e) {
    view.innerHTML = `<p class="empty">Ошибка: ${esc(e.message)}</p>`;
  }
}

window.navigate = navigate;
window.canAccessRoute = canAccessRoute;
window.addEventListener('hashchange', render);
state.user = getUser();
parseHash();
render();
