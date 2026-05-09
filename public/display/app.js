(function () {
  const code = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let lastReveal = null;
  let answerCount = 0, answerTotal = 0;
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
    return f ? f.image_path : '';
  }

  function connect() {
    const s = WQ_connect({ role: 'display', room_code: code });
    s.on('state', (st) => { state = st; render(); });
    s.on('question:show', (_q) => { answerCount = 0; answerTotal = state?.players?.length || 0; lastReveal = null; render(); });
    s.on('answer:received', ({ count, total }) => { answerCount = count; answerTotal = total; renderAnswerCounter(); });
    s.on('question:reveal', (r) => { lastReveal = r; render(); });
    s.on('game:finished', (r) => { lastReveal = r; if (state) state.status = 'finished'; render(); });
  }

  function renderAnswerCounter() {
    const el = document.getElementById('answerCounter');
    if (el) el.textContent = `${answerCount} / ${answerTotal} answered`;
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
          ${cur.options.map((o, i) => `
            <div class="option-card" data-id="${o.id}">
              <span class="option-letter">${letters[i]}</span>
              <div class="option-text">${escapeHtml(o.text)}</div>
              <div class="vote-bar" style="height: 0%;"></div>
            </div>
          `).join('')}
        </div>
        <p id="answerCounter" class="font-ui tabular" style="text-align:center; color: var(--muted);">${answerCount} / ${answerTotal} answered</p>
      </div>
    `;
  }

  function renderReveal() {
    const cur = state.current_question;
    const r = lastReveal;
    if (!cur || !r) return renderLobby();
    const letters = ['A','B','C','D'];
    const totalVotes = r.distribution.reduce((a, b) => a + b.n, 0) || 1;
    const distMap = Object.fromEntries(r.distribution.map(d => [d.option_id, d.n]));
    const top5 = (r.leaderboard || []).slice(0, 5);
    const tables = (r.table_leaderboard || []).slice(0, 5);
    const ss = r.side_states || { bride: 'neutral', groom: 'neutral' };
    const sc = r.side_scores || { bride: 0, groom: 0 };
    const sideTotal = Math.max(sc.bride + sc.groom, 1);
    const bridePct = (sc.bride / sideTotal) * 100;
    root.innerHTML = `
      <div class="display-shell">
        <h1 class="question-text">${escapeHtml(cur.text)}</h1>
        <div class="options-grid">
          ${cur.options.map((o, i) => {
            const correct = o.id === r.correct_option_id;
            const pct = ((distMap[o.id] || 0) / totalVotes) * 100;
            return `
              <div class="option-card ${correct ? 'correct' : 'wrong'}">
                <span class="option-letter">${letters[i]}</span>
                <div class="option-text">${escapeHtml(o.text)}</div>
                <div class="vote-bar" style="height: ${pct}%"></div>
              </div>`;
          }).join('')}
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <div class="leaderboard">
            <h3>Top players</h3>
            <ol>${top5.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
          </div>
          <div class="leaderboard">
            <h3>Top ${escapeHtml(quiz.group_label || 'Tables')}</h3>
            <ol>${tables.map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('')}</ol>
          </div>
        </div>
        <div class="vs-panel">
          <div style="text-align:center;">
            <img class="vs-face ${ss.bride === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('bride', ss.bride)}" alt="">
            <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.bride_label)} · ${sc.bride}</div>
          </div>
          <div class="vs-bar"><div class="vs-bar-fill" style="width: ${bridePct}%;"></div></div>
          <div style="text-align:center;">
            <img class="vs-face ${ss.groom === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('groom', ss.groom)}" alt="">
            <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.groom_label)} · ${sc.groom}</div>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadPublic();
})();
