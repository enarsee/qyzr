const express = require('express');
const quizzes = require('../repos/quizzes');
const games = require('../repos/games');
const players = require('../repos/players');
const questions = require('../repos/questions');
const answers = require('../repos/answers');
const faces = require('../repos/faces');
const config = require('../config');
const { getDb } = require('../db');

function faceUrl(quizFaces, side, state) {
  const f = quizFaces.find(x => x.side === side && x.state === state);
  return f ? f.image_path : `/defaults/${side}-${state}.svg`;
}

const router = express.Router();

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Render a timestamp as a <time> element so the browser can format it in the
// VIEWER's local timezone via the inline script at the bottom of the page.
// (Server-rendered toLocaleString() uses the SERVER's timezone, which is UTC
// on the VPS — wrong for guests in any other locale.)
function fmtDate(ts) {
  if (!ts) return '';
  const iso = new Date(ts).toISOString();
  // Server-side fallback text in case JS is disabled — uses ISO so it's
  // unambiguous (UTC). The inline script will replace it with local-time.
  const fallback = new Date(ts).toUTCString().replace(' GMT', ' UTC');
  return `<time datetime="${iso}" data-fmt="dt">${fallback}</time>`;
}

function buildExport({ quiz, game, qs, players: allPlayers }) {
  const db = getDb();

  // Per-question vote distribution
  const distRows = db.prepare(`
    SELECT a.question_id, a.option_id, COUNT(*) AS n
    FROM answers a WHERE a.game_id = ? GROUP BY a.question_id, a.option_id
  `).all(game.id);
  const distByQ = {};
  for (const r of distRows) (distByQ[r.question_id] ||= {})[r.option_id] = r.n;

  // Total answers per question
  const totalsByQ = {};
  for (const qid of Object.keys(distByQ)) {
    totalsByQ[qid] = Object.values(distByQ[qid]).reduce((a, b) => a + b, 0);
  }

  // Aggregate stats
  const playerCount = allPlayers.length;
  const trivialQuestions = qs.filter(q => q.is_trivia);
  const hasTrivia = trivialQuestions.length > 0 && Object.values(distByQ).length > 0;

  const leaderboard = answers.leaderboard(game.id);
  const tableLb = answers.tableLeaderboard(game.id);
  const sideScores = answers.sideScores(game.id);
  const sideTotal = sideScores.bride + sideScores.groom;
  const winningSide = sideScores.bride > sideScores.groom
    ? quiz.bride_label
    : sideScores.groom > sideScores.bride ? quiz.groom_label : null;
  const brideWins = sideScores.bride > sideScores.groom;
  const groomWins = sideScores.groom > sideScores.bride;

  // Faces for the VS panel — winner gets 'winner' state, loser 'sad', tie both 'neutral'.
  const quizFaces = faces.byQuiz(quiz.id);
  const brideMood = brideWins ? 'winner' : groomWins ? 'sad' : 'neutral';
  const groomMood = groomWins ? 'winner' : brideWins ? 'sad' : 'neutral';
  const brideFace = faceUrl(quizFaces, 'bride', brideMood);
  const groomFace = faceUrl(quizFaces, 'groom', groomMood);
  const crownSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 19h20l-2-7-5 3-3-7-3 7-5-3-2 7z"/></svg>';

  // Build the page
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(quiz.name)} — Results</title>
<link rel="stylesheet" href="/shared/styles.css">
<style>
  body { font-size: 16px; }
  .export-shell { max-width: 880px; margin: 0 auto; padding: 32px 24px 80px; }
  .export-toolbar { position: sticky; top: 0; background: var(--bg); padding: 12px 0 16px; margin-bottom: 16px; display: flex; gap: 8px; align-items: center; justify-content: flex-end; z-index: 10; border-bottom: 1px solid #E3D9CC; }
  .export-toolbar .meta { margin-right: auto; color: var(--muted); font-family: 'Inter'; font-size: 13px; }
  .header { text-align: center; padding: 24px 0 16px; border-bottom: 1px solid #E3D9CC; margin-bottom: 24px; }
  .header h1 { font-family: 'Great Vibes', cursive; font-size: 64px; color: ${quiz.accent_color}; margin: 0 0 4px; line-height: 1; }
  .header .sub { color: var(--muted); font-family: 'Inter'; font-size: 14px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .stat { background: var(--surface); padding: 16px; border-radius: 12px; box-shadow: var(--shadow-sm); text-align: center; }
  .stat .num { font-family: 'Inter'; font-weight: 700; font-size: 32px; color: var(--ink); display: block; }
  .stat .lbl { font-family: 'Inter'; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  .q-card { background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 20px 24px; margin-bottom: 20px; page-break-inside: avoid; }
  .q-num { font-family: 'Inter'; font-weight: 600; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .q-text { font-size: 22px; font-weight: 600; margin: 4px 0 16px; }
  .q-img { display: block; max-width: 480px; max-height: 380px; width: auto; height: auto; border-radius: 10px; object-fit: contain; margin: 0 auto 14px; background: var(--bg); }
  .q-tag { display: inline-block; background: var(--bg); border-radius: 999px; padding: 2px 10px; font-family: 'Inter'; font-size: 11px; color: var(--muted); margin-left: 8px; vertical-align: middle; }
  .q-tag.trivia { background: #FFF8E1; color: var(--gold); }
  .opt-row { display: grid; grid-template-columns: auto 1fr auto auto; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px dashed #E3D9CC; }
  .opt-row:last-child { border-bottom: none; }
  .opt-letter { font-family: 'Inter'; font-weight: 700; color: var(--muted); font-size: 14px; min-width: 16px; }
  .opt-text { font-family: 'Cormorant Infant', serif; }
  .opt-row.correct .opt-text { font-weight: 700; }
  .opt-row.correct::before { content: '✓'; color: var(--gold); position: absolute; }
  .opt-row.popular .opt-text { font-weight: 600; }
  .opt-bar { width: 140px; height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; }
  .opt-bar > div { height: 100%; background: var(--rose); }
  .opt-row.correct .opt-bar > div { background: var(--gold); }
  .opt-count { font-family: 'Inter'; font-weight: 600; font-size: 14px; color: var(--ink); min-width: 80px; text-align: right; }
  .lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; page-break-inside: avoid; }
  @media (max-width: 700px) { .lb-grid { grid-template-columns: 1fr; } }
  .lb { background: var(--surface); padding: 18px 22px; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }
  .lb h3 { font-family: 'Inter'; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; }
  .lb ol { margin: 0; padding-left: 20px; font-family: 'Cormorant Infant', serif; font-size: 18px; }
  .lb li { padding: 3px 0; }
  .vs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 24px; align-items: center; padding: 24px 20px; background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); margin-top: 24px; page-break-inside: avoid; }
  .vs-side { text-align: center; font-family: 'Inter'; }
  .vs-face-wrap { position: relative; display: inline-block; }
  .vs-face { width: clamp(96px, 12vw, 140px); height: clamp(96px, 12vw, 140px); border-radius: 50%; object-fit: cover; object-position: 50% 25%; background: var(--surface); border: 3px solid transparent; }
  .vs-face.winner-face { border-color: var(--gold); box-shadow: 0 0 0 4px rgba(184,137,58,0.18); }
  .vs-crown { position: absolute; top: -6px; right: -6px; width: 28px; height: 28px; background: var(--gold); color: #fff; border-radius: 50%; display: grid; place-items: center; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
  .vs-crown svg { width: 16px; height: 16px; }
  .vs-side .score { font-size: 32px; font-weight: 700; color: var(--ink); display: block; margin: 12px 0 2px; font-variant-numeric: tabular-nums; line-height: 1; }
  .vs-side .name { font-size: 16px; font-weight: 600; color: var(--muted); }
  .vs.winning-bride .bride .name, .vs.winning-bride .bride .score { color: var(--ink); }
  .vs.winning-groom .groom .name, .vs.winning-groom .groom .score { color: var(--ink); }
  .vs-vs { font-family: 'Great Vibes', cursive; font-size: 36px; color: var(--rose); line-height: 1; }
  @media print {
    .vs-face.winner-face { border-color: #444; box-shadow: none; }
    .vs-crown { background: #444; box-shadow: none; }
  }
  .footer { text-align: center; color: var(--muted); font-family: 'Inter'; font-size: 12px; margin-top: 48px; }

  /* Print: clean black-on-white, hide toolbar */
  @media print {
    body { background: #fff; font-size: 12pt; }
    .export-toolbar { display: none; }
    .stat, .q-card, .lb, .vs { box-shadow: none; border: 1px solid #ccc; }
    .header h1 { color: #000 !important; }
    .opt-bar { border: 1px solid #999; }
    .opt-row.correct .opt-bar > div { background: #888; }
    .opt-bar > div { background: #444; }
    .footer { display: none; }
    @page { margin: 16mm 14mm; }
  }
</style>
</head>
<body>
<div class="export-shell">
  <div class="export-toolbar">
    <div class="meta">${quiz.name} · ${game.finished_at ? fmtDate(game.finished_at) : 'in progress'}</div>
    <button class="btn btn-primary" onclick="window.print()" id="printBtn">Save as PDF / Print</button>
    <a class="btn" href="/host/${quiz.creator_token}">Back to host</a>
  </div>

  <div class="header">
    <h1>${escapeHtml(quiz.name)}</h1>
    <div class="sub">
      Game played ${game.started_at ? fmtDate(game.started_at) : ''}${game.finished_at ? ' — ' + fmtDate(game.finished_at) : ''}
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat"><span class="num">${playerCount}</span><div class="lbl">Players</div></div>
    <div class="stat"><span class="num">${qs.length}</span><div class="lbl">Questions</div></div>
    <div class="stat"><span class="num">${Object.values(totalsByQ).reduce((a,b)=>a+b, 0)}</span><div class="lbl">Total votes</div></div>
    ${hasTrivia ? `
      <div class="stat"><span class="num">${trivialQuestions.length}</span><div class="lbl">Trivia Qs</div></div>
    ` : ''}
  </div>

  ${qs.map((q, i) => {
    const dist = distByQ[q.id] || {};
    const total = totalsByQ[q.id] || 0;
    const correctOpt = q.is_trivia ? q.options.find(o => o.is_correct) : null;
    let popularId = null, popularN = -1;
    for (const o of q.options) {
      const v = dist[o.id] || 0;
      if (v > popularN) { popularN = v; popularId = o.id; }
    }
    return `
    <div class="q-card">
      <div class="q-num">Question ${i + 1} of ${qs.length}
        <span class="q-tag${q.is_trivia ? ' trivia' : ''}">${q.is_trivia ? `trivia · ${q.side_tag}` : 'poll'}</span>
      </div>
      <div class="q-text">${escapeHtml(q.text)}</div>
      ${q.image_path ? `<img class="q-img" src="${q.image_path}" alt="">` : ''}
      <div class="opts">
        ${q.options.map((o, oi) => {
          const v = dist[o.id] || 0;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          const isCorrect = q.is_trivia && correctOpt && o.id === correctOpt.id;
          const isPopular = !q.is_trivia && popularId === o.id && popularN > 0;
          const cls = isCorrect ? 'correct' : isPopular ? 'popular' : '';
          return `
            <div class="opt-row ${cls}" style="position:relative;">
              <span class="opt-letter">${'ABCD'[oi]}.</span>
              <span class="opt-text">${escapeHtml(o.text)}</span>
              <div class="opt-bar"><div style="width: ${pct}%;"></div></div>
              <span class="opt-count">${pct}% · ${v}</span>
            </div>`;
        }).join('')}
      </div>
      ${q.is_trivia && correctOpt ? `
        <p style="font-family:'Inter';font-size:13px;color:var(--muted);margin:12px 0 0;">
          ${dist[correctOpt.id] || 0} of ${total} got it right (${total > 0 ? Math.round(((dist[correctOpt.id] || 0) / total) * 100) : 0}%).
        </p>
      ` : ''}
    </div>`;
  }).join('')}

  ${hasTrivia && leaderboard.some(p => p.score > 0) ? `
    <div class="lb-grid">
      <div class="lb">
        <h3>Top players</h3>
        <ol>${leaderboard.slice(0, 10).filter(p => p.score > 0).map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}${p.group_value ? ` <span style="color:var(--muted);">(${escapeHtml(quiz.group_label || 'group')} ${escapeHtml(p.group_value)})</span>` : ''}</li>`).join('')}</ol>
      </div>
      <div class="lb">
        <h3>Top ${escapeHtml(quiz.group_label || 'tables')}</h3>
        <ol>${tableLb.slice(0, 10).map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('') || '<li style="color:var(--muted);font-style:italic;">No data</li>'}</ol>
      </div>
    </div>
  ` : ''}

  ${hasTrivia && (sideScores.bride > 0 || sideScores.groom > 0) ? `
    <div class="vs ${brideWins ? 'winning-bride' : ''} ${groomWins ? 'winning-groom' : ''}">
      <div class="vs-side bride">
        <div class="vs-face-wrap">
          <img class="vs-face ${brideWins ? 'winner-face' : ''}" src="${brideFace}" alt="">
          ${brideWins ? `<span class="vs-crown" aria-label="Winner">${crownSvg}</span>` : ''}
        </div>
        <span class="score">${sideScores.bride}</span>
        <div class="name">${escapeHtml(quiz.bride_label)}</div>
      </div>
      <div class="vs-vs">vs</div>
      <div class="vs-side groom">
        <div class="vs-face-wrap">
          <img class="vs-face ${groomWins ? 'winner-face' : ''}" src="${groomFace}" alt="">
          ${groomWins ? `<span class="vs-crown" aria-label="Winner">${crownSvg}</span>` : ''}
        </div>
        <span class="score">${sideScores.groom}</span>
        <div class="name">${escapeHtml(quiz.groom_label)}</div>
      </div>
    </div>
    ${winningSide ? `<p style="text-align:center;font-family:'Cormorant Infant',serif;font-size:20px;margin-top:14px;color:var(--ink);"><strong>${escapeHtml(winningSide)}</strong> takes the night.</p>` : sideTotal > 0 ? `<p style="text-align:center;font-family:'Cormorant Infant',serif;font-size:18px;margin-top:14px;color:var(--muted);">A perfect tie.</p>` : ''}
  ` : ''}

  <div class="footer">
    Generated by qyzr · ${fmtDate(Date.now())}
  </div>
</div>
<script>
  // Re-format <time data-fmt="dt"> elements in the viewer's local timezone.
  (function () {
    var fmt;
    try {
      fmt = new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'short'
      });
    } catch (e) { return; }
    document.querySelectorAll('time[data-fmt="dt"]').forEach(function (el) {
      var d = new Date(el.getAttribute('datetime'));
      if (isNaN(+d)) return;
      el.textContent = fmt.format(d);
    });
  })();
</script>
</body>
</html>`;
}

router.get('/export/:token/:gameId?', (req, res) => {
  const quiz = quizzes.byCreatorToken(req.params.token);
  if (!quiz) return res.status(404).send('Quiz not found.');

  let game;
  if (req.params.gameId) {
    game = games.byId(req.params.gameId);
    if (!game || game.quiz_id !== quiz.id) return res.status(404).send('Game not found.');
  } else {
    game = games.lastFinishedForQuiz(quiz.id) || games.activeForQuiz(quiz.id);
    if (!game) return res.status(404).send('No game to export yet — start one first.');
  }

  const qs = questions.listByQuiz(quiz.id);
  const allPlayers = players.listByGame(game.id);
  // Inject creator_token into quiz so the back-link works without re-fetching
  const quizWithToken = { ...quiz, creator_token: req.params.token };

  res.set('content-type', 'text/html; charset=utf-8').send(buildExport({
    quiz: quizWithToken, game, qs, players: allPlayers
  }));
});

module.exports = router;
