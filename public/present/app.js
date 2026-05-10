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

  // If an option's text matches the configured bride/groom label, return that side; else null.
  function optionSide(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (t === String(quiz.bride_label || 'Bride').trim().toLowerCase()) return 'bride';
    if (t === String(quiz.groom_label || 'Groom').trim().toLowerCase()) return 'groom';
    return null;
  }

  // Pick a mood face for an option based on its share of votes vs the leader.
  // share is in [0, 1] where 1 = leader.
  function moodFor(share, hasAnyVotes) {
    if (!hasAnyVotes) return 'neutral';
    if (share >= 0.95) return 'winner';
    if (share >= 0.65) return 'happy';
    if (share >= 0.35) return 'neutral';
    if (share >= 0.10) return 'sad';
    return 'angry';
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

    // Render lobby immediately so we don't sit on "Loading…" before any state event.
    renderLobby();
    connect();
    bindKeyboard();
    bindHintFader();
  }

  function connect() {
    socket = WQ_connect({ role: 'host', creator_token: token });
    WQ_statusBanner(socket);
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
    // From the QR/lobby screen state may still be null (server doesn't emit
    // 'state' until a game exists). Treat that as "no game yet" and start.
    if (state && state.status === 'finished') return;
    if (!state || !state.game_id) { socket.emit('host:start'); return; }
    if (state.status === 'lobby') { socket.emit('host:next', { game_id: state.game_id }); return; }
    if (state.status === 'active') { socket.emit('host:reveal', { game_id: state.game_id }); return; }
    if (state.status === 'revealing') {
      const cur = state.current_question;
      const isLast = cur && cur.position >= state.total_questions;
      if (isLast) socket.emit('host:finish', { game_id: state.game_id });
      else socket.emit('host:next', { game_id: state.game_id });
      return;
    }
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
    if (state.status === 'revealing') return renderReveal();
    if (state.status === 'finished') return renderFinished();
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
    const names = (state?.players || []).map(p => p.name);
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
        ${cur.options.map((o, i) => {
          const side = optionSide(o.text);
          const facePlaceholder = side
            ? `<img class="opt-face" data-face="${o.id}" data-side="${side}" src="${faceUrl(side, 'neutral')}" alt="">`
            : '<span></span>';
          return `
            <div class="opt" data-id="${o.id}">
              <span class="opt-letter">${letters[i]}</span>
              <div class="opt-text">${escapeHtml(o.text)}</div>
              ${facePlaceholder}
              <div class="opt-vote-fill" data-fill="${o.id}"></div>
              <div class="opt-live-pct" data-pct="${o.id}">0%</div>
            </div>
          `;
        }).join('')}
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
    const totalVotes = Object.values(liveDistribution).reduce((a,b) => a+b, 0);
    const max = Math.max(1, ...Object.values(liveDistribution));
    const cur = state.current_question || {};

    document.querySelectorAll('.opt-vote-fill').forEach(el => {
      const id = el.dataset.fill;
      const v = liveDistribution[id] || 0;
      el.style.transform = `scaleY(${v / max})`;
      el.classList.toggle('consensus', total > 0 && v / total > 0.5);
    });

    document.querySelectorAll('.opt-live-pct').forEach(el => {
      const id = el.dataset.pct;
      const v = liveDistribution[id] || 0;
      const pct = totalVotes > 0 ? Math.round((v / totalVotes) * 100) : 0;
      el.textContent = `${pct}%`;
    });

    // Reactive faces: each face's mood = its share of votes.
    document.querySelectorAll('.opt-face[data-face]').forEach(img => {
      const id = img.dataset.face;
      const side = img.dataset.side;
      const v = liveDistribution[id] || 0;
      const share = max > 0 ? v / max : 0;
      const mood = moodFor(share, totalVotes > 0);
      const newSrc = faceUrl(side, mood);
      if (img.src.indexOf(newSrc.split('/').pop()) === -1) img.src = newSrc;
      img.classList.toggle('winning-face', totalVotes > 0 && v === max && v > 0);
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

  // ── Reveal (handles both trivia and poll questions) ─────
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
    const isTrivia = !!cur.is_trivia;
    const top5 = (r.leaderboard || []).slice(0, 5);
    const tables = (r.table_leaderboard || []).slice(0, 5);
    const showLeaderboard = isTrivia && top5.some(p => p.score > 0);

    const imgWrap = cur.image_url ? 'with-image' : '';
    root.innerHTML = `
      <div class="qtext-wrap ${imgWrap}">
        <h1 class="qtext enter">${escapeHtml(cur.text)}</h1>
        ${cur.image_url ? `<img class="qimg" src="${cur.image_url}" alt="">` : ''}
      </div>
      <div class="opts">
        ${cur.options.map((o, i) => {
          const highlight = isTrivia ? (o.id === r.correct_option_id) : (popularN > 0 && o.id === popularId);
          const votes = distMap[o.id] || 0;
          const pct = Math.round((votes / totalVotes) * 100);
          const dim = isTrivia && !highlight ? 'opacity:0.4;' : '';
          const max = Math.max(1, ...Object.values(distMap));
          const share = max > 0 ? votes / max : 0;
          const side = optionSide(o.text);
          const mood = side ? moodFor(share, totalVotes > 0) : null;
          const face = side ? `<img class="opt-face ${votes === max && votes > 0 ? 'winning-face' : ''}" src="${faceUrl(side, mood)}" alt="">` : '<span></span>';
          const fillPct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
          return `
            <div class="opt ${highlight ? 'correct' : ''}" style="${dim}">
              <span class="opt-letter">${letters[i]}</span>
              <div class="opt-text">${escapeHtml(o.text)}</div>
              ${face}
              <div class="opt-vote-fill" style="transform: scaleY(${fillPct/100});${highlight && !isTrivia ? 'background: var(--gold); opacity: 0.42;' : ''}"></div>
              <div class="opt-live-pct">${pct}%</div>
            </div>`;
        }).join('')}
      </div>
      <p class="enter-2" style="text-align:center;font-family:'Inter';color:var(--muted);font-size:18px;">
        ${isTrivia
          ? `${distMap[r.correct_option_id] || 0} of ${totalVotes} got it right`
          : `${popularN} of ${totalVotes} ${totalVotes === 1 ? 'vote' : 'votes'} for the most popular answer`}
      </p>
      ${showLeaderboard ? `
        <div class="reveal-extra enter-3">
          <div class="lb">
            <h3>Top players</h3>
            <ol>${top5.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
          </div>
          <div class="lb">
            <h3>Top ${escapeHtml(quiz.group_label || 'tables')}</h3>
            <ol>${tables.map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('')}</ol>
          </div>
        </div>
      ` : ''}
      ${isTrivia && (r.side_scores?.bride || r.side_scores?.groom) ? `
        <div class="vs enter-3">
          <div class="vs-side">
            <img class="vs-face ${(r.side_states?.bride === 'winner') ? 'winner-glow' : ''}" src="${faceUrl('bride', r.side_states?.bride || 'neutral')}" alt="">
            <div class="vs-name">${escapeHtml(quiz.bride_label || 'Bride')} · ${r.side_scores?.bride || 0}</div>
          </div>
          <div class="vs-bar"><div class="vs-bar-fill" style="width:${(r.side_scores?.bride || 0) / Math.max((r.side_scores?.bride || 0) + (r.side_scores?.groom || 0), 1) * 100}%;"></div></div>
          <div class="vs-side">
            <img class="vs-face ${(r.side_states?.groom === 'winner') ? 'winner-glow' : ''}" src="${faceUrl('groom', r.side_states?.groom || 'neutral')}" alt="">
            <div class="vs-name">${escapeHtml(quiz.groom_label || 'Groom')} · ${r.side_scores?.groom || 0}</div>
          </div>
        </div>
      ` : ''}
    `;
  }

  // ── Finished — Thank you screen ──────────────────────────
  function renderFinished() {
    root.className = 'stage lobby';
    const r = lastReveal || {};
    const top = (r.leaderboard || []).slice(0, 3).filter(p => p.score > 0);
    const tables = (r.table_leaderboard || []).slice(0, 3).filter(t => t.score > 0);
    const playerCount = state?.players?.length || 0;
    root.innerHTML = `
      <div class="lobby-hero" style="grid-column: 1 / -1; text-align: center;">
        ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width:100%; max-width:760px; max-height:48vh; object-fit:cover; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); margin: 0 auto;">` : ''}
        <h1 class="enter" style="font-family: 'Great Vibes', cursive; font-size: clamp(80px, 10vw, 180px); margin: 16px 0 4px; color: ${quiz.accent_color}; line-height: 1;">Thank you</h1>
        <p class="enter-2" style="font-family: 'Cormorant Infant', serif; font-size: clamp(28px, 3vw, 44px); color: var(--ink); margin: 0;">
          ${escapeHtml(quiz.bride_label || 'Bride')} <span style="color: var(--rose);">&amp;</span> ${escapeHtml(quiz.groom_label || 'Groom')}
        </p>
        <p class="enter-3" style="font-family: 'Inter'; font-size: 22px; color: var(--muted); margin: 16px 0 0;">
          ${playerCount} ${playerCount === 1 ? 'guest played' : 'guests played'} · ${state.total_questions} ${state.total_questions === 1 ? 'question' : 'questions'}
        </p>
        ${top.length ? `
          <div class="enter-3" style="margin-top: 36px; display: grid; grid-template-columns: ${tables.length ? '1fr 1fr' : '1fr'}; gap: 24px; max-width: 800px; margin-left: auto; margin-right: auto;">
            <div class="lb">
              <h3 style="text-align:left;">Top players</h3>
              <ol style="text-align:left;">${top.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
            </div>
            ${tables.length ? `
              <div class="lb">
                <h3 style="text-align:left;">Top ${escapeHtml(quiz.group_label || 'tables')}</h3>
                <ol style="text-align:left;">${tables.map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('')}</ol>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  start();
})();
