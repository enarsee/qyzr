(function () {
  const token = location.pathname.split('/').pop();
  const root = document.getElementById('root');
  const hintTL = document.getElementById('hintTL');
  const hintTR = document.getElementById('hintTR');

  let quiz = null;
  let state = null;
  let lastReveal = null;
  let socket = null;
  let answerCount = 0, answerTotal = 0;
  let liveDistribution = {}; // option_id -> count, while in active state
  let qrSvg = '';
  let lastInputAt = Date.now();

  const FACE_STATES = ['winner','happy','neutral','sad','angry'];

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function faceUrl(side, st) {
    const f = (quiz.faces || []).find(x => x.side === side && x.state === st);
    return f ? f.image_path : `/defaults/${side}-${st}.svg`;
  }

  // ── Bootstrap ─────────────────────────────────────────────
  async function start() {
    const r = await fetch(`/api/quiz?token=${encodeURIComponent(token)}`);
    if (!r.ok) {
      root.innerHTML = '<p style="text-align:center; color:var(--error); padding-top:120px;">Quiz not found.</p>';
      return;
    }
    quiz = await r.json();
    document.title = `Presenter · ${quiz.name}`;

    const qrRes = await fetch(`/api/qr/${encodeURIComponent(quiz.room_code)}`);
    qrSvg = await qrRes.text();

    connect();
    bindKeyboard();
    bindHintFader();
  }

  function connect() {
    socket = WQ_connect({ role: 'host', creator_token: token });
    socket.on('state', (s) => { state = s; if (state.status === 'active') liveDistribution = {}; render(); });
    socket.on('player:joined', () => { /* state will follow */ });
    socket.on('player:left', () => { /* state will follow */ });
    socket.on('question:show', () => { lastReveal = null; liveDistribution = {}; answerCount = 0; answerTotal = state?.players?.length || 0; render(); });
    socket.on('answer:received', ({ count, total, option_id }) => {
      answerCount = count; answerTotal = total;
      if (option_id) liveDistribution[option_id] = (liveDistribution[option_id] || 0) + 1;
      updateLiveBars();
    });
    socket.on('question:reveal', (r) => { lastReveal = r; render(); });
    socket.on('game:finished', (r) => { lastReveal = r; if (state) state.status = 'finished'; render(); });
    socket.on('error', (e) => console.warn('socket error:', e));
  }

  // ── Keyboard ──────────────────────────────────────────────
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      lastInputAt = Date.now();
      if (e.key === 'ArrowRight' || e.code === 'Space') { e.preventDefault(); advance(); }
      else if (e.key === 'Escape') { exitConfirm(); }
      else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
      else if (e.key === '?') { /* future help */ }
    });
    document.addEventListener('mousemove', () => { lastInputAt = Date.now(); });
  }

  function advance() {
    if (!state || state.status === 'finished') return;
    if (!state.game_id) { socket.emit('host:start'); return; }
    if (state.status === 'lobby') { socket.emit('host:next', { game_id: state.game_id }); return; }
    if (state.status === 'active') { socket.emit('host:reveal', { game_id: state.game_id }); return; }
    if (state.status === 'revealing') { socket.emit('host:next', { game_id: state.game_id }); return; }
  }

  function exitConfirm() {
    if (state && state.status === 'active') {
      if (!confirm('A question is currently open. Exit presenter mode?')) return;
    }
    location.href = `/host/${token}`;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  function bindHintFader() {
    setInterval(() => {
      const idle = Date.now() - lastInputAt > 3000;
      hintTL.classList.toggle('dim', idle);
      hintTR.classList.toggle('dim', idle);
    }, 500);
  }

  // ── Hint overlay text ─────────────────────────────────────
  function setHints() {
    if (!state) { hintTL.textContent = ''; hintTR.textContent = ''; return; }
    const cur = state.current_question;
    const qIdx = cur ? `Q ${cur.position}/${state.total_questions}` : `Q 0/${state.total_questions}`;
    let leftBits = [qIdx];
    if (state.status === 'active') leftBits.push(`${answerCount}/${answerTotal} answered`);
    leftBits.push(`${state.players.length} player${state.players.length === 1 ? '' : 's'}`);
    hintTL.textContent = leftBits.join(' · ');

    let nextLabel = '→ start';
    if (!state.game_id) nextLabel = '→ start';
    else if (state.status === 'lobby') nextLabel = '→ first question';
    else if (state.status === 'active') nextLabel = '→ reveal results';
    else if (state.status === 'revealing') nextLabel = '→ next';
    else if (state.status === 'finished') nextLabel = '';
    hintTR.textContent = `${nextLabel}${nextLabel ? '  ·  ' : ''}ESC exit  ·  F fullscreen`;
  }

  // ── Render dispatcher ─────────────────────────────────────
  function render() {
    setHints();
    if (!state) return;
    if (!state.game_id || state.status === 'lobby') return renderLobby();
    if (state.status === 'active') return renderQuestion();
    if (state.status === 'revealing' || state.status === 'finished') return renderReveal();
  }

  // ── Lobby ─────────────────────────────────────────────────
  function renderLobby() {
    root.className = 'stage lobby';
    root.innerHTML = `
      <div class="lobby-hero">
        ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" alt="">` : ''}
        <h1 style="color: ${quiz.accent_color};">${escapeHtml(quiz.name)}</h1>
        <p style="font-family:'Inter';color:var(--muted);font-size:24px;margin:0;">Scan or join below</p>
      </div>
      <div class="qr-card">
        ${qrSvg}
        <div style="text-align:center;">
          <div class="qr-url">${location.origin}/play</div>
          <div style="font-family:'Inter';font-size:18px;color:var(--muted);margin:12px 0 8px;">Code</div>
          <div class="qr-code-big tabular">${quiz.room_code}</div>
        </div>
      </div>
      <div class="ticker" id="ticker"></div>
    `;
    renderTicker();
  }

  function renderTicker() {
    const t = document.getElementById('ticker');
    if (!t) return;
    const names = state.players.map(p => p.name);
    if (!names.length) { t.innerHTML = ''; return; }
    t.innerHTML = names.map(n => `<span>${escapeHtml(n)} ·</span>`).join('');
  }

  // ── Question (live voting) ───────────────────────────────
  function renderQuestion() {
    const cur = state.current_question;
    if (!cur) { renderLobby(); return; }
    root.className = 'stage qstage';
    const letters = ['A','B','C','D'];
    const imgWrap = cur.image_url ? 'with-image' : '';
    root.innerHTML = `
      <div class="qtext-wrap ${imgWrap}">
        <h1 class="qtext">${escapeHtml(cur.text)}</h1>
        ${cur.image_url ? `<img class="qimg" src="${cur.image_url}" alt="">` : ''}
      </div>
      <div class="opts" id="opts">
        ${cur.options.map((o, i) => `
          <div class="opt" data-id="${o.id}">
            <span class="opt-letter">${letters[i]}</span>
            <div class="opt-text">${escapeHtml(o.text)}</div>
            <div class="opt-vote-fill" data-fill="${o.id}"></div>
          </div>
        `).join('')}
      </div>
      <div class="qprogress" id="qprogress"></div>
    `;
    updateLiveBars();
    updateProgressDots();
  }

  function updateLiveBars() {
    if (!state || state.status !== 'active') return;
    setHints();
    const total = answerTotal || state.players.length || 0;
    const max = Math.max(1, ...Object.values(liveDistribution));
    document.querySelectorAll('.opt-vote-fill').forEach(el => {
      const id = el.dataset.fill;
      const v = liveDistribution[id] || 0;
      el.style.transform = `scaleY(${v / max})`;
      el.classList.toggle('consensus', total > 0 && v / total > 0.5);
    });
    updateProgressDots();
  }

  function updateProgressDots() {
    const wrap = document.getElementById('qprogress');
    if (!wrap) return;
    const total = answerTotal || state.players.length || 0;
    const filled = Math.round((answerCount / Math.max(1, total)) * 10);
    let dots = '';
    for (let i = 0; i < 10; i++) dots += `<div class="dot ${i < filled ? 'fill' : ''}"></div>`;
    wrap.innerHTML = `${dots}<span class="count">${answerCount} / ${total}</span>`;
  }

  // ── Reveal (poll mode: distribution only) ────────────────
  function renderReveal() {
    const cur = state.current_question;
    const r = lastReveal;
    if (!cur || !r) { renderLobby(); return; }
    root.className = 'stage qstage';
    const letters = ['A','B','C','D'];
    const distMap = Object.fromEntries((r.distribution || []).map(d => [d.option_id, d.n]));
    const totalVotes = Object.values(distMap).reduce((a,b) => a+b, 0) || 1;
    let popularId = null, popularN = 0;
    for (const [id, n] of Object.entries(distMap)) {
      if (n > popularN) { popularN = n; popularId = id; }
    }

    const imgWrap = cur.image_url ? 'with-image' : '';
    root.innerHTML = `
      <div class="qtext-wrap ${imgWrap}">
        <h1 class="qtext enter">${escapeHtml(cur.text)}</h1>
        ${cur.image_url ? `<img class="qimg" src="${cur.image_url}" alt="">` : ''}
      </div>
      <div class="opts">
        ${cur.options.map((o, i) => {
          const isPopular = popularN > 0 && o.id === popularId;
          const votes = distMap[o.id] || 0;
          const pct = Math.round((votes / totalVotes) * 100);
          return `
            <div class="opt ${isPopular ? 'correct' : ''}">
              <span class="opt-letter">${letters[i]}</span>
              <div class="opt-text">${escapeHtml(o.text)}</div>
              <div class="opt-count">${pct}% (${votes})</div>
            </div>`;
        }).join('')}
      </div>
      <p class="enter-2" style="text-align:center;font-family:'Inter';color:var(--muted);font-size:18px;">
        ${popularN} of ${totalVotes} ${totalVotes === 1 ? 'vote' : 'votes'} for the most popular answer
      </p>
    `;
  }

  start();
})();
