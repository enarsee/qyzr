const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');

const router = express.Router();
const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// 20 MB raw upload limit — modern phone photos and bg-removed PNGs can easily
// be 8-15 MB. Sharp resizes to ≤2048px and re-encodes to WebP so the stored
// file is small regardless of input size.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

router.post('/api/upload', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // multer errors (e.g. LIMIT_FILE_SIZE) → 400
      return res.status(400).json({ error: err.code || 'upload_error' });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const meta = await sharp(req.file.buffer).metadata();
    if (!ALLOWED_FORMATS.has(meta.format)) {
      return res.status(400).json({ error: 'unsupported_format' });
    }
    const out = await sharp(req.file.buffer)
      .rotate()                 // auto-orient
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .toFormat('webp', { quality: 85 })
      .toBuffer();
    const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.webp`;
    fs.writeFileSync(path.join(uploadDir, fname), out);
    res.json({ path: `/uploads/${fname}` });
  } catch {
    res.status(400).json({ error: 'image_invalid' });
  }
});

router.use('/uploads', express.static(uploadDir));

module.exports = router;
