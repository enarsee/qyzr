// AI endpoints: image generation for question scenes (Phase 3) and
// sprite packs (Phase 4). All routes are scoped to a quiz via
// creator_token and use the GEMINI_API_KEY stored in /admin/secrets.

const fs = require('fs');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const config = require('../config');
const quizzes = require('../repos/quizzes');
const questions = require('../repos/questions');
const faces = require('../repos/faces');
const secrets = require('../repos/secrets');
const gemini = require('../lib/gemini');
const { aiLimiter } = require('../lib/rate-limit');

const router = express.Router();
const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function requireQuizByToken(req, res) {
  const token = req.params.token;
  if (typeof token !== 'string' || !token) { res.status(401).json({ error: 'token_required' }); return null; }
  const q = quizzes.byCreatorToken(token);
  if (!q) { res.status(404).json({ error: 'quiz_not_found' }); return null; }
  return q;
}

function getApiKey() {
  // Admin-managed secret takes precedence; env fallback for local dev.
  const v = secrets.get('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '';
  return v.trim();
}

async function writeUpload(buf, ext) {
  const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  // Always normalize generated images to WebP — same convention as /api/upload.
  const out = await sharp(buf)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .toFormat('webp', { quality: 88 })
    .toBuffer();
  const finalName = fname.replace(/\.[^.]+$/, '.webp');
  fs.writeFileSync(path.join(uploadDir, finalName), out);
  return `/uploads/${finalName}`;
}

// Build the prompt sent to Gemini. We're aiming for "a stylish image of the
// couple in <scene>" — the reference photo gives the model the likeness, the
// scene is the host's description.
function buildScenePrompt({ quiz, scene, style }) {
  const styleHint = style && style !== 'photorealistic'
    ? `, ${style} style`
    : '';
  return [
    `Generate a tasteful ${style || 'photorealistic'} image of the same couple from the reference photo`,
    scene ? `${scene}.` : '.',
    `Maintain their exact facial features, body proportions, and hair from the reference. Wedding-appropriate, joyful, no inappropriate content${styleHint}.`,
  ].filter(Boolean).join(' ');
}

// POST /api/quiz/:token/q/:qid/generate-image
//   body: { scene: string, style?: 'photorealistic'|'studio'|'whimsical' }
// Returns: { image_path: '/uploads/xxx.webp' }
router.post('/api/quiz/:token/q/:qid/generate-image', aiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const apiKey = getApiKey();
  if (!apiKey) return res.status(503).json({ error: 'api_key_missing', hint: 'Set GEMINI_API_KEY at /admin/secrets' });
  if (!q.couple_image_path) return res.status(400).json({ error: 'couple_photo_missing', hint: 'Upload a couple reference photo on the host page first.' });

  const { qid } = req.params;
  const question = questions.byId(qid);
  if (!question || question.quiz_id !== q.id) return res.status(404).json({ error: 'question_not_found' });

  const scene = (req.body && typeof req.body.scene === 'string') ? req.body.scene.trim() : '';
  if (!scene || scene.length < 3 || scene.length > 500) return res.status(400).json({ error: 'scene_invalid' });
  const style = req.body && typeof req.body.style === 'string' ? req.body.style : 'photorealistic';
  const ALLOWED_STYLES = new Set(['photorealistic', 'studio', 'whimsical']);
  if (!ALLOWED_STYLES.has(style)) return res.status(400).json({ error: 'style_invalid' });

  try {
    const ref = await gemini.imageFromUploadPath(q.couple_image_path, config.dataDir);
    const result = await gemini.generateImage({
      prompt: buildScenePrompt({ quiz: q, scene, style }),
      referenceImages: [ref],
      apiKey,
      aspectRatio: '4:3',
    });
    const imagePath = await writeUpload(result.buffer, 'webp');
    questions.update(qid, { image_path: imagePath });
    res.json({ image_path: imagePath });
  } catch (e) {
    if (e instanceof gemini.GeminiError) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 502;
      return res.status(status).json({ error: e.message, details: e.details });
    }
    return res.status(500).json({ error: 'unknown' });
  }
});

