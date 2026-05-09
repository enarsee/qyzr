(function () {
  const token = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let socket = null;
  const FACE_STATES = ['winner','happy','neutral','sad','angry'];
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
    const joinBtn = document.getElementById('joinPageBtn');
    if (joinBtn) {
      joinBtn.href = `/join/${quiz.room_code}`;
      joinBtn.style.display = '';
    }
    if (!socket) connect();
    render();
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
            <div id="brandingPanel" style="margin-top: 16px;"></div>
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
    renderBrandingPanel();
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

  function renderBrandingPanel() {
    const panel = document.getElementById('brandingPanel');
    if (!panel) return;
    const facesByKey = {};
    for (const f of (quiz.faces || [])) facesByKey[`${f.side}:${f.state}`] = f.image_path;

    panel.innerHTML = `
      <h4 style="margin: 0 0 8px;">Hero image</h4>
      <div style="display:flex; gap: 12px; align-items: center; margin-bottom: 16px;">
        ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width: 120px; height: 80px; object-fit: cover; border-radius: 8px;">` : '<div style="width:120px;height:80px;background:var(--bg);border-radius:8px;"></div>'}
        <input type="file" id="heroFile" accept="image/*">
      </div>

      <h4 style="margin: 16px 0 8px;">Couple faces <span style="font-family:'Inter';font-size:12px;color:var(--muted);font-weight:400;">— optional</span></h4>
      <p style="color: var(--muted); font-size: 14px; margin: 0 0 12px;">Upload a photo for each mood, or leave them — the display will use cartoon defaults (shown below).</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        ${['bride','groom'].map(side => `
          <div>
            <strong>${escapeHtml(side === 'bride' ? quiz.bride_label : quiz.groom_label)}</strong>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
              ${FACE_STATES.map(st => {
                const custom = facesByKey[`${side}:${st}`];
                const src = custom || `/defaults/${side}-${st}.svg`;
                return `
                <div style="text-align: center;">
                  <div style="font-family:'Inter';font-size:12px;color:var(--muted);">${st}</div>
                  <img src="${src}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;background:${custom ? 'transparent' : 'var(--bg)'};${custom ? '' : 'opacity:0.85;'}">
                  ${!custom ? `<div style="font-family:'Inter';font-size:10px;color:var(--muted);">default</div>` : ''}
                  <input type="file" accept="image/*" data-side="${side}" data-state="${st}" style="font-size:11px; margin-top:4px;">
                </div>
              `}).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <p id="faceMsg" style="color: var(--success); margin-top: 12px; min-height: 18px; font-family: 'Inter';"></p>
    `;

    document.getElementById('heroFile').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append('image', f);
      const up = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!up.ok) { document.getElementById('faceMsg').textContent = 'Upload failed'; return; }
      const { path } = await up.json();
      await fetch(`/api/quiz?token=${token}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hero_image_path: path })
      });
      document.getElementById('faceMsg').textContent = 'Hero image saved';
      await loadQuiz();
    });

    panel.querySelectorAll('input[type="file"][data-side]').forEach(input => {
      input.addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        const side = e.target.dataset.side, state = e.target.dataset.state;
        const fd = new FormData(); fd.append('image', f);
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        if (!up.ok) { document.getElementById('faceMsg').textContent = 'Upload failed'; return; }
        const { path } = await up.json();
        const r = await fetch(`/api/quiz/${token}/face`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ side, state, image_path: path })
        });
        if (!r.ok) { document.getElementById('faceMsg').textContent = 'Save failed'; return; }
        document.getElementById('faceMsg').textContent = `Saved ${side} · ${state}`;
        await loadQuiz();
      });
    });
  }

  function facesComplete() {
    const haveByKey = new Set((quiz.faces || []).map(f => `${f.side}:${f.state}`));
    for (const side of ['bride','groom'])
      for (const st of FACE_STATES)
        if (!haveByKey.has(`${side}:${st}`)) return false;
    return true;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadQuiz();
})();
