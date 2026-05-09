const request = require('supertest');
const { buildApp } = require('../../src/server');

test('GET / returns 200', async () => {
  const res = await request(buildApp()).get('/');
  expect(res.status).toBe(200);
});

test('GET /create/ returns 200', async () => {
  const res = await request(buildApp()).get('/create/');
  expect(res.status).toBe(200);
});

test('GET /host/:token returns 200', async () => {
  const res = await request(buildApp()).get('/host/test-token');
  expect(res.status).toBe(200);
});

test('GET /display/:code returns 200', async () => {
  const res = await request(buildApp()).get('/display/ABC123');
  expect(res.status).toBe(200);
});

test('GET /play/ returns 200', async () => {
  const res = await request(buildApp()).get('/play/');
  expect(res.status).toBe(200);
});

test('GET /play/:code returns 200', async () => {
  const res = await request(buildApp()).get('/play/ABC123');
  expect(res.status).toBe(200);
});
