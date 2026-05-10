// Admin-managed app-wide secrets (e.g. GEMINI_API_KEY).
//
// Lookup is hot-path on AI generation routes, so we cache values in
// memory after first read and invalidate on writes. Cache is a Map so
// missing keys can be cached as `undefined` (no value) without confusing
// them with "we never asked".

const { getDb } = require('../db');

const cache = new Map();
let cacheLoaded = false;

function ensureLoaded() {
  if (cacheLoaded) return;
  const rows = getDb().prepare('SELECT key, value FROM secrets').all();
  for (const r of rows) cache.set(r.key, r.value);
  cacheLoaded = true;
}

function get(key) {
  ensureLoaded();
  return cache.has(key) ? cache.get(key) : null;
}

function list() {
  ensureLoaded();
  return getDb().prepare('SELECT key, updated_at FROM secrets ORDER BY key').all();
}

function set(key, value) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('invalid_key');
  if (typeof value !== 'string') throw new Error('invalid_value');
  const k = key.trim();
  const ts = Date.now();
  getDb().prepare(`
    INSERT INTO secrets (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(k, value, ts);
  cache.set(k, value);
  return { key: k, updated_at: ts };
}

function remove(key) {
  if (typeof key !== 'string') throw new Error('invalid_key');
  getDb().prepare('DELETE FROM secrets WHERE key = ?').run(key);
  cache.delete(key);
}

// Test helper: drop the in-memory cache so a fresh `get` reloads from DB.
function _resetCacheForTesting() {
  cache.clear();
  cacheLoaded = false;
}

module.exports = { get, set, remove, list, _resetCacheForTesting };
