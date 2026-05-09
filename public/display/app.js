(function () {
  const code = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let lastReveal = null;
  let answerCount = 0, answerTotal = 0;
  let liveDistribution = {};
  const root = document.getElementById('root');

  async function loadPublic() {
    const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(code)}`);
    if (!r.ok) { root.innerHTML = '<p style="text-align:center; padding:80px; color:var(--error);">Room not found.</p>'; return; }
    quiz = await r.json();
    document.title = `${quiz.name} · Display`;
    connect();
  }

  function faceUrl(side, st) {
    const f = (quiz.faces || []).find(x => x.side === side && x.state === st);
    return f ? f.image_path : `/defaults/${side}-${st}.svg`;
  }

  function optionSide(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (t === String(quiz.bride_label || 'Bride').trim().toLowerCase()) return 'bride';
    if (t === String(quiz.groom_label || 'Groom').trim().toLowerCase()) return 'groom';
    return null;
  }

  function moodFor(share, hasAnyVotes) {
    if (!hasAnyVotes) return 'neutral';
    if (share >= 0.95) return 'winner';
    if (share >= 0.65) return 'happy';
    if (share >= 0.35) return 'neutral';
    if (share >= 0.10) return 'sad';
    return 'angry';
  }

  let lastServerEventAt = Date.now();
  function bumpHeartbeat() { lastServerEventAt = Date.now(); }

  function connect() {
    const s = WQ_connect({ role: 'display', room_code: code });
    s.on('state', (st) => { state = st; if (state.status === 'active') liveDistribution = {}; bumpHeartbeat(); render(); });
    s.on('question:show', () => { answerCount = 0; answerTotal = state?.players?.length || 0; liveDistribution = {}; lastReveal = null; bumpHeartbeat(); render(); });
    s.on('answer:received', ({ count, total, option_id }) => {
      answerCount = count; answerTotal = total;
      if (option_id) liveDistribution[option_id] = (liveDistribution[option_id] || 0) + 1;
      bumpHeartbeat();
      updateLive();
    });
    s.on('question:reveal', (r) => { lastReveal = r; bumpHeartbeat(); render(); });
    s.on('game:finished', (r) => { lastReveal = r; if (state) state.status = 'finished'; bumpHeartbeat(); render(); });
    s.on('player:joined', bumpHeartbeat);
    s.on('player:left', bumpHeartbeat);

    // Idle indicator: if no server event in 30s during lobby/active, show "Waiting for host…"
    setInterval(() => {
      const idleMs = Date.now() - lastServerEventAt;
      const banner = document.getElementById('idleBanner');
      if (!banner) return;
      const showIt = idleMs > 30000 && state && (state.status === 'lobby' || state.status === 'active');
      banner.style.display = showIt ? 'block' : 'none';
    }, 2000);
  }

  function updateLive() {
    const ac = document.getElementById('answerCounter');
    if (ac) ac.textContent = `${answerCount} / ${answerTotal} answered`;
    if (!state || state.status !== 'active') return;
    const totalVotes = Object.values(liveDistribution).reduce((a,b) => a+b, 0);
    const max = Math.max(1, ...Object.values(liveDistribution));
    document.querySelectorAll('.option-card[data-id]').forEach(card => {
      const id = card.dataset.id;
      const v = liveDistribution[id] || 0;
      const pct = totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0;
      const bar = card.querySelector('.vote-bar');
      if (bar) bar.style.height = `${(v / max) * 100}%`;
      const lbl = card.querySelector('.live-pct');
      if (lbl) lbl.textContent = `${pct}%`;
      const face = card.querySelector('.opt-face');
      if (face) {
        const side = face.dataset.side;
        const share = max > 0 ? v / max : 0;
        const mood = moodFor(share, totalVotes > 0);
        const newSrc = faceUrl(side, mood);
        if (face.src.indexOf(newSrc.split('/').pop()) === -1) face.src = newSrc;
        face.classList.toggle('winning-face', totalVotes > 0 && v === max && v > 0);
      }
    });
  }

  function render() {
    if (!state) return;
    if (state.status === 'lobby') return renderLobby();
    if (state.status === 'active') return renderQuestion();
    if (state.status === 'revealing' || state.status === 'finished') return renderReveal();
    return renderLobby();
  }

  function renderLobby() {
    root.innerHTML = `
      <div class="display-shell lobby">
        ${quiz.hero_image_path ? `<img class="hero-img" src="${quiz.hero_image_path}">` : ''}
        <h1 class="font-script" style="font-size: 120px; color: ${quiz.accent_color}; margin: 0;">${escapeHtml(quiz.name)}</h1>
        <div class="join-card">
          <p style="margin:0; color: var(--muted); font-family: 'Inter'; font-size: 24px;">Join at</p>
          <p style="margin: 8px 0 24px; font-family: 'Inter'; font-weight: 700; font-size: 36px;">${location.origin}/play</p>
          <div class="room-code-big tabular">${quiz.room_code}</div>
          <p style="font-family:'Inter'; color: var(--muted); margin-top: 24px;">${state.players.length} guests joined</p>
        </div>
      </div>`;
  }

  function renderQuestion() {
    const cur = state.current_question;
    if (!cur) return;
    const letters = ['A','B','C','D'];
    root.innerHTML = `
      <div class="display-shell">
        <p class="font-ui" style="color: var(--muted); font-size: 28px;">Question ${cur.position} of ${state.total_questions}</p>
        <div style="display:grid; grid-template-columns: ${cur.image_url ? '1fr 1fr' : '1fr'}; gap: 32px; align-items: center;">
          <div>
            <h1 class="question-text">${escapeHtml(cur.text)}</h1>
          </div>
          ${cur.image_url ? `<img src="${cur.image_url}" style="width:100%; max-height: 50vh; object-fit: contain; border-radius: var(--radius-md);">` : ''}
        </div>
        <div class="options-grid">
          ${cur.options.map((o, i) => {
            const side = optionSide(o.text);
            const face = side
              ? `<img class="opt-face" data-side="${side}" src="${faceUrl(side, 'neutral')}" alt="" style="width:96px;height:96px;border-radius:50%;object-fit:cover;object-position:50% 25%;position:relative;z-index:2;transition:filter 300ms ease-out;">`
              : '';
            return `
              <div class="option-card" data-id="${o.id}" style="position:relative;overflow:hidden;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:20px;">
                <span class="option-letter" style="position:relative;z-index:2;">${letters[i]}</span>
                <div class="option-text" style="position:relative;z-index:2;">${escapeHtml(o.text)}</div>
                ${face}
                <div class="vote-bar" style="height: 0%; opacity: 0.28;"></div>
                <div class="live-pct" style="position:absolute;bottom:14px;right:18px;font-family:'Inter';font-weight:700;color:var(--ink);font-size:24px;font-variant-numeric:tabular-nums;z-index:2;">0%</div>
              </div>
            `;
          }).join('')}
        </div>
        <p id="answerCounter" class="font-ui tabular" style="text-align:center; color: var(--muted);">${answerCount} / ${answerTotal} answered</p>
      </div>
    `;
    updateLive();
  }

  function renderReveal() {
    const cur = state.current_question;
    const r = lastReveal;
    if (!cur || !r) return renderLobby();
    const letters = ['A','B','C','D'];
    const totalVotes = r.distribution.reduce((a, b) => a + b.n, 0) || 1;
    const distMap = Object.fromEntries(r.distribution.map(d => [d.option_id, d.n]));
    let popularId = null, popularN = 0;
    for (const [id, n] of Object.entries(distMap)) {
      if (n > popularN) { popularN = n; popularId = id; }
    }
    const isTrivia = !!cur.is_trivia;
    const top5 = (r.leaderboard || []).slice(0, 5);
    const tables = (r.table_leaderboard || []).slice(0, 5);
    const showLeaderboard = isTrivia && top5.some(p => p.score > 0);

    root.innerHTML = `
      <div class="display-shell">
        <h1 class="question-text">${escapeHtml(cur.text)}</h1>
        <div class="options-grid">
          ${cur.options.map((o, i) => {
            const highlight = isTrivia ? (o.id === r.correct_option_id) : (popularN > 0 && o.id === popularId);
            const pct = Math.round(((distMap[o.id] || 0) / totalVotes) * 100);
            const votes = distMap[o.id] || 0;
            const dim = isTrivia && !highlight ? 'opacity: 0.4;' : '';
            return `
              <div class="option-card ${highlight ? 'correct' : ''}" style="${dim}">
                <span class="option-letter">${letters[i]}</span>
                <div class="option-text">${escapeHtml(o.text)}</div>
                <div style="position:absolute;bottom:12px;right:16px;font-family:'Inter';font-weight:600;color:var(--ink);">${pct}% · ${votes}</div>
                ${highlight ? `<div style="position:absolute;top:12px;right:16px;font-size:28px;color:var(--gold);font-weight:700;">${isTrivia ? '✓' : '★'}</div>` : ''}
                <div class="vote-bar" style="height: ${pct}%"></div>
              </div>`;
          }).join('')}
        </div>
        ${isTrivia
          ? `<p style="text-align:center;font-family:'Inter';color:var(--muted);font-size:18px;margin-top:8px;">${distMap[r.correct_option_id] || 0} of ${totalVotes} guests got it right</p>`
          : `<p style="text-align:center;font-family:'Inter';color:var(--muted);font-size:18px;margin-top:8px;">${popularN} of ${totalVotes} ${totalVotes === 1 ? 'vote' : 'votes'} for the most popular answer</p>`}
        ${showLeaderboard ? `
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px;">
            <div class="leaderboard">
              <h3>Top players</h3>
              <ol>${top5.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
            </div>
            <div class="leaderboard">
              <h3>Top ${escapeHtml(quiz.group_label || 'tables')}</h3>
              <ol>${tables.slice(0, 5).map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('')}</ol>
            </div>
          </div>
        ` : ''}
        ${isTrivia ? renderVsPanel(r) : ''}
      </div>
    `;
  }

  function renderVsPanel(r) {
    const sc = r.side_scores || { bride: 0, groom: 0 };
    const ss = r.side_states || { bride: 'neutral', groom: 'neutral' };
    if (sc.bride === 0 && sc.groom === 0) return '';
    const total = Math.max(sc.bride + sc.groom, 1);
    const bridePct = (sc.bride / total) * 100;
    return `
      <div class="vs-panel" style="margin-top: 24px;">
        <div style="text-align:center;">
          <img class="vs-face ${ss.bride === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('bride', ss.bride)}" alt="">
          <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.bride_label || 'Bride')} · ${sc.bride}</div>
        </div>
        <div class="vs-bar"><div class="vs-bar-fill" style="width:${bridePct}%;"></div></div>
        <div style="text-align:center;">
          <img class="vs-face ${ss.groom === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('groom', ss.groom)}" alt="">
          <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.groom_label || 'Groom')} · ${sc.groom}</div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadPublic();
})();
