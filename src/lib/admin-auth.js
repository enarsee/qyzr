// Admin auth: a single ADMIN_PASSWORD env var gates access to /admin/*.
//
// On successful login, a signed cookie `wq_admin` carries an HMAC-SHA256
// of (issued_at + nonce). The session secret is derived from
// ADMIN_PASSWORD itself, so changing the password invalidates all
// existing sessions (no separate SESSION_SECRET to rotate).
//
// Sessions expire 7 days after issue. Constant-time comparisons used
// for both password check and signature verification.

const crypto = require('crypto');

const COOKIE_NAME = 'wq_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function adminPassword() {
  return process.env.ADMIN_PASSWORD || '';
}

function adminEnabled() {
  return !!adminPassword();
}

function sessionSecret() {
  // Derive a signing key from ADMIN_PASSWORD so we don't need a separate
  // env var. The label prefix prevents accidental reuse if someone ever
  // computes HMACs of ADMIN_PASSWORD elsewhere.
  return crypto.createHash('sha256')
    .update('wq-admin-session::' + adminPassword())
    .digest();
}

function sign(issuedAt, nonce) {
  const data = `${issuedAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', sessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [issuedAtStr, nonce, sig] = parts;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > SESSION_TTL_MS) return null;
  const expected = crypto.createHmac('sha256', sessionSecret())
    .update(`${issuedAtStr}.${nonce}`).digest('base64url');
  // Constant-time comparison (lengths must match)
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { issuedAt };
}

function checkPassword(input) {
  const expected = adminPassword();
  if (!expected || typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueSession() {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(16).toString('base64url');
  return sign(issuedAt, nonce);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, value) {
  const cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  // In production we're behind Caddy with HTTPS; mark Secure when not
  // explicitly running plain HTTP locally.
  if (process.env.NODE_ENV !== 'development') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// Express middleware: requires a valid admin session, otherwise responds
// 401 (for /api routes) or redirects to /admin/login (for HTML routes).
function requireAdmin(opts) {
  const wantsHtml = !!(opts && opts.html);
  return function (req, res, next) {
    if (!adminEnabled()) {
      if (wantsHtml) return res.status(503).send('<h1>Admin disabled</h1><p>Set ADMIN_PASSWORD on the server to enable /admin.</p>');
      return res.status(503).json({ error: 'admin_disabled' });
    }
    const token = readCookie(req, COOKIE_NAME);
    const session = verify(token);
    if (!session) {
      if (wantsHtml) return res.redirect('/admin/login');
      return res.status(401).json({ error: 'unauthenticated' });
    }
    req.admin = session;
    next();
  };
}

module.exports = {
  adminEnabled,
  checkPassword,
  issueSession,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
  verify,
  COOKIE_NAME,
};
