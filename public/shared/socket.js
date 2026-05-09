window.WQ_connect = function(auth) {
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
    timeout: 10000
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
