const { creatorToken, playerToken, roomCode } = require('../../src/lib/ids');

describe('creatorToken', () => {
  test('produces 32-character base64url string', () => {
    const t = creatorToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  test('produces unique values', () => {
    const set = new Set(Array.from({ length: 100 }, creatorToken));
    expect(set.size).toBe(100);
  });
});

describe('playerToken', () => {
  test('produces 24-character base64url string', () => {
    expect(playerToken()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe('roomCode', () => {
  test('produces 6 characters from base32 minus 0/O/1/I', () => {
    const c = roomCode();
    expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  test('produces unique values across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, roomCode));
    expect(set.size).toBeGreaterThan(990); // allow rare collisions
  });
});
