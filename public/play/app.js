(function () {
  const codeFromPath = location.pathname.startsWith('/play/') ? location.pathname.slice('/play/'.length) : '';
  let quiz = null;
  let state = null;
  let socket = null;
  let myPlayerId = null;
  let myPlayerToken = localStorage.getItem('wq_player_token') || null;
  let lastAnswerOptionId = null;
  let lastReveal = null;
  const root = document.getElementById('root');

  function setBanner(msg) {
    let b = document.getElementById('banner');
    if (!b) { b = document.createElement('div'); b.id = 'banner'; b.className = 'banner'; document.body.prepend(b); }
    b.textContent = msg;
    b.style.display = msg ? 'block' : 'none';
  }

  async function start() {
    if (!codeFromPath) { renderJoin({ withCode: true }); return; }
    const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(codeFromPath)}`);
    if (!r.ok) { renderError('Room not found'); return; }
    quiz = await r.json();
    renderJoin({ withCode: false });
  }

  function renderJoin({ withCode }) {
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 24px 0;">${escapeHtml(quiz?.name || 'Wedding Quiz')}</h1>
      <div class="card">
        ${withCode ? `<label>Room code <input id="code" maxlength="6" autocomplete="off" autocapitalize="characters" style="text-transform: uppercase; font-family: 'Inter'; letter-spacing: .1em;"></label>` : ''}
        <label>Your name <input id="name" maxlength="30" autocomplete="given-name"></label>
        <label>${escapeHtml(quiz?.group_label || 'Table')} <input id="grp" maxlength="10" inputmode="numeric"></label>
        <button class="btn btn-primary" id="joinBtn" style="width:100%; margin-top:12px;">Join</button>
        <p id="err" style="color: var(--error); margin: 8px 0 0;"></p>
      </div>
    `;
    document.getElementById('joinBtn').onclick = () => doJoin(withCode);
  }

  async function doJoin(withCode) {
    const code = withCode ? document.getElementById('code').value.toUpperCase() : codeFromPath;
    const name = document.getElementById('name').value.trim();
    const grp = document.getElementById('grp').value.trim();
    if (!name || !grp || !code) { document.getElementById('err').textContent = 'Fill in all fields'; return; }
    if (!quiz) {
      const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(code)}`);
      if (!r.ok) { document.getElementById('err').textContent = 'Room not found'; return; }
      quiz = await r.json();
    }
    if (socket) { try { socket.close(); } catch {} socket = null; }
    socket = WQ_connect({ role: 'player', room_code: code, ...(myPlayerToken ? { player_token: myPlayerToken } : {}) });
    socket.on('connect', () => setBanner(''));
    socket.on('disconnect', () => setBanner('Reconnecting…'));
    socket.on('connect_error', (e) => {
      const errEl = document.getElementById('err');
      if (!errEl) return;
      if (String(e.message).includes('no_active_game')) errEl.textContent = 'Game has not started yet.';
      else if (String(e.message).includes('kicked')) errEl.textContent = 'You were removed by the host.';
      else errEl.textContent = e.message || 'Connection error';
    });
    socket.on('joined', (j) => {
      myPlayerId = j.player_id;
      myPlayerToken = j.player_token;
      localStorage.setItem('wq_player_token', myPlayerToken);
    });
    socket.on('error', (e) => {
      const errEl = document.getElementById('err');
      if (!errEl) return;
      if (e.code === 'name_taken') errEl.textContent = 'That name is taken — pick another.';
      else errEl.textContent = e.code || 'Error';
    });
    socket.on('state', (st) => { state = st; render(); });
    socket.on('question:show', () => { lastAnswerOptionId = null; lastReveal = null; render(); });
    socket.on('question:reveal', (r) => { lastReveal = r; render(); });
    socket.on('game:finished', (r) => { lastReveal = r; if (state) state.status = 'finished'; render(); });
    socket.on('player:kicked', () => { renderError('You were removed by the host.'); });

    setTimeout(() => {
      if (!myPlayerId) socket.emit('player:join', { name, group_value: grp });
    }, 100);
  }

  function render() {
    if (!state) return;
    if (state.status === 'lobby') return renderLobby();
    if (state.status === 'active') return renderQuestion();
    if (state.status === 'revealing') return renderRevealMine();
    if (state.status === 'finished') return renderFinished();
  }

  function renderLobby() {
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 8px 0;">${escapeHtml(quiz.name)}</h1>
      ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width:100%; border-radius: 16px; max-height: 240px; object-fit:cover;">` : ''}
      <p style="text-align:center; color: var(--muted);">Welcome — waiting for the host…</p>
      <p style="text-align:center; font-family: 'Inter'; font-size: 14px; color: var(--muted);">${state.players.length} guests in the lobby</p>
    `;
  }

  function renderQuestion() {
    const cur = state.current_question;
    if (!cur) return;
    root.innerHTML = `
      <p class="font-ui" style="color: var(--muted); font-size: 14px;">Question ${cur.position} of ${state.total_questions}</p>
      <h2 style="margin: 8px 0 16px;">${escapeHtml(cur.text)}</h2>
      ${cur.image_url ? `<img src="${cur.image_url}" style="width:100%; border-radius: 12px;">` : ''}
      <div id="opts" style="display:grid; gap: 12px; margin-top: 12px;">
        ${cur.options.map((o, i) => `
          <button class="btn opt-btn" data-id="${o.id}" data-i="${i}">
            <strong>${'ABCD'[i]}.</strong> ${escapeHtml(o.text)}
          </button>
        `).join('')}
      </div>
      <p id="lockMsg" style="text-align:center; color: var(--muted); font-family:'Inter'; margin-top: 16px; display:none;">Answer locked — wait for reveal.</p>
    `;
    document.querySelectorAll('.opt-btn').forEach(btn => btn.addEventListener('click', () => commit(btn)));
  }

  function commit(btn) {
    const id = btn.dataset.id;
    if (lastAnswerOptionId) return;
    lastAnswerOptionId = id;
    btn.classList.add('locked-mine');
    btn.style.transform = 'scale(0.97)';
    setTimeout(() => btn.style.transform = '', 150);
    document.querySelectorAll('.opt-btn').forEach(b => { if (b !== btn) b.classList.add('locked-other'); b.disabled = true; });
    document.getElementById('lockMsg').style.display = 'block';
    if (navigator.vibrate) navigator.vibrate(20);
    socket.emit('player:answer', { game_id: state.game_id, question_id: state.current_question.question_id, option_id: id });
  }

  function renderRevealMine() {
    const r = lastReveal;
    const correct = r && lastAnswerOptionId === r.correct_option_id;
    const me = r ? r.leaderboard.find(p => p.id === myPlayerId) : null;
    const rank = me ? r.leaderboard.findIndex(p => p.id === myPlayerId) + 1 : null;
    const sc = r ? r.side_scores : { bride: 0, groom: 0 };
    root.innerHTML = `
      <div style="text-align:center; padding-top: 32px;">
        <div style="color: ${correct ? 'var(--success)' : 'var(--error)'};">${correct ? WQ_ICONS.checkCircle : WQ_ICONS.xCircle}</div>
        <h2 style="margin: 16px 0;">${correct ? 'Correct! +1' : 'Not quite'}</h2>
        ${me ? `<p class="font-ui">You're #${rank} with ${me.score} ${me.score === 1 ? 'point' : 'points'}</p>` : ''}
        <p class="font-ui" style="color: var(--muted);">${escapeHtml(quiz.bride_label)} ${sc.bride} · ${escapeHtml(quiz.groom_label)} ${sc.groom}</p>
      </div>
    `;
  }

  function renderFinished() {
    const r = lastReveal || {};
    const top = (r.leaderboard || []).slice(0, 3);
    const sc = r.side_scores || { bride: 0, groom: 0 };
    const winner = sc.bride > sc.groom ? quiz.bride_label : sc.groom > sc.bride ? quiz.groom_label : 'Tie';
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 24px 0;">Thanks for playing!</h1>
      <div class="card">
        <h3>Top 3</h3>
        <ol>${top.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
      </div>
      <div class="card">
        <strong>Winner:</strong> ${escapeHtml(winner)} (${sc.bride}–${sc.groom})
      </div>
    `;
  }

  function renderError(msg) {
    root.innerHTML = `<p style="text-align:center; padding-top: 80px; color: var(--error);">${escapeHtml(msg)}</p>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  start();
})();
