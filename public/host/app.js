(function () {
  const token = location.pathname.split('/').pop().split('?')[0];

  // First-visit banner: if redirected from /create with ?fresh=1, prompt the host to save this URL.
  function maybeShowSaveBanner() {
    const params = new URLSearchParams(location.search);
    const fresh = params.get('fresh') === '1';
    const seenKey = `wq_seen_save_url_${token}`;
    if (!fresh || localStorage.getItem(seenKey)) return;

    const banner = document.getElementById('saveLinkBanner');
    if (!banner) return;
    banner.style.display = 'block';

    document.getElementById('copyHostUrlBtn').onclick = async () => {
      const url = location.origin + location.pathname; // strip ?fresh=1 from copy
      try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('copyHostUrlBtn');
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = original; }, 2000);
      } catch {
        // Fallback: select-all the URL via prompt
        prompt('Copy this URL:', url);
      }
    };
    document.getElementById('dismissBannerBtn').onclick = () => {
      banner.style.display = 'none';
      localStorage.setItem(seenKey, '1');
      // Clean the URL bar so reload doesn't re-show
      const cleanUrl = location.origin + location.pathname;
      history.replaceState(null, '', cleanUrl);
    };
  }
  maybeShowSaveBanner();

  // Share dropdown
  function setupShareMenu() {
    const btn = document.getElementById('shareMenuBtn');
    const menu = document.getElementById('shareMenu');
    if (!btn || !menu || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    const close = () => { menu.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); };
    const open = () => { menu.style.display = 'block'; btn.setAttribute('aria-expanded', 'true'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display === 'block' ? close() : open();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    const copyItem = document.getElementById('copyHostUrlMenuItem');
    if (copyItem) copyItem.onclick = async () => {
      const url = location.origin + '/host/' + token;
      try {
        await navigator.clipboard.writeText(url);
        copyItem.textContent = 'Copied!';
        setTimeout(() => { copyItem.textContent = 'Copy host link'; close(); }, 1200);
      } catch { prompt('Copy this URL:', url); }
    };
  }
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
    if (joinBtn) joinBtn.href = `/join/${quiz.room_code}`;
    const presenterBtn = document.getElementById('presenterBtn');
    if (presenterBtn) presenterBtn.href = `/present/${token}`;
    setupShareMenu();
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
    if (!state || state.status === 'finished' || !state.game_id) return 'Start';
    if (state.status === 'lobby') return 'Show first question';
    const cur = state.current_question;
    if (state.status === 'active') return cur && cur.is_trivia ? 'Reveal answer' : 'Reveal results';
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
    const isEmpty = !quiz.questions || quiz.questions.length === 0;
    root.innerHTML = `
      <div class="layout">
        <div>
          <details class="card" style="margin-bottom: 16px;" id="brandingDetails" ${isEmpty && !quiz.hero_image_path ? 'open' : ''}>
            <summary style="cursor:pointer; font-family:'Inter'; font-weight:600;">Branding (hero image)</summary>
            <div id="brandingPanel" style="margin-top: 16px;"></div>
          </details>
          ${isEmpty ? `
            <div style="background: linear-gradient(135deg, rgba(200,88,122,0.08), rgba(184,137,58,0.08)); border: 1px dashed var(--rose); border-radius: var(--radius-md); padding: 20px 24px; margin-bottom: 16px; display: flex; align-items: center; gap: 16px;">
              <div style="font-size: 32px; line-height: 1;">${WQ_ICONS.chevron}</div>
              <div>
                <strong style="font-family:'Inter'; font-size: 15px;">Add your first question</strong>
                <p style="margin: 4px 0 0; color: var(--muted); font-size: 14px;">Click <span style="font-family:'Inter'; font-weight: 600;">+ Add</span> to start. Each question has 2–4 options. Toggle "trivia" if you want a correct answer + side; otherwise it's a poll.</p>
              </div>
            </div>
          ` : ''}
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="margin:0;">Questions</h2>
            <button class="btn btn-primary" id="addQ">${WQ_ICONS.plus} Add</button>
          </div>
          <div class="qlist" id="qlist"></div>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #E3D9CC; display:flex; gap: 8px; flex-wrap: wrap;">
            <a class="btn" id="exportLastBtn" target="_blank" rel="noopener" style="background: transparent; box-shadow: none; color: var(--ink);" href="/export/${token}">📄 Export last game</a>
            <button class="btn" id="resetGameBtn" style="background: transparent; box-shadow: none; color: var(--ink);">${WQ_ICONS.chevron} Reset game data</button>
            <button class="btn" id="deleteQuizBtn" style="color: var(--error); background: transparent; box-shadow: none;">${WQ_ICONS.trash} Delete this quiz permanently</button>
          </div>
        </div>
        <div class="editor card">
          ${isEmpty
            ? `<h3 style="margin:0 0 12px;">Editor</h3>
               <p style="color: var(--muted); margin: 0 0 16px;">Add a question on the left and it'll open here for editing.</p>
               <button class="btn btn-primary" id="addQFromEditor">${WQ_ICONS.plus} Add your first question</button>`
            : `<h3 style="margin:0 0 16px;">Editor</h3>
               <p style="color: var(--muted);">Select a question on the left or add a new one.</p>`}
        </div>
      </div>
    `;
    renderQuestionList();
    renderBrandingPanel();
    document.getElementById('addQ').onclick = () => openEditor(null);
    const addFromEditor = document.getElementById('addQFromEditor');
    if (addFromEditor) addFromEditor.onclick = () => openEditor(null);
    document.getElementById('resetGameBtn').onclick = async () => {
      if (!confirm('Reset all game data? This deletes past games, players, and answers — your questions and branding stay. You can then edit questions freely and start a fresh game.')) return;
      const r = await fetch(`/api/quiz/${token}/reset`, { method: 'POST' });
      if (!r.ok) { alert('Reset failed.'); return; }
      await loadQuiz();
      toast('Game data reset');
    };
    document.getElementById('deleteQuizBtn').onclick = async () => {
      const confirmText = `Delete "${quiz.name}" forever? This wipes all questions, players and answers.`;
      if (!confirm(confirmText)) return;
      const second = prompt('Type the quiz name to confirm:');
      if (second !== quiz.name) { alert('Name did not match. Aborted.'); return; }
      const r = await fetch(`/api/quiz?token=${token}`, { method: 'DELETE' });
      if (!r.ok) { alert('Delete failed.'); return; }
      // Clean local creator-url cache too
      const list = JSON.parse(localStorage.getItem('wq_creator_urls') || '[]')
        .filter(x => !x.host_url.endsWith('/host/' + token));
      localStorage.setItem('wq_creator_urls', JSON.stringify(list));
      alert('Quiz deleted.');
      location.href = '/';
    };
  }

  function renderQuestionList() {
    const list = document.getElementById('qlist');
    list.innerHTML = '';
    quiz.questions.forEach(q => {
      const div = document.createElement('div');
      div.className = 'qrow';
      div.draggable = true;
      div.dataset.id = q.id;
      const pillText = q.is_trivia ? `trivia · ${q.side_tag}` : 'poll';
      div.innerHTML = `
        <span class="qrow-grip" aria-hidden="true" style="cursor:grab; color:var(--muted); font-family:'Inter'; font-weight:700; user-select:none; padding: 0 4px;">⋮⋮</span>
        <strong style="font-family:'Inter';color:var(--muted);">${q.position}.</strong>
        <span style="flex:1;">${escapeHtml(q.text || '(untitled)')}</span>
        <span class="player-pill">${pillText}</span>
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
      <label style="display:flex; align-items:center; gap:8px; padding: 8px 0;">
        <input type="checkbox" id="qtrivia" ${q?.is_trivia ? 'checked' : ''} style="width:auto;min-height:0;">
        <span>This is a trivia question (mark a correct answer + side)</span>
      </label>
      <div id="triviaFields" style="display:${q?.is_trivia ? 'block' : 'none'};">
        <label>Side tag
          <select id="qside">
            <option value="bride" ${q?.side_tag==='bride'?'selected':''}>${escapeHtml(quiz.bride_label || 'Bride')}</option>
            <option value="groom" ${q?.side_tag==='groom'?'selected':''}>${escapeHtml(quiz.groom_label || 'Groom')}</option>
            <option value="neutral" ${(!q || q.side_tag==='neutral')?'selected':''}>Neutral (counts toward neither side)</option>
          </select>
        </label>
      </div>
      <label>Image (optional)<input type="file" id="qimg" accept="image/*"></label>
      <div style="margin-top:8px;">${q?.image_path ? `<img src="${q.image_path}" style="max-width:100%;border-radius:8px;">` : ''}</div>
      <h4 style="margin:16px 0 8px;">Options <span id="optsHint" style="font-family:'Inter';font-size:12px;color:var(--muted);font-weight:400;">${q?.is_trivia ? '— mark the correct one' : ''}</span></h4>
      <div id="opts"></div>
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button class="btn btn-primary" id="saveQ">${q ? 'Save' : 'Add'}</button>
        ${q ? `<button class="btn" id="delQ" style="color:var(--error);">${WQ_ICONS.trash} Delete</button>` : ''}
      </div>
    `;
    const optsDiv = document.getElementById('opts');
    let optsState = opts.map(o => ({ text: o.text || '', is_correct: !!o.is_correct }));
    let isTrivia = !!q?.is_trivia;

    function renderOpts(arr) {
      optsDiv.innerHTML = arr.map((o, i) => `
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
          <input type="text" value="${escapeHtml(o.text || '')}" data-i="${i}" maxlength="120" placeholder="Option ${i+1}" style="flex:1;">
          ${isTrivia ? `<label style="display:flex;align-items:center;gap:4px;font-family:'Inter';font-size:14px;white-space:nowrap;">
            <input type="radio" name="correct" data-i="${i}" ${o.is_correct?'checked':''} style="width:auto;min-height:0;"> correct
          </label>` : ''}
        </div>
      `).join('') + (arr.length < 4 ? '<button class="btn" id="addOpt">+ Add option</button>' : '');
      const addBtn = document.getElementById('addOpt');
      if (addBtn) addBtn.onclick = () => { arr.push({ text: '' }); renderOpts(arr); };
    }
    renderOpts(optsState);

    document.getElementById('qtrivia').onchange = (e) => {
      isTrivia = e.target.checked;
      document.getElementById('triviaFields').style.display = isTrivia ? 'block' : 'none';
      document.getElementById('optsHint').textContent = isTrivia ? '— mark the correct one' : '';
      // Re-snapshot current option text values so we don't lose typing on toggle
      const inputs = optsDiv.querySelectorAll('input[type="text"]');
      optsState = Array.from(inputs).map((el, i) => ({
        text: el.value,
        is_correct: optsState[i]?.is_correct
      }));
      renderOpts(optsState);
    };

    document.getElementById('saveQ').onclick = async () => {
      const inputs = optsDiv.querySelectorAll('input[type="text"]');
      const radios = optsDiv.querySelectorAll('input[type="radio"]');
      optsState = Array.from(inputs).map((el, i) => ({
        text: el.value,
        is_correct: isTrivia ? (!!radios[i] && radios[i].checked) : false
      })).filter(o => o.text.trim());
      if (optsState.length < 2) { alert('At least 2 options required.'); return; }
      if (isTrivia && optsState.filter(o => o.is_correct).length !== 1) {
        alert('Mark exactly one option correct.'); return;
      }
      let image_path = q?.image_path || null;
      const file = document.getElementById('qimg').files[0];
      if (file) {
        const fd = new FormData(); fd.append('image', file);
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        if (up.ok) {
          image_path = (await up.json()).path;
        } else {
          // Surface the failure instead of silently saving without the image.
          const j = await up.json().catch(() => ({}));
          const msg = j.error === 'unsupported_format'
            ? 'That image format isn\'t supported. Try a JPG or PNG (HEIC photos from iPhones often need to be converted).'
            : j.error === 'image_invalid'
              ? 'The file doesn\'t look like a valid image.'
              : 'Image upload failed (' + (j.error || up.status) + '). Try again or pick a different photo.';
          alert(msg);
          return; // bail — don't save the question with no image
        }
      }
      const body = {
        text: document.getElementById('qtext').value,
        is_trivia: isTrivia,
        image_path,
        options: optsState
      };
      if (isTrivia) body.side_tag = document.getElementById('qside').value;
      const url = q ? `/api/question/${q.id}?token=${token}` : `/api/quiz/${token}/question`;
      const method = q ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Save failed'); return; }
      await loadQuiz();
      toast(q ? 'Saved' : 'Question added');
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
      toast('Reordered');
    });
  }

  function renderControlDeck() {
    const cur = state.current_question;
    const PLAYER_CAP = 20;
    const recent = state.players.slice(-PLAYER_CAP);
    const overflow = Math.max(0, state.players.length - recent.length);
    const playersList = recent.map(p => `<span class="player-pill">${escapeHtml(p.name)} · ${escapeHtml(p.group_value)}</span>`).join('')
      + (overflow ? `<span class="player-pill" style="background:transparent;color:var(--muted);">and ${overflow} more</span>` : '');
    root.innerHTML = `
      <div class="control-deck">
        <p style="font-family:'Inter'; color:var(--muted);">Status: <strong>${state.status}</strong> · Q ${cur?.position || 0} / ${state.total_questions}</p>
        ${cur ? `
          <div class="card" style="text-align:left; max-width:680px; margin:24px auto;">
            <h2 style="margin:0 0 16px;">${escapeHtml(cur.text)}</h2>
            ${cur.image_url ? `<img src="${cur.image_url}" style="max-width:100%; border-radius:12px; margin-bottom:12px;">` : ''}
            <ol style="padding-left: 20px;">
              ${cur.options.map(o => `<li><strong>${escapeHtml(o.text)}</strong></li>`).join('')}
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
      <p style="color: var(--muted); font-size: 14px; margin: 0 0 12px;">Shown on the lobby and joining pages.</p>
      <div style="display:flex; gap: 12px; align-items: center; margin-bottom: 24px;">
        ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width: 120px; height: 80px; object-fit: cover; border-radius: 8px;">` : '<div style="width:120px;height:80px;background:var(--bg);border-radius:8px;"></div>'}
        <input type="file" id="heroFile" accept="image/*">
      </div>

      <h4 style="margin: 16px 0 8px;">Couple faces <span style="font-family:'Inter';font-size:12px;color:var(--muted);font-weight:400;">— optional</span></h4>
      <p style="color: var(--muted); font-size: 14px; margin: 0 0 12px;">
        Used in the VS panel after trivia questions. Upload one photo per mood per side, or leave them — cartoon defaults are shown otherwise.
      </p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        ${['bride','groom'].map(side => `
          <div>
            <strong>${escapeHtml(side === 'bride' ? (quiz.bride_label || 'Bride') : (quiz.groom_label || 'Groom'))}</strong>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
              ${FACE_STATES.map(st => {
                const custom = facesByKey[`${side}:${st}`];
                const src = custom || `/defaults/${side}-${st}.svg`;
                return `
                  <div style="text-align: center;">
                    <div style="font-family:'Inter';font-size:12px;color:var(--muted);">${st}</div>
                    <img src="${src}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;object-position:50% 25%;background:${custom ? 'var(--surface)' : 'var(--bg)'};${custom ? '' : 'opacity:0.85;'}">
                    ${!custom ? `<div style="font-family:'Inter';font-size:10px;color:var(--muted);">default</div>` : ''}
                    <input type="file" accept="image/*" data-side="${side}" data-state="${st}" style="font-size:11px; margin-top:4px;">
                  </div>
                `;
              }).join('')}
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
      document.getElementById('faceMsg').textContent = '';
      await loadQuiz();
      toast('Hero image saved');
    });

    // Wire each face upload input
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
        document.getElementById('faceMsg').textContent = '';
        await loadQuiz();
        toast(`${side} · ${state} saved`);
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

  function toast(msg) {
    let el = document.getElementById('wq-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wq-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed; bottom:24px; left:50%; transform:translateX(-50%) translateY(20px); background:var(--ink); color:#fff; padding:12px 20px; border-radius:10px; font-family:Inter,system-ui,sans-serif; font-size:14px; font-weight:500; box-shadow:0 8px 30px rgba(42,27,18,0.18); opacity:0; transition:opacity 200ms ease-out, transform 200ms ease-out; z-index:1000; pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2000);
  }

  loadQuiz();
})();
