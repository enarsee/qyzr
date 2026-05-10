// /admin/* routes — password-gated admin console for managing secrets
// (currently GEMINI_API_KEY) used by AI features. Disabled entirely if
// ADMIN_PASSWORD is not set in the environment.

const path = require('path');
const express = require('express');
const router = express.Router();
const auth = require('../lib/admin-auth');
const secrets = require('../repos/secrets');

// Catalog of recognized secret keys. Unknown keys are accepted (admin
// can store anything) but these get nicer labels + helper text in the UI.
const KNOWN_SECRETS = [
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini API Key',
    help: 'Used for AI image generation (question scenes + sprite packs). Get one at https://aistudio.google.com/apikey',
  },
];

// ── Login ──────────────────────────────────────────────────────────
router.get('/admin/login', (_req, res) => {
  if (!auth.adminEnabled()) {
    return res.status(503).type('html').send(loginPage({
      error: 'Admin is disabled. Set ADMIN_PASSWORD on the server to enable /admin.',
      disabled: true,
    }));
  }
  res.type('html').send(loginPage({}));
});

router.post('/admin/login', express.urlencoded({ extended: false }), (req, res) => {
  if (!auth.adminEnabled()) return res.status(503).type('html').send(loginPage({ error: 'Admin disabled.', disabled: true }));
  const password = (req.body && req.body.password) || '';
  if (!auth.checkPassword(password)) {
    return res.status(401).type('html').send(loginPage({ error: 'Wrong password.' }));
  }
  auth.setSessionCookie(res, auth.issueSession());
  res.redirect('/admin/secrets');
});

router.post('/admin/logout', (req, res) => {
  auth.clearSessionCookie(res);
  res.redirect('/admin/login');
});

// ── Secrets page (HTML) ────────────────────────────────────────────
router.get('/admin/secrets', auth.requireAdmin({ html: true }), (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'admin', 'secrets.html'));
});

// ── Secrets API (JSON) ────────────────────────────────────────────
// List all secrets. Values are NEVER returned (only key + presence + updated_at)
// to keep the API safe even if a logged-in admin's session leaks via XSS.
router.get('/api/admin/secrets', auth.requireAdmin(), (_req, res) => {
  const stored = secrets.list();
  const storedMap = new Map(stored.map(s => [s.key, s]));
  // Merge known keys + any extra keys present in DB.
  const out = [];
  const seen = new Set();
  for (const meta of KNOWN_SECRETS) {
    const row = storedMap.get(meta.key);
    out.push({
      key: meta.key,
      label: meta.label,
      help: meta.help,
      known: true,
      present: !!row,
      updated_at: row ? row.updated_at : null,
    });
    seen.add(meta.key);
  }
  for (const row of stored) {
    if (seen.has(row.key)) continue;
    out.push({ key: row.key, label: row.key, help: '', known: false, present: true, updated_at: row.updated_at });
  }
  res.json({ secrets: out });
});

router.put('/api/admin/secrets/:key', auth.requireAdmin(), express.json({ limit: '16kb' }), (req, res) => {
  const key = (req.params.key || '').trim();
  const value = req.body && typeof req.body.value === 'string' ? req.body.value : null;
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  if (value == null) return res.status(400).json({ error: 'invalid_value' });
  const trimmed = value.trim();
  if (!trimmed) return res.status(400).json({ error: 'empty_value' });
  if (trimmed.length > 8192) return res.status(400).json({ error: 'value_too_long' });
  const r = secrets.set(key, trimmed);
  res.json({ ok: true, key: r.key, updated_at: r.updated_at });
});

router.delete('/api/admin/secrets/:key', auth.requireAdmin(), (req, res) => {
  const key = (req.params.key || '').trim();
  if (!key) return res.status(400).json({ error: 'invalid_key' });
  secrets.remove(key);
  res.json({ ok: true });
});

// ── Login HTML (inline so we don't need a static asset) ───────────
function loginPage({ error, disabled }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>qyzr · admin</title>
<link rel="stylesheet" href="/shared/styles.css">
<style>
  body { background: var(--bg); min-height: 100dvh; display: grid; place-items: center; padding: 24px; font-family: 'Inter', system-ui, sans-serif; }
  .login { background: var(--surface); padding: 32px; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); width: 100%; max-width: 380px; }
  .login h1 { font-family: 'Great Vibes', cursive; color: var(--rose); font-size: 56px; text-align: center; margin: 0 0 4px; line-height: 1; }
  .login p.sub { text-align: center; color: var(--muted); font-size: 13px; margin: 0 0 20px; }
  .login label { display: block; font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 6px; }
  .login input[type="password"] { width: 100%; padding: 12px 14px; border: 1px solid #E3D9CC; border-radius: 10px; font-size: 16px; background: var(--bg); color: var(--ink); box-sizing: border-box; min-height: 44px; }
  .login input[type="password"]:focus { outline: 2px solid var(--rose); outline-offset: 1px; border-color: var(--rose); }
  .login button { width: 100%; margin-top: 14px; padding: 12px; border: none; border-radius: 999px; background: var(--rose); color: #fff; font-weight: 600; font-size: 15px; cursor: pointer; min-height: 44px; transition: transform 120ms ease; }
  .login button:hover:not(:disabled) { transform: translateY(-1px); }
  .login button:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { color: var(--error); font-size: 13px; margin-top: 10px; text-align: center; }
</style>
</head>
<body>
<form class="login" method="post" action="/admin/login">
  <h1>qyzr</h1>
  <p class="sub">Admin console</p>
  <label for="pw">Password</label>
  <input id="pw" type="password" name="password" autocomplete="current-password" autofocus ${disabled ? 'disabled' : ''}>
  <button type="submit" ${disabled ? 'disabled' : ''}>Sign in</button>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
</form>
</body>
</html>`;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

module.exports = router;
