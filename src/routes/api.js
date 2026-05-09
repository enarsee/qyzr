const express = require('express');
const QRCode = require('qrcode');
const v = require('../lib/validators');
const ids = require('../lib/ids');
const quizzes = require('../repos/quizzes');
const faces = require('../repos/faces');
const questions = require('../repos/questions');
const config = require('../config');

const router = express.Router();

router.get('/api/qr/:code', async (req, res) => {
  try {
    const code = v.validateRoomCode(req.params.code);
    const url = `${config.publicUrl}/play/${code}`;
    const svg = await QRCode.toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#2A1B12', light: '#FFFFFF' }
    });
    res.set('content-type', 'image/svg+xml').set('cache-control', 'public, max-age=300').send(svg);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const SAFE_IMAGE_PATH = /^\/uploads\/[A-Za-z0-9_\-]+\.webp$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function requireQuizByToken(req, res) {
  const token = req.query.token || req.params.token;
  if (typeof token !== 'string' || !token) {
    res.status(401).json({ error: 'token_required' }); return null;
  }
  const q = quizzes.byCreatorToken(token);
  if (!q) { res.status(404).json({ error: 'quiz_not_found' }); return null; }
  return q;
}

router.post('/api/quiz', (req, res) => {
  try {
    const name = v.validateName(req.body.name);
    const bride_label = v.validateName(req.body.bride_label || 'Bride');
    const groom_label = v.validateName(req.body.groom_label || 'Groom');
    const group_label = v.validateName(req.body.group_label || 'Table');
    const accent_color = (() => {
      const c = (req.body.accent_color || '#C8587A').toString();
      if (!HEX_COLOR.test(c)) throw new Error('accent_color_invalid');
      return c;
    })();
    const hero_image_path = (() => {
      const p = req.body.hero_image_path;
      if (p == null || p === '') return null;
      if (!SAFE_IMAGE_PATH.test(String(p))) throw new Error('hero_image_path_invalid');
      return p;
    })();

    const creator_token = ids.creatorToken();
    let room_code = ids.roomCode();
    for (let i = 0; i < 5 && quizzes.byRoomCode(room_code); i++) room_code = ids.roomCode();

    const { id } = quizzes.create({ name, bride_label, groom_label, group_label, accent_color, hero_image_path, creator_token, room_code });
    res.json({
      id, creator_token, room_code,
      host_url: `${config.publicUrl}/host/${creator_token}`,
      display_url: `${config.publicUrl}/display/${room_code}`,
      play_url: `${config.publicUrl}/play/${room_code}`
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/api/quiz', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  res.json({ ...q, faces: faces.byQuiz(q.id), questions: questions.listByQuiz(q.id) });
});

router.get('/api/quiz/by-room/:code', (req, res) => {
  try {
    const code = v.validateRoomCode(req.params.code);
    const q = quizzes.byRoomCode(code);
    if (!q) return res.status(404).json({ error: 'not_found' });
    const { creator_token, ...pub } = q; void creator_token;
    res.json({ ...pub, faces: faces.byQuiz(q.id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/quiz', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const fields = {};
  try {
    if (req.body.name !== undefined) fields.name = v.validateName(req.body.name);
    if (req.body.bride_label !== undefined) fields.bride_label = v.validateName(req.body.bride_label);
    if (req.body.groom_label !== undefined) fields.groom_label = v.validateName(req.body.groom_label);
    if (req.body.group_label !== undefined) fields.group_label = v.validateName(req.body.group_label);
    if (req.body.accent_color !== undefined) {
      if (!HEX_COLOR.test(String(req.body.accent_color))) throw new Error('accent_color_invalid');
      fields.accent_color = req.body.accent_color;
    }
    if (req.body.hero_image_path !== undefined) {
      if (req.body.hero_image_path !== null && !SAFE_IMAGE_PATH.test(String(req.body.hero_image_path)))
        throw new Error('hero_image_path_invalid');
      fields.hero_image_path = req.body.hero_image_path;
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }
  quizzes.update(q.id, fields);
  res.json({ ok: true });
});

router.post('/api/quiz/:token/face', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  try {
    if (!SAFE_IMAGE_PATH.test(String(req.body.image_path || ''))) throw new Error('image_path_invalid');
    faces.upsert({ quiz_id: q.id, side: req.body.side, state: req.body.state, image_path: req.body.image_path });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/quiz/:token/question', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  try {
    const text = v.validateQuestionText(req.body.text);
    // Poll mode: side_tag defaults to neutral; clients no longer set it.
    const side_tag = req.body.side_tag ? v.validateSideTag(req.body.side_tag) : 'neutral';
    const image_path = (() => {
      const p = req.body.image_path;
      if (p == null || p === '') return null;
      if (!SAFE_IMAGE_PATH.test(String(p))) throw new Error('image_path_invalid');
      return p;
    })();
    const opts = (req.body.options || []).map(o => ({
      text: v.validateOptionText(o.text),
      is_correct: !!o.is_correct  // retained in DB for forward-compat; UI no longer surfaces it
    }));
    if (opts.length < 2 || opts.length > 4) throw new Error('options_count_invalid');
    const out = questions.create({ quiz_id: q.id, text, image_path, side_tag, options: opts });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/question/:id', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const existing = questions.byId(req.params.id);
  if (!existing || existing.quiz_id !== q.id) return res.status(404).json({ error: 'not_found' });
  try {
    const fields = {};
    if (req.body.text !== undefined) fields.text = v.validateQuestionText(req.body.text);
    if (req.body.side_tag !== undefined) {
      if (questions.hasAnswers(req.params.id)) {
        return res.status(409).json({ error: 'side_tag_locked_after_play' });
      }
      fields.side_tag = v.validateSideTag(req.body.side_tag);
    }
    if (req.body.image_path !== undefined) {
      const p = req.body.image_path;
      if (p !== null && !SAFE_IMAGE_PATH.test(String(p))) throw new Error('image_path_invalid');
      fields.image_path = p;
    }
    questions.update(req.params.id, fields);

    if (Array.isArray(req.body.options)) {
      if (questions.hasAnswers(req.params.id)) {
        return res.status(409).json({ error: 'options_locked_after_play' });
      }
      const opts = req.body.options.map(o => ({
        text: v.validateOptionText(o.text), is_correct: !!o.is_correct
      }));
      if (opts.length < 2 || opts.length > 4) throw new Error('options_count_invalid');
      questions.setOptions(req.params.id, opts);
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/quiz/:token/reorder', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  questions.reorder(q.id, ids);
  res.json({ ok: true });
});

router.delete('/api/question/:id', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const existing = questions.byId(req.params.id);
  if (!existing || existing.quiz_id !== q.id) return res.status(404).json({ error: 'not_found' });
  questions.remove(req.params.id);
  res.json({ ok: true });
});

router.delete('/api/quiz', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  // ON DELETE CASCADE on schema removes all questions, games, players, answers, faces
  const { getDb } = require('../db');
  getDb().prepare('DELETE FROM quizzes WHERE id = ?').run(q.id);
  res.json({ ok: true });
});

module.exports = router;
