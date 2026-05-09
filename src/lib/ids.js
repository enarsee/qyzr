const { randomBytes } = require('crypto');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function creatorToken() {
  return randomBytes(24).toString('base64url'); // 24 bytes -> 32 chars
}

function playerToken() {
  return randomBytes(18).toString('base64url'); // 18 bytes -> 24 chars
}

function roomCode() {
  // 6 chars from a 32-char alphabet via crypto-random byte mapping.
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ROOM_ALPHABET[bytes[i] % 32];
  return out;
}

module.exports = { creatorToken, playerToken, roomCode };
