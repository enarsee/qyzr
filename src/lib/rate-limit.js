const rateLimit = require('express-rate-limit');
const { LRUCache } = require('lru-cache');

// Generous limits — appropriate for a self-hosted wedding tool, not a public
// SaaS. The most important limit is socket connections (a wedding venue's
// guest Wi-Fi shares one egress IP, so 150 guests = 150 conns/IP).

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 200, standardHeaders: true });   // quiz creation: 200/hr
const playLimiter   = rateLimit({ windowMs: 60 * 1000,      max: 500, standardHeaders: true });   // /play hits: 500/min/IP
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 500, standardHeaders: true });   // image uploads: 500/hr

// Socket connection rate limiter (per-IP)
const SOCKET_CONN_PER_MIN = 500;
const socketCxnLru = new LRUCache({ max: 10000, ttl: 5 * 60 * 1000 });
function socketConnectionAllowed(ip) {
  const now = Date.now();
  const record = socketCxnLru.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > 60 * 1000) { record.count = 0; record.windowStart = now; }
  record.count++;
  socketCxnLru.set(ip, record);
  return record.count <= SOCKET_CONN_PER_MIN;
}

// Per-socket emit token bucket (this is per-CLIENT-CONNECTION protection
// against a single misbehaving client flooding events; left looser but still
// prevents one bad actor from spamming).
function makeEmitBucket({ rate = 20, burst = 60 } = {}) {
  let tokens = burst, last = Date.now();
  return function take() {
    const now = Date.now();
    tokens = Math.min(burst, tokens + (now - last) / 1000 * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1; return true;
  };
}

module.exports = { createLimiter, playLimiter, uploadLimiter, socketConnectionAllowed, makeEmitBucket };