// ── Sprite pack generation ─────────────────────────────────────────
// Per-emotion mood/scene language used in the generation prompt.
const EMOTION_PROMPTS = {
  neutral: 'a calm, neutral expression, looking forward',
  happy:   'a warm, joyful smile, eyes lit up',
  sad:     'a soft, downcast, sad expression',
  angry:   'a slightly frustrated, frowning expression — playful, not menacing',
  winner:  'an exuberant, triumphant smile — eyes closed in joy, like just won a prize',
};
const ALL_STATES = Object.keys(EMOTION_PROMPTS); // 5
const ALL_SIDES = ['bride', 'groom'];

function buildSpritePrompt({ side, state, bride_label, groom_label }) {
  const who = side === 'bride'
    ? `the ${bride_label || 'bride'} from the reference photo`
    : `the ${groom_label || 'groom'} from the reference photo`;
  return [
    `Generate a circular avatar-style portrait of ${who}.`,
    `Cartoonish illustrated style, clean studio background (single soft pastel color), centered face and shoulders only.`,
    `Expression: ${EMOTION_PROMPTS[state]}.`,
    'Maintain their exact facial features, skin tone, and hair from the reference. Wedding-appropriate, friendly, no text or logos.',
  ].join(' ');
}

// POST /api/quiz/:token/generate-sprites
//   body: { bride_image_path, groom_image_path }
// Streams results via SSE. Each event:
//   data: {"type":"sprite","side":"bride","state":"happy","image_path":"/uploads/x.webp"}
//   data: {"type":"error","side":"bride","state":"sad","error":"rate_limited"}
//   data: {"type":"done"}
router.post('/api/quiz/:token/generate-sprites', aiLimiter, express.json({ limit: '8kb' }), async (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const apiKey = getApiKey();
  if (!apiKey) return res.status(503).json({ error: 'api_key_missing', hint: 'Set GEMINI_API_KEY at /admin/secrets' });

  const SAFE = /^\/uploads\/[A-Za-z0-9_\-]+\.webp$/;
  const bridePath = req.body && typeof req.body.bride_image_path === 'string' ? req.body.bride_image_path : '';
  const groomPath = req.body && typeof req.body.groom_image_path === 'string' ? req.body.groom_image_path : '';
  if (!SAFE.test(bridePath) || !SAFE.test(groomPath)) {
    return res.status(400).json({ error: 'image_paths_invalid' });
  }

  let brideRef, groomRef;
  try {
    [brideRef, groomRef] = await Promise.all([
      gemini.imageFromUploadPath(bridePath, config.dataDir),
      gemini.imageFromUploadPath(groomPath, config.dataDir),
    ]);
  } catch (e) {
    return res.status(400).json({ error: e instanceof gemini.GeminiError ? e.message : 'reference_image_invalid' });
  }

  // Switch to SSE.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable Nginx-style buffering if anything is in front of us.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const send = (obj) => { res.write(`data: ${JSON.stringify(obj)}\n\n`); };

  let clientGone = false;
  req.on('close', () => { clientGone = true; });

  const tasks = [];
  for (const side of ALL_SIDES) {
    for (const state of ALL_STATES) {
      tasks.push({ side, state });
    }
  }

  // Generate in parallel; emit as each finishes.
  await Promise.all(tasks.map(async ({ side, state }) => {
    if (clientGone) return;
    try {
      const ref = side === 'bride' ? brideRef : groomRef;
      const result = await gemini.generateImage({
        prompt: buildSpritePrompt({ side, state, bride_label: q.bride_label, groom_label: q.groom_label }),
        referenceImages: [ref],
        apiKey,
        aspectRatio: '1:1',
      });
      // Sprite-style: square crop + circle-friendly framing already baked in by prompt.
      const out = await sharp(result.buffer)
        .rotate()
        .resize({ width: 512, height: 512, fit: 'cover' })
        .toFormat('webp', { quality: 88 })
        .toBuffer();
      const fname = `sprite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
      fs.writeFileSync(path.join(uploadDir, fname), out);
      const image_path = `/uploads/${fname}`;
      faces.upsert({ quiz_id: q.id, side, state, image_path });
      if (!clientGone) send({ type: 'sprite', side, state, image_path });
    } catch (e) {
      const code = e instanceof gemini.GeminiError ? e.message : 'generation_failed';
      if (!clientGone) send({ type: 'error', side, state, error: code });
    }
  }));

  if (!clientGone) {
    send({ type: 'done' });
    res.end();
  }
});

module.exports = router;
