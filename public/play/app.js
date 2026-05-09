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
        ${withCode ? `
          <label>Room code <input id="code" maxlength="6" autocomplete="off" autocapitalize="characters" style="text-transform: uppercase; font-family: 'Inter'; letter-spacing: .1em;"></label>
          <button class="btn" id="scanBtn" style="width:100%; margin-top: 4px; font-size: 14px;">Scan QR code instead</button>
          <video id="scanVideo" playsinline style="display:none; width:100%; border-radius: 12px; margin-top: 8px;"></video>
        ` : ''}
        <label>Your name <input id="name" maxlength="30" autocomplete="given-name"></label>
        <label>${escapeHtml(quiz?.group_label || 'Table')} <input id="grp" maxlength="10" inputmode="numeric"></label>
        <button class="btn btn-primary" id="joinBtn" style="width:100%; margin-top:12px;">Join</button>
        <p id="err" style="color: var(--error); margin: 8px 0 0;"></p>
      </div>
    `;
    document.getElementById('joinBtn').onclick = () => doJoin(withCode);
    if (withCode) {
      const scanBtn = document.getElementById('scanBtn');
      if (scanBtn) scanBtn.onclick = startQrScan;
    }
  }

  async function startQrScan() {
    const errEl = document.getElementById('err');
    const video = document.getElementById('scanVideo');
    if (!('BarcodeDetector' in window)) {
      errEl.textContent = 'In-app scan not supported. Open your phone camera and point at the QR.';
      return;
    }
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.style.display = 'block';
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (!video.srcObject) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const raw = codes[0].rawValue;
            // QR encodes a URL like https://qyzr.app/play/ABC234
            const m = raw.match(/\/play\/([A-Z0-9]{6})/i);
            if (m) {
              stream.getTracks().forEach(t => t.stop());
              video.srcObject = null; video.style.display = 'none';
              const codeInput = document.getElementById('code');
              if (codeInput) codeInput.value = m[1].toUpperCase();
              return;
            }
          }
        } catch {}
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      errEl.textContent = 'Camera permission denied. You can also open your phone camera app and scan the QR there.';
    }
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
    if (!r) return;
    const cur = state.current_question || {};
    const distMap = Object.fromEntries((r.distribution || []).map(d => [d.option_id, d.n]));
    const total = Object.values(distMap).reduce((a,b) => a+b, 0) || 1;
    let popularId = null, popularN = 0;
    for (const [id, n] of Object.entries(distMap)) {
      if (n > popularN) { popularN = n; popularId = id; }
    }
    const myOption = (cur.options || []).find(o => o.id === lastAnswerOptionId);
    const popOption = (cur.options || []).find(o => o.id === popularId);
    const myVotes = distMap[lastAnswerOptionId] || 0;
    const myPct = Math.round((myVotes / total) * 100);
    const popPct = Math.round((popularN / total) * 100);
    const isAlsoPopular = lastAnswerOptionId && lastAnswerOptionId === popularId;

    root.innerHTML = `
      <div style="text-align:center; padding-top: 24px;">
        <p class="font-ui" style="color: var(--muted); font-size: 14px; margin: 0;">You voted</p>
        <h2 style="margin: 8px 0 24px;">${myOption ? escapeHtml(myOption.text) : '—'}</h2>
        ${myOption ? `<p class="font-ui" style="color: var(--muted);">${myPct}% of guests agreed (${myVotes} of ${total})</p>` : ''}
        ${isAlsoPopular
          ? `<p class="font-ui" style="margin-top:24px;color:var(--gold);font-weight:600;">★ Most popular answer</p>`
          : popOption ? `<p class="font-ui" style="margin-top:24px;color:var(--muted);">Most popular: <strong style="color:var(--ink);">${escapeHtml(popOption.text)}</strong> (${popPct}%)</p>` : ''}
      </div>
    `;
  }

  function renderFinished() {
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 24px 0;">Thanks for voting!</h1>
      <p style="text-align:center;color:var(--muted);">The host has ended the poll.</p>
    `;
  }

  function renderError(msg) {
    root.innerHTML = `<p style="text-align:center; padding-top: 80px; color: var(--error);">${escapeHtml(msg)}</p>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  start();
})();
