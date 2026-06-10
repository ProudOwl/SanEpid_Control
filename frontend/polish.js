/* SanEpid Control — визуальные эффекты */
(function (global) {
  let welcomeShown = false;
  let rippleBound = false;

  function bindRipples() {
    if (rippleBound) return;
    rippleBound = true;
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn, nav button, .zone-tile, .notif-btn, .theme-btn');
      if (!btn) return;
      const r = document.createElement('span');
      r.className = 'ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      r.style.width = r.style.height = size + 'px';
      r.style.left = (e.clientX - rect.left - size / 2) + 'px';
      r.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.classList.add('ripple-host');
      btn.appendChild(r);
      setTimeout(() => r.remove(), 650);
    });
  }

  function pageEnter() {
    const view = document.getElementById('view');
    if (!view) return;
    view.classList.remove('page-enter');
    void view.offsetWidth;
    view.classList.add('page-enter');
    cardStagger();
  }

  function cardStagger() {
    const items = document.querySelectorAll('#view .card, #view .stat, #view .alert-banner');
    items.forEach((el, i) => {
      el.classList.remove('stagger-in');
      el.style.animationDelay = (i * 0.06) + 's';
      void el.offsetWidth;
      el.classList.add('stagger-in');
    });
  }

  function welcomeSplash(name) {
    if (welcomeShown || !name) return;
    welcomeShown = true;
    const el = document.getElementById('welcome-splash');
    if (!el) return;
    el.querySelector('.welcome-name').textContent = name;
    el.classList.remove('hidden');
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.classList.add('hidden'), 500);
    }, 2200);
  }

  function terminalFx() {
    const led = document.querySelector('.terminal-card');
    if (!led) return;
    led.classList.add('scan-active');
    if (!document.getElementById('terminal-scanline')) {
      const line = document.createElement('div');
      line.id = 'terminal-scanline';
      line.className = 'terminal-scanline';
      led.appendChild(line);
    }
  }

  function bindCardTilt() {
    document.querySelectorAll('#view .card.tilt-card').forEach(card => {
      card.onmousemove = (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = `perspective(800px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateY(-2px)`;
      };
      card.onmouseleave = () => { card.style.transform = ''; };
    });
  }

  function sparkle(x, y) {
    for (let i = 0; i < 10; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 50;
      s.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  function enhanceToast() {
    const orig = global.toast;
    if (!orig || orig._polish) return;
    global.toast = function (msg, type = 'info') {
      orig(msg, type);
      const el = document.getElementById('toast');
      if (!el) return;
      const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
      el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${msg}</span>`;
      el.classList.add('toast-pop');
      setTimeout(() => el.classList.remove('toast-pop'), 400);
    };
    global.toast._polish = true;
  }

  async function updateFooterStatus() {
    const el = document.getElementById('footer-status');
    if (!el) return;
    try {
      const h = await fetch('/api/health').then(r => r.json());
      el.innerHTML = `<span class="status-dot ok"></span> Система online · SMTP ${h.smtp_configured ? 'активен' : 'не настроен'}`;
    } catch (_) {
      el.innerHTML = '<span class="status-dot bad"></span> Нет связи с сервером';
    }
  }

  function initPolish() {
    bindRipples();
    enhanceToast();
    updateFooterStatus();
    setInterval(updateFooterStatus, 30000);
    document.querySelector('.logo')?.classList.add('logo-glow');
  }

  function resetWelcome() { welcomeShown = false; }

  global.SanEpidPolish = {
    pageEnter, welcomeSplash, terminalFx, bindCardTilt, cardStagger, sparkle, initPolish, resetWelcome,
  };

  initPolish();
})(window);
