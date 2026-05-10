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

// If option text matches the configured bride/groom label, return that side.
function optionSide(text, quiz) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (t === String(quiz.bride_label || 'Bride').trim().toLowerCase()) return 'bride';
  if (t === String(quiz.groom_label || 'Groom').trim().toLowerCase()) return 'groom';
  return null;
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

  // ── Statistics queries ──────────────────────────────────
  // Players ranked by total guesses (whether right or wrong)
  const guessLb = db.prepare(`
    SELECT p.id, p.name, p.group_value, COUNT(a.id) AS guesses
    FROM players p
    LEFT JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.id
    ORDER BY guesses DESC, p.joined_at ASC
  `).all(game.id);
  const topGuessPlayers = guessLb.filter(p => p.guesses > 0).slice(0, 5);
  const noGuessPlayers = guessLb.filter(p => p.guesses === 0);

  // Tables ranked by total guesses across their members
  const guessTables = db.prepare(`
    SELECT p.group_value, COUNT(a.id) AS guesses, COUNT(DISTINCT p.id) AS players
    FROM players p
    LEFT JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.group_value
    ORDER BY guesses DESC, p.group_value ASC
  `).all(game.id).filter(t => t.guesses > 0).slice(0, 5);

  // Cross-reference: which players always picked bride/groom when offered.
  // Pull every answer joined with its option text + question id.
  const allChoices = db.prepare(`
    SELECT p.id AS player_id, p.name, p.group_value,
           a.question_id, LOWER(TRIM(o.text)) AS chosen
    FROM answers a
    JOIN players p ON a.player_id = p.id
    JOIN options o ON a.option_id = o.id
    WHERE a.game_id = ? AND p.kicked = 0
  `).all(game.id);
  const brideKey = String(quiz.bride_label || 'Bride').trim().toLowerCase();
  const groomKey = String(quiz.groom_label || 'Groom').trim().toLowerCase();
  // Per question: does it have a bride-named / groom-named option?
  const qHasBride = {}, qHasGroom = {};
  for (const q of qs) {
    for (const o of q.options) {
      const t = String(o.text || '').trim().toLowerCase();
      if (t === brideKey) qHasBride[q.id] = true;
      if (t === groomKey) qHasGroom[q.id] = true;
    }
  }
  // Aggregate per player. For "loyalty" we count, in questions that offered
  // bride/groom as an option, how often the player picked that side.
  const perPlayer = {};
  for (const r of allChoices) {
    const k = r.player_id;
    const p = perPlayer[k] ||= {
      name: r.name, group: r.group_value,
      brideOpps: 0, bridePicks: 0, groomOpps: 0, groomPicks: 0
    };
    if (qHasBride[r.question_id]) {
      p.brideOpps++;
      if (r.chosen === brideKey) p.bridePicks++;
    }
    if (qHasGroom[r.question_id]) {
      p.groomOpps++;
      if (r.chosen === groomKey) p.groomPicks++;
    }
  }
  // Loyalists: ≥60% picks of that side, min 2 opportunities. Ranked by ratio
  // (then by raw pick count, then alphabetical), top 8.
  const LOYALTY_THRESHOLD = 0.60;
  const MIN_OPPS = 2;
  const teamBride = Object.values(perPlayer)
    .map(p => ({ ...p, ratio: p.brideOpps > 0 ? p.bridePicks / p.brideOpps : 0 }))
    .filter(p => p.brideOpps >= MIN_OPPS && p.ratio >= LOYALTY_THRESHOLD)
    .sort((a, b) => b.ratio - a.ratio || b.bridePicks - a.bridePicks || a.name.localeCompare(b.name))
    .slice(0, 8);
  const teamGroom = Object.values(perPlayer)
    .map(p => ({ ...p, ratio: p.groomOpps > 0 ? p.groomPicks / p.groomOpps : 0 }))
    .filter(p => p.groomOpps >= MIN_OPPS && p.ratio >= LOYALTY_THRESHOLD)
    .sort((a, b) => b.ratio - a.ratio || b.groomPicks - a.groomPicks || a.name.localeCompare(b.name))
    .slice(0, 8);
  // ── Fastest answerers ──────────────────────────────────
  // For each question, the first to answer becomes t=0; everyone else's
  // delta is measured from there. Average across questions they answered
  // (min 3 to qualify). Lowest avg delta = fastest.
  const speedRows = db.prepare(`
    SELECT a.question_id, a.player_id, p.name, p.group_value, a.answered_at
    FROM answers a
    JOIN players p ON a.player_id = p.id
    WHERE a.game_id = ? AND p.kicked = 0
    ORDER BY a.question_id, a.answered_at ASC
  `).all(game.id);
  const firstByQ = {};
  for (const r of speedRows) {
    if (firstByQ[r.question_id] == null) firstByQ[r.question_id] = r.answered_at;
  }
  const speedAgg = {};
  for (const r of speedRows) {
    const delta = r.answered_at - firstByQ[r.question_id];
    const s = speedAgg[r.player_id] ||= { name: r.name, group: r.group_value, total: 0, count: 0 };
    s.total += delta;
    s.count += 1;
  }
  const MIN_ANSWERS_FOR_SPEED = 3;
  const fastestPlayers = Object.values(speedAgg)
    .filter(s => s.count >= MIN_ANSWERS_FOR_SPEED)
    .map(s => ({ ...s, avgMs: s.total / s.count }))
    .sort((a, b) => a.avgMs - b.avgMs)
    .slice(0, 5);

  const hasStatsSection = topGuessPlayers.length > 0 || noGuessPlayers.length > 0
    || teamBride.length > 0 || teamGroom.length > 0 || guessTables.length > 0
    || fastestPlayers.length > 0;

  // Faces for the VS panel — winner gets 'winner' state, loser 'sad', tie both 'neutral'.
  const quizFaces = faces.byQuiz(quiz.id);
  const brideMood = brideWins ? 'winner' : groomWins ? 'sad' : 'neutral';
  const groomMood = groomWins ? 'winner' : brideWins ? 'sad' : 'neutral';
  const brideFace = faceUrl(quizFaces, 'bride', brideMood);
  const groomFace = faceUrl(quizFaces, 'groom', groomMood);
  const crownSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 19h20l-2-7-5 3-3-7-3 7-5-3-2 7z"/></svg>';
  // Lucide icons (inline so PDF embeds cleanly)
  const zapSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const checkSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  const starSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.45 7.55h7.9l-6.4 4.65 2.45 7.55L12 17.1l-6.4 4.65 2.45-7.55-6.4-4.65h7.9z"/></svg>';
  const ornamentSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.5 3 2 4.5 5 5-3 .5-4.5 2-5 5-.5-3-2-4.5-5-5 3-.5 4.5-2 5-5z"/></svg>';

  // Build the page
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(quiz.name)} — Results</title>
<link rel="stylesheet" href="/shared/styles.css">
<style>
  :root { --gap-section: 48px; }
  body { font-size: 16px; font-variant-numeric: tabular-nums; }
  .export-shell { max-width: 880px; margin: 0 auto; padding: 0 24px 80px; }
  .export-toolbar { position: sticky; top: 0; background: var(--bg); padding: 12px 0 16px; margin-bottom: 16px; display: flex; gap: 8px; align-items: center; justify-content: flex-end; z-index: 10; border-bottom: 1px solid #E3D9CC; }
  .export-toolbar .meta { margin-right: auto; color: var(--muted); font-family: 'Inter'; font-size: 13px; }
  .export-toolbar .btn { transition: transform 150ms ease-out, box-shadow 150ms ease-out, background 150ms ease-out; }
  .export-toolbar .btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .export-toolbar .btn:active { transform: translateY(0); }

  /* Hero band */
  .hero-band { position: relative; margin: 0 -24px var(--gap-section); border-radius: 0 0 var(--radius-lg) var(--radius-lg); overflow: hidden; min-height: 280px; display: grid; place-items: center; padding: 36px 24px; isolation: isolate; }
  .hero-band.has-photo { background: var(--surface); }
  .hero-band .bg { position: absolute; inset: 0; z-index: -1; }
  .hero-band .bg img { width: 100%; height: 100%; object-fit: cover; object-position: center 30%; }
  .hero-band .bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.55) 60%, rgba(251,247,242,0.92) 100%); }
  .hero-band.no-photo { background: linear-gradient(180deg, rgba(200,88,122,0.06), rgba(184,137,58,0.04)); border-bottom: 1px solid #E3D9CC; }
  .hero-band h1 { font-family: 'Great Vibes', cursive; font-size: clamp(72px, 9vw, 120px); color: ${quiz.accent_color}; margin: 0 0 4px; line-height: 1; text-align: center; text-shadow: 0 2px 12px rgba(255,255,255,0.6); }
  .hero-band .sub { color: var(--ink); font-family: 'Inter'; font-size: 15px; opacity: 0.78; text-align: center; }

  /* Reusable script section title */
  .section-title { display: flex; align-items: center; justify-content: center; gap: 16px; margin: var(--gap-section) 0 24px; font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 13px; color: var(--rose); text-transform: uppercase; letter-spacing: 0.18em; }
  .section-title::before, .section-title::after { content: ''; flex: 1; max-width: 80px; height: 1px; background: linear-gradient(to right, transparent, #C8A8B7, transparent); }

  /* Ornament between major sections (decorative, not section title) */
  .ornament { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 36px 0; color: var(--rose); }
  .ornament::before, .ornament::after { content: ''; flex: 1; max-width: 120px; height: 1px; background: linear-gradient(to right, transparent, #E0C4D0 50%, transparent); }
  .ornament svg { width: 14px; height: 14px; opacity: 0.7; }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: var(--gap-section); }
  .stat { background: var(--surface); padding: 16px; border-radius: 12px; box-shadow: var(--shadow-sm); text-align: center; }
  .stat .num { font-family: 'Inter'; font-weight: 700; font-size: 32px; color: var(--ink); display: block; font-variant-numeric: tabular-nums; }
  .stat .lbl { font-family: 'Inter'; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }

  .q-card { background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); padding: 22px 26px; margin-bottom: 24px; page-break-inside: avoid; }
  .q-num { font-family: 'Inter'; font-weight: 600; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
  .q-text { font-size: 22px; font-weight: 600; margin: 4px 0 8px; line-height: 1.3; }
  .q-result { font-family: 'Inter'; font-size: 14px; color: var(--muted); margin: 0 0 14px; }
  .q-result strong { color: var(--ink); font-weight: 600; }
  .q-result .res-icon { display: inline-block; width: 14px; height: 14px; vertical-align: -2px; margin-right: 4px; color: var(--gold); }
  .q-img { display: block; max-width: 480px; max-height: 380px; width: auto; height: auto; border-radius: 10px; object-fit: contain; margin: 0 auto 14px; background: var(--bg); cursor: zoom-in; transition: transform 200ms ease, box-shadow 200ms ease; }
  .q-img:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
  .q-img:focus-visible { outline: 2px solid var(--rose); outline-offset: 3px; }

  /* Lightbox */
  .lightbox { position: fixed; inset: 0; z-index: 9999; display: none; align-items: center; justify-content: center; padding: 32px; }
  .lightbox.open { display: flex; }
  .lightbox .backdrop { position: absolute; inset: 0; background: rgba(20, 14, 18, 0.55); backdrop-filter: blur(14px) saturate(120%); -webkit-backdrop-filter: blur(14px) saturate(120%); animation: lb-fade 180ms ease-out; }
  .lightbox .frame { position: relative; max-width: min(94vw, 1200px); max-height: 88vh; display: flex; flex-direction: column; align-items: center; gap: 14px; animation: lb-pop 220ms cubic-bezier(0.2, 0.9, 0.3, 1.2); }
  .lightbox img { max-width: 100%; max-height: 80vh; width: auto; height: auto; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.45); background: var(--bg); object-fit: contain; }
  .lightbox .actions { display: flex; gap: 10px; align-items: center; }
  .lightbox .lb-btn { font-family: 'Inter', system-ui, sans-serif; font-size: 13px; font-weight: 600; color: var(--ink); background: rgba(255,255,255,0.96); border: 1px solid rgba(0,0,0,0.08); border-radius: 999px; padding: 10px 18px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; transition: transform 150ms ease, box-shadow 150ms ease, background 150ms ease; min-height: 44px; }
  .lightbox .lb-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,0.18); background: #fff; }
  .lightbox .lb-btn:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
  .lightbox .lb-btn.primary { background: var(--rose); color: #fff; border-color: transparent; }
  .lightbox .lb-btn.primary:hover { background: #B14A6B; }
  .lightbox .lb-btn svg { width: 16px; height: 16px; }
  .lightbox .lb-close { position: absolute; top: -14px; right: -14px; width: 40px; height: 40px; border-radius: 50%; background: #fff; border: 1px solid rgba(0,0,0,0.08); cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(0,0,0,0.18); padding: 0; min-height: 40px; }
  .lightbox .lb-close:hover { transform: scale(1.05); }
  .lightbox .lb-close:focus-visible { outline: 2px solid var(--rose); outline-offset: 2px; }
  .lightbox .lb-close svg { width: 18px; height: 18px; color: var(--ink); }
  @keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lb-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) {
    .lightbox .backdrop, .lightbox .frame { animation: none; }
    .q-img { transition: none; }
  }
  .q-tag { display: inline-block; background: var(--bg); border-radius: 999px; padding: 2px 10px; font-family: 'Inter'; font-size: 11px; color: var(--muted); margin-left: 8px; vertical-align: middle; }
  .q-tag.trivia { background: #FFF8E1; color: var(--gold); }

  .opt-row { display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(227,217,204,0.6); }
  .opt-row:last-child { border-bottom: none; }
  .q-card.has-faces .opt-row { grid-template-columns: auto 1fr auto auto auto; }
  .q-card:not(.has-faces) .opt-row { grid-template-columns: auto 1fr auto auto; }
  .opt-letter { font-family: 'Inter'; font-weight: 700; color: var(--muted); font-size: 14px; min-width: 16px; }
  .opt-text { font-family: 'Cormorant Infant', serif; }
  .opt-row.correct .opt-text { font-weight: 700; }
  .opt-row.correct::before { content: '✓'; color: var(--gold); position: absolute; }
  .opt-row.popular .opt-text { font-weight: 600; }
  .opt-bar { width: 140px; height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; }
  .opt-bar > div { height: 100%; background: var(--rose); opacity: 0.7; }
  .opt-row.popular .opt-bar > div { opacity: 0.9; }
  .opt-row.correct .opt-bar > div { background: var(--gold); opacity: 0.85; }
  .opt-count { font-family: 'Inter'; font-weight: 600; font-size: 14px; color: var(--ink); min-width: 80px; text-align: right; font-variant-numeric: tabular-nums; }
  .opt-face-mini { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; object-position: 50% 25%; background: var(--surface); border: 2px solid transparent; }
  .opt-face-mini.win { border-color: var(--gold); box-shadow: 0 0 0 3px rgba(184,137,58,0.18); }
  @media print { .opt-face-mini.win { border-color: #444; } }
  .lb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 24px; page-break-inside: avoid; }
  @media (max-width: 700px) { .lb-grid { grid-template-columns: 1fr; } }
  .lb { background: var(--surface); padding: 18px 22px; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); }
  .lb h3 { font-family: 'Inter'; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px; }
  .lb ol { margin: 0; padding-left: 20px; font-family: 'Cormorant Infant', serif; font-size: 18px; }
  .lb li { padding: 3px 0; }

  .stat-card { background: var(--surface); padding: 18px 22px; border-radius: var(--radius-md); box-shadow: var(--shadow-sm); page-break-inside: avoid; }
  .stat-card h3 { font-family: 'Inter'; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
  .stat-card h3 .icon { display: inline-flex; align-items: center; }
  .stat-card h3 .icon svg { width: 16px; height: 16px; }
  .stat-card .blurb { font-family: 'Cormorant Infant', serif; font-size: 14px; color: var(--muted); margin: 0 0 10px; font-style: italic; }
  .stat-card ol, .stat-card ul { margin: 0; padding-left: 20px; font-family: 'Cormorant Infant', serif; font-size: 17px; }
  .stat-card li { padding: 2px 0; }
  .stat-card .pill { display: inline-block; background: var(--bg); border-radius: 999px; padding: 1px 8px; font-family: 'Inter'; font-size: 11px; color: var(--muted); margin-left: 6px; vertical-align: middle; font-variant-numeric: tabular-nums; }
  .stat-card .pill.gold { background: var(--gold); color: #fff; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 10px; }
  .stat-mini-face { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; object-position: 50% 25%; background: var(--surface); vertical-align: middle; }
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
    body { background: #fff; font-size: 11.5pt; }
    .export-shell { padding-top: 0; padding-bottom: 0; }
    .export-toolbar { display: none; }
    .stat, .q-card, .lb, .vs, .stat-card { box-shadow: none; border: 1px solid #ccc; }
    /* Keep accent color on title — rose passes AA against ivory */
    .hero-band .bg::after { background: linear-gradient(180deg, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.70) 70%, rgba(255,255,255,0.95) 100%); }
    .hero-band { min-height: 200px; padding: 24px 16px; border-radius: 0; margin: 0 0 32px; border-bottom: 1px solid #999; }
    .opt-bar { border: 1px solid #999; }
    .opt-row.correct .opt-bar > div { background: #888; opacity: 1; }
    .opt-bar > div { background: #444; opacity: 1; }
    /* New section: page-break */
    .stats-section { page-break-before: always; }
    /* Footer: only on last page via @page (no full hide) */
    .footer { display: block; text-align: center; color: #888; font-size: 9pt; }
    @page {
      size: A4; margin: 16mm 14mm;
      @bottom-right { content: counter(page) " / " counter(pages); font-family: 'Inter', sans-serif; font-size: 9pt; color: #888; }
      @bottom-left { content: "qyzr"; font-family: 'Inter', sans-serif; font-size: 9pt; color: #888; }
    }
    /* Visual polish in B&W */
    .ornament::before, .ornament::after, .section-title::before, .section-title::after { background: linear-gradient(to right, transparent, #999, transparent); }
    /* Lightbox should never appear in print */
    .lightbox { display: none !important; }
    .q-img { cursor: default; }
  }
</style>
</head>
<body>
<div class="export-shell">
  <div class="export-toolbar">
    <div class="meta">${quiz.name} · ${game.finished_at ? fmtDate(game.finished_at) : 'in progress'}</div>
    <button class="btn btn-primary" onclick="window.print()" id="printBtn">Save as PDF / Print</button>
  </div>

  <div class="hero-band ${quiz.hero_image_path ? 'has-photo' : 'no-photo'}">
    ${quiz.hero_image_path ? `<div class="bg"><img src="${quiz.hero_image_path}" alt=""></div>` : ''}
    <div>
      <h1>${escapeHtml(quiz.name)}</h1>
      <div class="sub">
        ${game.started_at ? fmtDate(game.started_at) : ''}${game.finished_at ? ' — ' + fmtDate(game.finished_at) : ''}
      </div>
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

  ${qs.length > 0 ? `<div class="ornament">${ornamentSvg}</div>` : ''}

  ${qs.map((q, i) => {
    const dist = distByQ[q.id] || {};
    const total = totalsByQ[q.id] || 0;
    const correctOpt = q.is_trivia ? q.options.find(o => o.is_correct) : null;
    let popularId = null, popularN = -1;
    for (const o of q.options) {
      const v = dist[o.id] || 0;
      if (v > popularN) { popularN = v; popularId = o.id; }
    }
    const popularOpt = q.options.find(o => o.id === popularId);
    // Does this question have any bride/groom-named options? (drives face column visibility)
    const hasFaces = q.options.some(o => optionSide(o.text, quiz) !== null);
    // Result line content
    let resultLine = '';
    if (total === 0) {
      resultLine = `<p class="q-result"><em style="color:var(--muted);">No votes recorded.</em></p>`;
    } else if (q.is_trivia && correctOpt) {
      const correctVotes = dist[correctOpt.id] || 0;
      const correctPct = Math.round((correctVotes / total) * 100);
      resultLine = `<p class="q-result"><span class="res-icon">${checkSvg}</span>Correct: <strong>${escapeHtml(correctOpt.text)}</strong> — ${correctVotes} of ${total} got it right (${correctPct}%).</p>`;
    } else if (popularOpt && popularN > 0) {
      const popPct = Math.round((popularN / total) * 100);
      resultLine = `<p class="q-result"><span class="res-icon">${starSvg}</span>Most popular: <strong>${escapeHtml(popularOpt.text)}</strong> — ${popularN} of ${total} (${popPct}%).</p>`;
    }
    return `
    <div class="q-card${hasFaces ? ' has-faces' : ''}">
      <div class="q-num">Question ${i + 1} of ${qs.length}
        <span class="q-tag${q.is_trivia ? ' trivia' : ''}">${q.is_trivia ? `trivia · ${q.side_tag}` : 'poll'}</span>
      </div>
      <div class="q-text">${escapeHtml(q.text)}</div>
      ${resultLine}
      ${q.image_path ? `<img class="q-img" src="${q.image_path}" alt="Question ${i + 1} image" tabindex="0" role="button" aria-label="View question ${i + 1} image full size" data-qnum="${i + 1}">` : ''}
      <div class="opts">
        ${q.options.map((o, oi) => {
          const v = dist[o.id] || 0;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          const isCorrect = q.is_trivia && correctOpt && o.id === correctOpt.id;
          const isPopular = !q.is_trivia && popularId === o.id && popularN > 0;
          const cls = isCorrect ? 'correct' : isPopular ? 'popular' : '';
          const side = optionSide(o.text, quiz);
          // Only emit a face cell when this question actually has bride/groom rows.
          let faceCell = '';
          if (hasFaces) {
            if (side && total > 0) {
              const isLeader = popularId === o.id && popularN > 0;
              const mood = isLeader ? 'winner' : 'sad';
              const winCls = isLeader ? ' win' : '';
              faceCell = `<img class="opt-face-mini${winCls}" src="${faceUrl(quizFaces, side, mood)}" alt="">`;
            } else {
              // Empty cell so the face column stays aligned within this card
              faceCell = '<span></span>';
            }
          }
          return `
            <div class="opt-row ${cls}" style="position:relative;">
              <span class="opt-letter">${'ABCD'[oi]}.</span>
              <span class="opt-text">${escapeHtml(o.text)}</span>
              <div class="opt-bar"><div style="width: ${pct}%;"></div></div>
              <span class="opt-count">${pct}% · ${v}</span>
              ${faceCell}
            </div>`;
        }).join('')}
      </div>
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

  ${hasStatsSection ? `
    <div class="stats-section">
    <div class="section-title">Statistics · A look behind the votes</div>
    <div class="lb-grid">
      ${topGuessPlayers.length > 0 ? `
        <div class="stat-card">
          <h3>Most active players</h3>
          <p class="blurb">By number of votes cast.</p>
          <ol>${topGuessPlayers.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.guesses} ${p.guesses === 1 ? 'vote' : 'votes'}${p.group_value ? ` <span class="pill">${escapeHtml(quiz.group_label || 'Table')} ${escapeHtml(p.group_value)}</span>` : ''}</li>`).join('')}</ol>
        </div>
      ` : ''}
      ${fastestPlayers.length > 0 ? `
        <div class="stat-card">
          <h3><span class="icon" style="color:var(--gold);">${zapSvg}</span> Trigger fingers</h3>
          <p class="blurb">Fastest answerers — average lag behind the first responder per question (min 3 answers).</p>
          <ol>${fastestPlayers.map((p, i) => {
            const ms = p.avgMs;
            // Rank 1 IS the first-responder reference (delta=0); show a FASTEST badge
            // instead of the meaningless '+0 ms avg'.
            const lblHtml = (i === 0 && ms < 50)
              ? `<span class="pill gold">Fastest</span>`
              : `<span class="pill">${ms < 1000 ? `+${Math.round(ms)} ms` : `+${(ms / 1000).toFixed(2)} s`} avg</span>`;
            return `<li><strong>${escapeHtml(p.name)}</strong> · ${lblHtml} <span class="pill">${p.count} ans</span>${p.group ? ` <span class="pill">${escapeHtml(quiz.group_label || 'Table')} ${escapeHtml(p.group)}</span>` : ''}</li>`;
          }).join('')}</ol>
        </div>
      ` : ''}
      ${guessTables.length > 0 ? `
        <div class="stat-card">
          <h3>Most active ${escapeHtml((quiz.group_label || 'tables').toLowerCase())}</h3>
          <p class="blurb">Total votes across the ${escapeHtml((quiz.group_label || 'table').toLowerCase())}.</p>
          <ol>${guessTables.map(t => `<li>${escapeHtml(quiz.group_label || 'Table')} <strong>${escapeHtml(t.group_value)}</strong> · ${t.guesses} ${t.guesses === 1 ? 'vote' : 'votes'} <span class="pill">${t.players} ${t.players === 1 ? 'player' : 'players'}</span></li>`).join('')}</ol>
        </div>
      ` : ''}
      ${(teamBride.length > 0 || teamGroom.length > 0) ? `
        <div class="team-row" style="grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
          ${teamBride.length > 0 ? `
            <div class="stat-card">
              <h3><img class="stat-mini-face" src="${faceUrl(quizFaces, 'bride', 'happy')}" alt=""> Team ${escapeHtml(quiz.bride_label)}</h3>
              <p class="blurb">Most loyal ${escapeHtml(quiz.bride_label)} voters when she was an option.</p>
              <ul style="list-style:none;padding-left:0;">${teamBride.map(p => `<li>· <strong>${escapeHtml(p.name)}</strong> <span class="pill">${p.bridePicks}/${p.brideOpps} · ${Math.round(p.ratio * 100)}%</span>${p.group ? ` <span class="pill">${escapeHtml(quiz.group_label || 'Table')} ${escapeHtml(p.group)}</span>` : ''}</li>`).join('')}</ul>
            </div>
          ` : '<div></div>'}
          ${teamGroom.length > 0 ? `
            <div class="stat-card">
              <h3><img class="stat-mini-face" src="${faceUrl(quizFaces, 'groom', 'happy')}" alt=""> Team ${escapeHtml(quiz.groom_label)}</h3>
              <p class="blurb">Most loyal ${escapeHtml(quiz.groom_label)} voters when he was an option.</p>
              <ul style="list-style:none;padding-left:0;">${teamGroom.map(p => `<li>· <strong>${escapeHtml(p.name)}</strong> <span class="pill">${p.groomPicks}/${p.groomOpps} · ${Math.round(p.ratio * 100)}%</span>${p.group ? ` <span class="pill">${escapeHtml(quiz.group_label || 'Table')} ${escapeHtml(p.group)}</span>` : ''}</li>`).join('')}</ul>
            </div>
          ` : '<div></div>'}
        </div>
      ` : ''}
      ${noGuessPlayers.length > 0 ? `
        <div class="stat-card" style="grid-column: 1 / -1;">
          <h3>The shy ones</h3>
          <p class="blurb">Joined but never voted (${noGuessPlayers.length} ${noGuessPlayers.length === 1 ? 'guest' : 'guests'}).</p>
          <p style="font-family:'Cormorant Infant',serif;font-size:17px;margin:0;">${noGuessPlayers.map(p => `<span style="display:inline-block;margin-right:14px;">${escapeHtml(p.name)}${p.group_value ? ` <span class="pill">${escapeHtml(quiz.group_label || 'Table')} ${escapeHtml(p.group_value)}</span>` : ''}</span>`).join('')}</p>
        </div>
      ` : ''}
    </div>
  ` : ''}

  <div class="footer">
    Generated by qyzr · ${fmtDate(Date.now())}
  </div>
</div>

<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-labelledby="lightboxLabel" aria-hidden="true">
  <div class="backdrop" data-lb-close></div>
  <div class="frame">
    <button class="lb-close" type="button" aria-label="Close" data-lb-close>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
    </button>
    <img id="lightboxImg" src="" alt="" />
    <div class="actions">
      <a class="lb-btn primary" id="lightboxDownload" href="#" download>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download photo
      </a>
      <button class="lb-btn" type="button" data-lb-close>Close</button>
    </div>
    <span id="lightboxLabel" class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">Question photo viewer</span>
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
    } catch (e) {}
    if (fmt) {
      document.querySelectorAll('time[data-fmt="dt"]').forEach(function (el) {
        var d = new Date(el.getAttribute('datetime'));
        if (isNaN(+d)) return;
        el.textContent = fmt.format(d);
      });
    }
  })();

  // Lightbox: click question images to view full-size with blurred backdrop + download.
  (function () {
    var lb = document.getElementById('lightbox');
    var lbImg = document.getElementById('lightboxImg');
    var lbDl = document.getElementById('lightboxDownload');
    if (!lb || !lbImg || !lbDl) return;
    var lastTrigger = null;
    var prevOverflow = '';

    function filenameFor(src, qnum) {
      try {
        var clean = src.split('?')[0].split('#')[0];
        var base = clean.substring(clean.lastIndexOf('/') + 1) || 'image';
        return 'qyzr-question-' + (qnum || '') + '-' + base;
      } catch (e) { return 'qyzr-question.jpg'; }
    }

    function open(img) {
      lastTrigger = img;
      lbImg.src = img.currentSrc || img.src;
      lbImg.alt = img.alt || '';
      lbDl.href = img.src;
      lbDl.setAttribute('download', filenameFor(img.src, img.dataset.qnum));
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // Focus close for keyboard users
      var closeBtn = lb.querySelector('.lb-close');
      if (closeBtn) closeBtn.focus();
    }
    function close() {
      lb.classList.remove('open');
      lb.setAttribute('aria-hidden', 'true');
      lbImg.src = '';
      document.body.style.overflow = prevOverflow;
      if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
      lastTrigger = null;
    }

    document.querySelectorAll('img.q-img').forEach(function (img) {
      img.addEventListener('click', function () { open(img); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
      });
    });
    lb.querySelectorAll('[data-lb-close]').forEach(function (el) {
      el.addEventListener('click', function (e) { e.preventDefault(); close(); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb.classList.contains('open')) close();
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
