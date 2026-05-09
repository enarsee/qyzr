(function () {
  const token = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let socket = null;
  const root = document.getElementById('root');
  const quizName = document.getElementById('quizName');
  const roomCode = document.getElementById('roomCode');
  const primaryBtn = document.getElementById('primaryBtn');

  async function loadQuiz() {
    const r = await fetch(`/api/quiz?token=${encodeURIComponent(token)}`);
    if (!r.ok) { root.innerHTML = '<p style="text-align:center;color:var(--error);padding:80px;">Quiz not found.</p>'; return; }
    quiz = await r.json();
    quizName.textContent = quiz.name;
    roomCode.textContent = quiz.room_code;
    if (!socket) connect();
    else render();
  }

  function connect() {
    socket = WQ_connect({ role: 'host', creator_token: token });
    socket.on('state', (s) => { state = s; render(); });
    socket.on('player:joined', () => { /* state will follow */ });
    socket.on('player:left', () => { /* state will follow */ });
    socket.on('answer:received', ({ count, total }) => {
      const el = document.getElementById('answeredCounter');
      if (el) el.textContent = `${count} / ${total} answered`;
    });
    socket.on('error', (e) => alert(e.message || e.code));
  }

  function render() {
    if (!state || state.status === 'finished' || !state.game_id) {
      renderEdit();
    } else {
      renderControlDeck();
    }
    primaryBtn.onclick = onPrimary;
    primaryBtn.textContent = primaryButtonLabel();
  }

  function primaryButtonLabel() {
    if (!state || state.status === 'finished' || !state.game_id) return 'Start game';
    if (state.status === 'lobby') return 'Show first question';
    if (state.status === 'active') return 'Reveal answer';
    if (state.status === 'revealing') return 'Next question';
    return 'Start game';
  }

  function onPrimary() {
    if (!state || !state.game_id) { socket.emit('host:start'); return; }
    if (state.status === 'lobby') { socket.emit('host:next', { game_id: state.game_id }); return; }
    if (state.status === 'active') { socket.emit('host:reveal', { game_id: state.game_id }); return; }
    if (state.status === 'revealing') { socket.emit('host:next', { game_id: state.game_id }); return; }
  }

  function renderEdit() {
    root.innerHTML = `
      <div class="layout">
        <div>
          <details class="card" style="margin-bottom: 16px;" id="brandingDetails">
            <summary style="cursor:pointer; font-family:'Inter'; font-weight:600;">Branding &amp; couple faces</summary>
            <div id="brandingPanel" style="margin-top: 16px;">
              <p style="color: var(--muted); font-size: 14px;">Branding controls coming soon.</p>
            </div>
          </details>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="margin:0;">Questions</h2>
            <button class="btn btn-primary" id="addQ">${WQ_ICONS.plus} Add</button>
          </div>
          <div class="qlist" id="qlist"></div>
        </div>
        <div class="editor card">
          <h3 style="margin:0 0 16px;">Editor</h3>
          <p style="color: var(--muted);">Select a question on the left or add a new one.</p>
        </div>
      </div>
    `;
    renderQuestionList();
    document.getElementById('addQ').onclick = () => openEditor(null);
  }

  function renderQuestionList() {
    const list = document.getElementById('qlist');
    list.innerHTML = '';
    quiz.questions.forEach(q => {
      const div = document.createElement('div');
      div.className = 'qrow';
      div.draggable = true;
      div.dataset.id = q.id;
      div.innerHTML = `
        <strong style="font-family:'Inter';color:var(--muted);">${q.position}.</strong>
        <span style="flex:1;">${escapeHtml(q.text || '(untitled)')}</span>
        <span class="player-pill">${q.side_tag}</span>
      `;
      div.addEventListener('click', () => openEditor(q.id));
      addDragHandlers(div, list);
      list.appendChild(div);
    });
  }

  function openEditor(qid) {
    const editor = document.querySelector('.editor');
    const q = qid ? quiz.questions.find(x => x.id === qid) : null;
    const opts = q ? q.options : [{ text: '' }, { text: '' }];
    editor.innerHTML = `
      <h3 style="margin:0 0 16px;">${q ? 'Edit question' : 'New question'}</h3>
      <label>Question text<textarea id="qtext" maxlength="300" rows="3">${q ? escapeHtml(q.text) : ''}</textarea></label>
      <label>Side tag
        <select id="qside">
          <option value="bride" ${q?.side_tag==='bride'?'selected':''}>${escapeHtml(quiz.bride_label)}</option>
          <option value="groom" ${q?.side_tag==='groom'?'selected':''}>${escapeHtml(quiz.groom_label)}</option>
          <option value="neutral" ${q?.side_tag==='neutral'?'selected':''}>Neutral</option>
        </select>
      </label>
      <label>Image (optional)<input type="file" id="qimg" accept="image/*"></label>
      <div style="margin-top:8px;">${q?.image_path ? `<img src="${q.image_path}" style="max-width:100%;border-radius:8px;">` : ''}</div>
      <h4 style="margin:16px 0 8px;">Options (one correct)</h4>
      <div id="opts"></div>
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button class="btn btn-primary" id="saveQ">${q ? 'Save' : 'Add'}</button>
        ${q ? `<button class="btn" id="delQ" style="color:var(--error);">${WQ_ICONS.trash} Delete</button>` : ''}
      </div>
    `;
    const optsDiv = document.getElementById('opts');
    let optsState = opts.map(o => ({ text: o.text || '', is_correct: !!o.is_correct }));
    function renderOpts(arr) {
      optsDiv.innerHTML = arr.map((o, i) => `
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input type="text" value="${escapeHtml(o.text || '')}" data-i="${i}" maxlength="120" placeholder="Option ${i+1}">
          <label style="display:flex; align-items:center; gap:4px; font-family:'Inter'; font-size:14px;">
            <input type="radio" name="correct" data-i="${i}" ${o.is_correct?'checked':''}> correct
          </label>
        </div>
      `).join('') + (arr.length < 4 ? '<button class="btn" id="addOpt">+ Add option</button>' : '');
      const addBtn = document.getElementById('addOpt');
      if (addBtn) addBtn.onclick = () => { arr.push({ text: '' }); renderOpts(arr); };
    }
    renderOpts(optsState);
    document.getElementById('saveQ').onclick = async () => {
      const inputs = optsDiv.querySelectorAll('input[type="text"]');
      const radios = optsDiv.querySelectorAll('input[type="radio"]');
      optsState = Array.from(inputs).map((el, i) => ({
        text: el.value, is_correct: !!radios[i] && radios[i].checked
      })).filter(o => o.text.trim());
      if (optsState.filter(o => o.is_correct).length !== 1) {
        alert('Mark exactly one option correct.'); return;
      }
      let image_path = q?.image_path || null;
      const file = document.getElementById('qimg').files[0];
      if (file) {
        const fd = new FormData(); fd.append('image', file);
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        if (up.ok) image_path = (await up.json()).path;
      }
      const body = {
        text: document.getElementById('qtext').value,
        side_tag: document.getElementById('qside').value,
        image_path,
        options: optsState
      };
      const url = q ? `/api/question/${q.id}?token=${token}` : `/api/quiz/${token}/question`;
      const method = q ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Save failed'); return; }
      await loadQuiz();
    };
    if (q) {
      document.getElementById('delQ').onclick = async () => {
        if (!confirm('Delete this question?')) return;
        await fetch(`/api/question/${q.id}?token=${token}`, { method: 'DELETE' });
        await loadQuiz();
      };
    }
  }

  // Drag-to-reorder
  let dragSrc = null;
  function addDragHandlers(el, listEl) {
    el.addEventListener('dragstart', () => { dragSrc = el; el.style.opacity = '0.5'; });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === el) return;
      const items = Array.from(listEl.children);
      const fromIdx = items.indexOf(dragSrc);
      const toIdx = items.indexOf(el);
      if (fromIdx < toIdx) listEl.insertBefore(dragSrc, el.nextSibling); else listEl.insertBefore(dragSrc, el);
      const ids = Array.from(listEl.children).map(c => c.dataset.id);
      await fetch(`/api/quiz/${token}/reorder`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      await loadQuiz();
    });
  }

  function renderControlDeck() {
    const cur = state.current_question;
    const playersList = state.players.map(p => `<span class="player-pill">${escapeHtml(p.name)} · ${escapeHtml(p.group_value)}</span>`).join('');
    root.innerHTML = `
      <div class="control-deck">
        <p style="font-family:'Inter'; color:var(--muted);">Status: <strong>${state.status}</strong> · Q ${cur?.position || 0} / ${state.total_questions}</p>
        ${cur ? `
          <div class="card" style="text-align:left; max-width:680px; margin:24px auto;">
            <h2 style="margin:0 0 16px;">${escapeHtml(cur.text)}</h2>
            ${cur.image_url ? `<img src="${cur.image_url}" style="max-width:100%; border-radius:12px; margin-bottom:12px;">` : ''}
            <ol style="padding-left: 20px;">
              ${cur.options.map(o => `<li><strong>${escapeHtml(o.text)}</strong>${o.is_correct ? ' ✓' : ''}</li>`).join('')}
            </ol>
            <p id="answeredCounter" class="tabular" style="font-family:'Inter'; color: var(--muted);">0 / ${state.players.length} answered</p>
          </div>
        ` : `<p>Lobby — ${state.players.length} players joined</p>`}
        <div class="card" style="max-width:680px; margin: 24px auto; text-align:left;">
          <strong>Players</strong>
          <div style="margin-top:8px;">${playersList || '<em>None yet</em>'}</div>
        </div>
        ${state.status === 'lobby' || state.status === 'revealing' ? `<button class="btn" id="finishBtn" style="margin-top:24px;color:var(--error);">Finish game</button>` : ''}
      </div>
    `;
    const fb = document.getElementById('finishBtn');
    if (fb) fb.onclick = () => { if (confirm('Finish game?')) socket.emit('host:finish', { game_id: state.game_id }); };
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadQuiz();
})();
