const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');

beforeAll(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-'));
});
const { buildApp } = require('../../src/server');

test('rejects non-image', async () => {
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', Buffer.from('not an image'), 'fake.jpg');
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('image_invalid');
});

test('accepts a small PNG and returns webp path', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .png().toBuffer();
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', png, 'pic.png');
  expect(res.status).toBe(200);
  expect(res.body.path).toMatch(/^\/uploads\/.+\.webp$/);
});

test('rejects file >5MB', async () => {
  const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', big, 'big.jpg');
  expect(res.status).toBe(400);
});
