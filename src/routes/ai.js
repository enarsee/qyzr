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

module.exports = router;
