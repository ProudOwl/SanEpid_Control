/* SanEpid Control — интерактивные модули */
(function (global) {
  let liveTimer = null;
  let clockTimer = null;
  let heroTimer = null;
  let resendTimer = null;
  let resendLeft = 0;
  let tourStep = 0;
  let cmdBound = false;

  const TOUR_STEPS = [
    { sel: '.grid.grid-4', title: 'Панель показателей', text: 'Счётчики проходов, блокировок и просроченных санкнижек обновляются с анимацией.' },
    { sel: '#zone-map', title: 'Карта зон LIVE', text: 'Кликайте по зонам — видно занятость и последнего сотрудника. Данные обновляются каждые 5 секунд.' },
    { sel: '#live-feed', title: 'Лента проходов', text: 'Журнал событий в реальном времени — как на промышленном мониторинге.' },
    { sel: '#notif-btn', title: 'Инциденты', text: 'Колокольчик показывает открытые инциденты санэпидконтроля.' },
    { sel: '#nav', title: 'Навигация', text: 'Терминал прохода, журнал, заявки на регистрацию. Нажмите Ctrl+K для быстрого перехода.' },
  ];

  function callApi(path, opts) {
    if (typeof global.api !== 'function') throw new Error('Приложение ещё загружается — обновите страницу');
    return global.api(path, opts);
  }

  function animateValue(el, target, suffix = '') {
    if (!el) return;
    suffix = suffix || el.dataset.suffix || '';
    const start = parseInt(el.dataset.value || '0', 10);
    const diff = target - start;
    if (diff === 0) { el.textContent = target + suffix; return; }
    const steps = 20;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const val = Math.round(start + (diff * step) / steps);
      el.textContent = val + suffix;
      if (step >= steps) {
        clearInterval(timer);
        el.dataset.value = String(target);
      }
    }, 30);
  }

  function drawHourlyChart(canvas, hourly) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth * 2;
    const h = canvas.height = canvas.clientHeight * 2;
    ctx.scale(2, 2);
    const cw = w / 2, ch = h / 2;
    ctx.clearRect(0, 0, cw, ch);
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const map = {};
    hourly.forEach(r => { map[r.hour] = r; });
    const max = Math.max(1, ...hours.map(hr => (map[hr]?.allowed || 0) + (map[hr]?.blocked || 0)));
    const barW = cw / 26;
    hours.forEach((hr, i) => {
      const a = map[hr]?.allowed || 0;
      const b = map[hr]?.blocked || 0;
      const x = 30 + i * barW;
      const ah = (a / max) * (ch - 40);
      const bh = (b / max) * (ch - 40);
      ctx.fillStyle = '#2a9d8f';
      ctx.fillRect(x, ch - 20 - ah, barW * 0.7, ah);
      ctx.fillStyle = '#d62839';
      ctx.fillRect(x, ch - 20 - ah - bh, barW * 0.7, bh);
      if (i % 3 === 0) {
        ctx.fillStyle = '#5b7a8f';
        ctx.font = '9px Manrope,sans-serif';
        ctx.fillText(hr, x, ch - 4);
      }
    });
    ctx.fillStyle = '#123047';
    ctx.font = '600 11px Manrope,sans-serif';
    ctx.fillText('Проходы по часам (сегодня)', 8, 14);
  }

  function renderZoneMap(container, zones) {
    if (!container) return;
    const typeColor = { operating: '#0077b6', reanimation: '#d62839', isolation: '#e09f3e', warehouse: '#2a9d8f' };
    container.innerHTML = zones.map(z => `
      <button type="button" class="zone-tile ${z.inside ? 'occupied' : ''}" data-zone-id="${z.id}" title="${z.name}">
        <span class="zone-dot" style="background:${typeColor[z.zone_type] || '#0077b6'}"></span>
        <strong>${z.name}</strong>
        <small>${z.passes_today} проходов</small>
        <small class="zone-person">${z.inside ? '👤 ' + (z.last_person || '—') : 'Свободно'}</small>
      </button>`).join('');
    container.querySelectorAll('.zone-tile').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.zone-tile').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const z = zones.find(x => x.id === +btn.dataset.zoneId);
        global.toast?.(`${z.name}: ${z.inside ? 'в зоне ' + z.last_person : 'зона свободна'}`, 'info');
      });
    });
  }

  function renderLiveFeed(el, feed) {
    if (!el) return;
    el.innerHTML = feed.length ? feed.map(r => `
      <div class="live-item ${r.allowed ? 'ok' : 'bad'}">
        <span class="live-time">${r.event_time?.slice(11, 16) || ''}</span>
        <span class="live-text">${r.employee_name} · ${r.zone_name} · ${r.direction === 'in' ? 'вход' : 'выход'}</span>
        <span class="live-badge">${r.allowed ? 'OK' : 'BLOCK'}</span>
      </div>`).join('') : '<p class="empty">Нет событий</p>';
  }

  function renderComplianceRings(el, items) {
    if (!el) return;
    el.innerHTML = items.slice(0, 8).map(r => {
      const c = r.score >= 90 ? '#2a9d8f' : r.score >= 70 ? '#e09f3e' : '#d62839';
      const pct = r.score;
      const factors = (r.factors || []).map(f =>
        `${f.label}: ${f.points}/${f.max}`
      ).join('\n');
      const tip = factors + (r.issues?.length ? '\n\n' + r.issues.join('\n') : '');
      return `<div class="ring-card" title="${escAttr(tip)}">
        <svg viewBox="0 0 36 36" class="ring-svg"><path class="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
        <path class="ring-fill" stroke="${c}" stroke-dasharray="${pct}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
        <text x="18" y="20.35" class="ring-text">${pct}%</text></svg>
        <div><strong>${r.full_name.split(' ')[0]}</strong><small>${r.badge_number}</small></div>
        ${r.factors ? `<div class="ring-factors">${r.factors.slice(0, 2).map(f =>
          `<span class="rf ${f.status}">${f.points}/${f.max}</span>`
        ).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function startClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const tick = () => {
      const d = new Date();
      el.textContent = d.toLocaleString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    tick();
    clearInterval(clockTimer);
    clockTimer = setInterval(tick, 1000);
  }

  async function refreshLive() {
    if (!global.getToken?.()) return;
    try {
      const data = await callApi('/live/overview');
      renderLiveFeed(document.getElementById('live-feed'), data.feed);
      drawHourlyChart(document.getElementById('hourly-chart'), data.hourly || []);
      renderZoneMap(document.getElementById('zone-map'), data.zones || []);
      const inc = document.getElementById('notif-count');
      if (inc) {
        const n = data.open_incidents || 0;
        inc.textContent = n;
        inc.classList.toggle('hidden', !n);
        inc.classList.toggle('pulse-badge', n > 0);
      }
    } catch (_) { /* ignore polling errors */ }
  }

  function startLivePolling() {
    stopLivePolling();
    refreshLive();
    liveTimer = setInterval(refreshLive, 5000);
  }

  function stopLivePolling() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
  }

  function initDashboard(stats) {
    startClock();
    startLivePolling();
    document.querySelectorAll('[data-animate]').forEach(el => {
      animateValue(el, parseInt(el.dataset.animate, 10));
    });
    if (document.getElementById('compliance-rings')) {
      callApi('/live/compliance-summary').then(d => {
        renderComplianceRings(document.getElementById('compliance-rings'), d.items || []);
      }).catch(() => {});
    }
  }

  function initTerminal() {
    const led = document.getElementById('terminal-led');
    const preview = (allowed, text) => {
      if (!led) return;
      led.className = 'terminal-led ' + (allowed === null ? 'idle' : allowed ? 'green' : 'red');
      led.innerHTML = `<div class="led-icon">${allowed === null ? '⏳' : allowed ? '✓' : '✗'}</div><div class="led-text">${text}</div>`;
    };
    global._terminalPreview = preview;
    preview(null, 'Ожидание проверки');

    const scan = document.getElementById('pass-scan');
    const empSel = document.getElementById('pass-employee');
    scan?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const val = scan.value.trim().toLowerCase();
      if (!val || !empSel) return;
      const opt = [...empSel.options].find(o => o.text.toLowerCase().includes(val) || o.value === val);
      if (opt) {
        empSel.value = opt.value;
        scan.value = '';
        preview(null, 'Сотрудник выбран');
        empSel.dispatchEvent(new Event('change'));
        playBeep(true);
      } else {
        preview(false, 'БЕЙДЖ НЕ НАЙДЕН');
        playBeep(false);
      }
    });

    document.getElementById('terminal-kiosk')?.addEventListener('click', () => {
      document.body.classList.toggle('kiosk-mode');
      global.toast?.(document.body.classList.contains('kiosk-mode') ? 'Режим киоска' : 'Обычный режим', 'info');
    });

    const runPrecheck = async () => {
      const eid = document.getElementById('pass-employee')?.value;
      const zid = document.getElementById('pass-zone')?.value;
      if (!eid || !zid) return;
      try {
        const res = await callApi('/access/precheck', { method: 'POST', body: JSON.stringify({ employee_id: +eid, zone_id: +zid, temperature: +document.getElementById('pass-temp')?.value || 36.6 }) });
        preview(res.allowed, res.allowed ? 'ДОПУСК РАЗРЕШЁН' : 'ДОПУСК ЗАПРЕЩЁН');
      } catch (_) {}
    };
    document.getElementById('pass-employee')?.addEventListener('change', runPrecheck);
    document.getElementById('pass-zone')?.addEventListener('change', runPrecheck);
    document.getElementById('pass-temp')?.addEventListener('change', runPrecheck);
  }

  function playBeep(ok) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = ok ? 880 : 220;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, ok ? 120 : 280);
    } catch (_) {}
  }

  function initLogin() {
    clearInterval(heroTimer);
    fetch('/api/public/stats').then(r => r.json()).then(stats => {
      const map = {
        passes: stats.access_today,
        zones: stats.zones,
        blocks: stats.blocked_today,
      };
      Object.entries(map).forEach(([k, target]) => {
        const el = document.getElementById(`hero-${k}`);
        if (el) animateValue(el, target);
      });
    }).catch(() => {});
    heroTimer = setInterval(() => {
      fetch('/api/public/stats').then(r => r.json()).then(s => {
        const el = document.getElementById('hero-passes');
        if (el) el.textContent = s.access_today;
      }).catch(() => {});
    }, 15000);
  }

  function initTheme() {
    const saved = localStorage.getItem('sanepid_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    syncThemeToggle();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('sanepid_theme', next);
    syncThemeToggle();
  }

  function syncThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.textContent = dark ? '☀️' : '🌙';
    btn.title = dark ? 'Светлая тема' : 'Тёмная тема';
  }

  let particleTimer = null;
  function initParticles() {
    const canvas = document.getElementById('bg-particles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dots = [];
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < 40; i++) {
      dots.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, r: Math.random() * 2 + 1, dx: (Math.random() - .5) * .4, dy: (Math.random() - .5) * .4 });
    }
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const col = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0077b6';
      dots.forEach(d => {
        d.x += d.dx; d.y += d.dy;
        if (d.x < 0 || d.x > canvas.width) d.dx *= -1;
        if (d.y < 0 || d.y > canvas.height) d.dy *= -1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.globalAlpha = .12;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      particleTimer = requestAnimationFrame(draw);
    };
    draw();
  }

  function confetti(ok = true) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('span');
      el.className = 'confetti-piece';
      el.textContent = ok ? '✓' : '✗';
      el.style.left = (40 + Math.random() * 20) + '%';
      el.style.top = '30%';
      el.style.setProperty('--dx', (Math.random() - .5) * 200 + 'px');
      el.style.setProperty('--dy', (Math.random() * 120 + 40) + 'px');
      el.style.color = ok ? 'var(--success)' : 'var(--danger)';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1200);
    }
  }

  function startResendTimer(seconds = 60) {
    clearInterval(resendTimer);
    resendLeft = seconds;
    const btn = document.getElementById('auth-resend');
    const label = document.getElementById('resend-timer');
    const tick = () => {
      if (label) label.textContent = resendLeft > 0 ? `Повторная отправка через ${resendLeft} сек` : '';
      if (btn) btn.disabled = resendLeft > 0;
      if (resendLeft <= 0) { clearInterval(resendTimer); return; }
      resendLeft--;
    };
    tick();
    resendTimer = setInterval(tick, 1000);
  }

  function maybeStartTour() {
    if (localStorage.getItem('sanepid_tour_done')) return;
    setTimeout(() => startTour(), 600);
  }

  function startTour() {
    tourStep = 0;
    document.getElementById('tour-overlay')?.classList.remove('hidden');
    showTourStep();
    document.getElementById('tour-next')?.addEventListener('click', nextTour);
    document.getElementById('tour-skip')?.addEventListener('click', endTour);
  }

  function showTourStep() {
    const step = TOUR_STEPS[tourStep];
    if (!step) return endTour();
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
    const target = document.querySelector(step.sel);
    const spot = document.querySelector('.tour-spotlight');
    const card = document.querySelector('.tour-card');
    document.getElementById('tour-step-label').textContent = `Шаг ${tourStep + 1} из ${TOUR_STEPS.length}`;
    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-text').textContent = step.text;
    if (target && spot) {
      target.classList.add('tour-highlight');
      const r = target.getBoundingClientRect();
      spot.style.top = (r.top - 8) + 'px';
      spot.style.left = (r.left - 8) + 'px';
      spot.style.width = (r.width + 16) + 'px';
      spot.style.height = (r.height + 16) + 'px';
      if (card) {
        card.style.top = Math.min(window.innerHeight - 200, r.bottom + 16) + 'px';
        card.style.left = Math.max(16, Math.min(r.left, window.innerWidth - 340)) + 'px';
      }
    }
    document.getElementById('tour-next').textContent = tourStep >= TOUR_STEPS.length - 1 ? 'Готово' : 'Далее';
  }

  function nextTour() {
    tourStep++;
    if (tourStep >= TOUR_STEPS.length) endTour();
    else showTourStep();
  }

  function endTour() {
    localStorage.setItem('sanepid_tour_done', '1');
    document.getElementById('tour-overlay')?.classList.add('hidden');
    document.querySelectorAll('.tour-highlight').forEach(el => el.classList.remove('tour-highlight'));
  }

  function bindCommandPalette() {
    if (cmdBound) return;
    cmdBound = true;
    const palette = document.getElementById('cmd-palette');
    const input = document.getElementById('cmd-input');
    const list = document.getElementById('cmd-list');
    const allRoutes = [
      { route: 'dashboard', label: 'Главная' },
      { route: 'terminal', label: 'Терминал прохода' },
      { route: 'employees', label: 'Сотрудники' },
      { route: 'zones', label: 'Зоны' },
      { route: 'permissions', label: 'Допуски' },
      { route: 'documents', label: 'Документы' },
      { route: 'incidents', label: 'Инциденты' },
      { route: 'access-logs', label: 'Журнал проходов' },
      { route: 'compliance', label: 'Аналитика' },
      { route: 'registrations', label: 'Заявки на регистрацию' },
      { route: 'settings', label: 'Настройки почты SMTP' },
      { route: 'users', label: 'Пользователи' },
      { route: 'audit', label: 'Аудит' },
      { route: 'my-profile', label: 'Мой профиль' },
    ];

    function routesForUser() {
      return allRoutes.filter(r => global.canAccessRoute?.(r.route) !== false);
    }

    function openPalette() {
      if (!global.getToken?.()) return;
      palette?.classList.remove('hidden');
      input.value = '';
      renderList('');
      setTimeout(() => input?.focus(), 50);
    }
    function closePalette() {
      palette?.classList.add('hidden');
    }
    function renderList(q) {
      const ql = q.toLowerCase();
      const items = routesForUser().filter(r => r.label.toLowerCase().includes(ql));
      list.innerHTML = items.map(r =>
        `<button type="button" data-route="${r.route}">${r.label}</button>`
      ).join('') || '<p class="empty" style="padding:.75rem">Ничего не найдено</p>';
      list.querySelectorAll('button[data-route]').forEach(btn => {
        btn.onclick = () => { closePalette(); global.navigate?.(btn.dataset.route); };
      });
    }
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        palette?.classList.contains('hidden') ? openPalette() : closePalette();
      }
      if (e.key === 'Escape') closePalette();
    });
    input?.addEventListener('input', () => renderList(input.value));
    palette?.querySelector('.cmd-backdrop')?.addEventListener('click', closePalette);
  }

  function exportAccessCsv() {
    callApi('/access-logs?per_page=200').then(data => {
      const rows = [['Время', 'Сотрудник', 'Зона', 'Направление', 'Темп', 'Результат', 'Причина']];
      data.items.forEach(r => rows.push([r.event_time, r.employee_name, r.zone_name, r.direction, r.temperature ?? '', r.allowed ? 'OK' : 'BLOCK', r.block_reason || '']));
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sanepid_access_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      global.toast?.('Журнал экспортирован', 'success');
    }).catch(e => global.toast?.(e.message, 'error'));
  }

  function cleanup() {
    stopLivePolling();
    clearInterval(heroTimer);
    clearInterval(resendTimer);
  }

  global.SanEpidUI = {
    initDashboard, initTerminal, initLogin, initTheme, initParticles, cleanup, exportAccessCsv, refreshLive,
    startResendTimer, maybeStartTour, startTour, bindCommandPalette, playBeep, animateValue, confetti, syncThemeToggle, toggleTheme,
  };

  initTheme();
  initParticles();
})(window);
