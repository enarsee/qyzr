const rateLimit = require('express-rate-limit');
const { LRUCache } = require('lru-cache');

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true });
const playLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true });

// Socket connection rate limiter
const socketCxnLru = new LRUCache({ max: 10000, ttl: 5 * 60 * 1000 });
function socketConnectionAllowed(ip) {
  const now = Date.now();
  const record = socketCxnLru.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > 60 * 1000) { record.count = 0; record.windowStart = now; }
  record.count++;
  socketCxnLru.set(ip, record);
  return record.count <= 60;
}

// Per-socket emit token bucket
function makeEmitBucket({ rate = 5, burst = 10 } = {}) {
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
