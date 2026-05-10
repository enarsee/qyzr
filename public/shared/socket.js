// Connection helper used by play / host / display / present apps.
//
// WQ_connect(auth) returns a Socket.IO client wired with sensible
// reconnect defaults for flaky mobile networks (carrier proxies,
// captive portals, screen-locked phones).
//
// WQ_statusBanner(socket) attaches a sticky top banner that reflects
// the connection state. After ~8 seconds of failed reconnects the
// banner escalates from soft "Reconnecting…" to a sticky red
// "Connection lost — Tap to refresh" with a refresh button. Clients
// don't need to manage banner DOM themselves.
//
// Usage:
//   const s = WQ_connect({ role: 'player', room_code: 'ABC123' });
//   WQ_statusBanner(s);

window.WQ_connect = function (auth) {
  // Allow both transports so flaky mobile networks can fall back to polling
  // when the WebSocket upgrade fails (carrier proxies, captive portals, etc).
  const s = io({
    auth,
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  // Force-reconnect when the page becomes visible again (mobile screen unlock).
  // Without this, the OS-suspended WS may stay "connected" client-side until
  // the next ping timeout — which can be 30+ seconds of stale UI.
  const wakeReconnect = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && !s.connected) {
      try { s.connect(); } catch {}
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', wakeReconnect);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', wakeReconnect);
    window.addEventListener('focus', wakeReconnect);
    window.addEventListener('pageshow', wakeReconnect);
  }
  return s;
};

window.WQ_statusBanner = function (socket, options) {
  const opts = options || {};
  // After this many ms of failed reconnects, escalate to a sticky red banner
  // with a Refresh button. Below this threshold we just show a soft amber strip.
  const ESCALATE_AFTER_MS = typeof opts.escalateAfterMs === 'number' ? opts.escalateAfterMs : 8000;

  // Inject styles once.
  if (!document.getElementById('wq-banner-styles')) {
    const style = document.createElement('style');
    style.id = 'wq-banner-styles';
    style.textContent = `
      .wq-banner {
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        padding: 10px 16px; text-align: center;
        font-family: 'Inter', system-ui, -apple-system, sans-serif;
        font-size: 14px; font-weight: 500;
        display: none; align-items: center; justify-content: center; gap: 12px;
        transition: background 200ms ease, color 200ms ease, transform 200ms ease;
        transform: translateY(-100%);
      }
      .wq-banner.visible { display: flex; transform: translateY(0); }
      .wq-banner.soft { background: #FFF3D6; color: #7A5A00; border-bottom: 1px solid #E8C97A; }
      .wq-banner.hard { background: #C8587A; color: #fff; border-bottom: 1px solid #A14A65; }
      .wq-banner .wq-banner-spinner {
        width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid currentColor; border-right-color: transparent;
        animation: wq-spin 700ms linear infinite;
      }
      @keyframes wq-spin { to { transform: rotate(360deg); } }
      .wq-banner button {
        background: rgba(255,255,255,0.95); color: var(--ink, #2A1F26);
        border: none; border-radius: 999px; padding: 6px 14px;
        font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        min-height: 32px; transition: transform 120ms ease;
      }
      .wq-banner button:hover { transform: translateY(-1px); }
      .wq-banner button:active { transform: translateY(0); }
      @media (prefers-reduced-motion: reduce) {
        .wq-banner { transition: none; }
        .wq-banner-spinner { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'wq-banner';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.prepend(el);

  let escalateTimer = null;
  let everConnected = false;

  function clearEscalate() {
    if (escalateTimer) { clearTimeout(escalateTimer); escalateTimer = null; }
  }
  function hide() {
    el.classList.remove('visible', 'soft', 'hard');
    el.innerHTML = '';
  }
  function showSoft(msg) {
    el.className = 'wq-banner visible soft';
    el.innerHTML = `<span class="wq-banner-spinner" aria-hidden="true"></span><span>${msg}</span>`;
  }
  function showHard(msg) {
    el.className = 'wq-banner visible hard';
    el.innerHTML = `<span>${msg}</span><button type="button">Refresh</button>`;
    el.querySelector('button').addEventListener('click', () => { location.reload(); });
  }

  socket.on('connect', () => {
    everConnected = true;
    clearEscalate();
    hide();
  });
  socket.on('disconnect', () => {
    showSoft('Reconnecting…');
    clearEscalate();
    escalateTimer = setTimeout(() => {
      showHard('Connection lost.');
    }, ESCALATE_AFTER_MS);
  });
  socket.on('connect_error', (e) => {
    // Don't show the banner for the very first failed attempt — let the app
    // handle it via the error UI (auth failures, no_active_game, etc.).
    if (!everConnected) return;
    showSoft('Reconnecting…');
    clearEscalate();
    escalateTimer = setTimeout(() => {
      showHard('Connection lost.');
    }, ESCALATE_AFTER_MS);
  });
};
