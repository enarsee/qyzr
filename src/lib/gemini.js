// Thin client for Gemini's REST API. Used for image generation
// (gemini-2.5-flash-image, aka "Nano Banana") with optional reference
// images so the model can produce consistent character likenesses
// across many question scenes.
//
// We call REST directly (no SDK) to keep the dependency tree minimal —
// genai SDKs are heavy and we only need one endpoint.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash-image';

class GeminiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.details = details;
  }
}

// Read an image at `localPath` (something like /uploads/abc.webp), normalize
// it for the API, and return { mimeType, data } where data is base64.
async function imageFromUploadPath(localPath, dataDir) {
  if (!localPath || !localPath.startsWith('/uploads/')) {
    throw new GeminiError('reference_image_invalid', 400);
  }
  const fname = localPath.replace('/uploads/', '');
  // basic traversal guard
  if (fname.includes('/') || fname.includes('..')) throw new GeminiError('reference_image_invalid', 400);
  const full = path.join(dataDir, 'uploads', fname);
  if (!fs.existsSync(full)) throw new GeminiError('reference_image_missing', 404);
  // Re-encode to JPEG to normalize: WebP-from-camera works but JPEG is the
  // most universally accepted MIME and keeps payload small.
  const buf = await sharp(full)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .toFormat('jpeg', { quality: 88 })
    .toBuffer();
  return { mimeType: 'image/jpeg', data: buf.toString('base64') };
}

// Returns { buffer, mimeType } of the generated image.
//
// `prompt`: free-form text from the host (e.g. "a winter beach with snow")
// `referenceImages`: optional array of { mimeType, data: base64 } reference images
// `apiKey`: Gemini API key
async function generateImage({ prompt, referenceImages = [], apiKey, model = DEFAULT_MODEL, aspectRatio = '4:3' }) {
  if (!apiKey || typeof apiKey !== 'string') throw new GeminiError('api_key_missing', 503);
  if (!prompt || typeof prompt !== 'string') throw new GeminiError('prompt_required', 400);

  const parts = [];
  for (const ref of referenceImages) {
    if (!ref || !ref.data || !ref.mimeType) continue;
    parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      // Aspect ratio is a v1beta-only field on the image model; the API
      // tolerates unknown keys but this is documented for image gen.
      ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
    },
  };

  const url = `${ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new GeminiError('network_error', 502, e.message);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    const apiMsg = parsed?.error?.message || text || 'unknown';
    // Map common HTTP errors to friendly codes for the UI.
    if (res.status === 401 || res.status === 403) {
      throw new GeminiError('api_key_invalid', res.status, apiMsg);
    }
    if (res.status === 429) throw new GeminiError('rate_limited', 429, apiMsg);
    if (res.status >= 500) throw new GeminiError('upstream_error', res.status, apiMsg);
    throw new GeminiError('generation_failed', res.status, apiMsg);
  }

  let data;
  try { data = await res.json(); }
  catch (e) { throw new GeminiError('bad_response', 502, e.message); }

  // Walk candidates → parts → first inlineData with image MIME.
  const candidates = data?.candidates || [];
  for (const cand of candidates) {
    const cparts = cand?.content?.parts || [];
    for (const p of cparts) {
      if (p?.inlineData?.data && /^image\//.test(p.inlineData.mimeType || '')) {
        const buf = Buffer.from(p.inlineData.data, 'base64');
        return { buffer: buf, mimeType: p.inlineData.mimeType };
      }
    }
  }
  // Some responses surface a safety block reason — surface it.
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) throw new GeminiError('content_blocked', 400, blocked);
  throw new GeminiError('no_image_returned', 502, JSON.stringify(data).slice(0, 500));
}

module.exports = { generateImage, imageFromUploadPath, GeminiError, DEFAULT_MODEL };
