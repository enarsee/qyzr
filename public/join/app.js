(async function () {
  const code = location.pathname.split('/').pop();
  const root = document.getElementById('root');
  const ticker = document.getElementById('ticker');

  const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(code)}`);
  if (!r.ok) {
    root.innerHTML = '<p style="text-align:center; color:var(--error); grid-column:1/-1;">Room not found.</p>';
    return;
  }
  const quiz = await r.json();
  document.title = `Join ${quiz.name}`;

  const qrRes = await fetch(`/api/qr/${encodeURIComponent(code)}`);
  const qrSvg = await qrRes.text();

  // Live ticker: connect as display, render joined names as they arrive.
  try {
    const s = WQ_connect({ role: 'display', room_code: code });
    s.on('state', (st) => {
      if (!ticker || !st || !Array.isArray(st.players)) return;
      const names = st.players.map(p => p.name);
      ticker.innerHTML = names.length
        ? names.map(n => `<span>${escapeHtml(n)} ·</span>`).join('')
        : '';
    });
    s.on('connect_error', () => { /* fine — game may not be live yet */ });
  } catch {}

  root.innerHTML = `
    <div class="hero-side">
      ${quiz.hero_image_path ? `<img class="hero-img" src="${quiz.hero_image_path}" alt="">` : ''}
      <h1 class="font-script" style="font-size: 80px; color: ${quiz.accent_color}; margin: 0;">${escapeHtml(quiz.name)}</h1>
      <p style="color: var(--muted); font-family: 'Inter'; margin: 0; font-size: 22px;">Scan or join below</p>
    </div>
    <div class="qr-side">
      ${qrSvg}
      <div style="text-align: center;">
        <p class="url-line" style="margin: 0 0 8px;">${location.origin}/play</p>
        <p style="font-family:'Inter'; color: var(--muted); font-size: 18px; margin: 0 0 12px;">Code</p>
        <div class="room-code-big tabular">${quiz.room_code}</div>
      </div>
    </div>
  `;

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
