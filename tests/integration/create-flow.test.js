const request = require('supertest');
const { freshDb } = require('../helpers/db');
const { buildApp } = require('../../src/server');

beforeEach(() => freshDb());

test('GET /create renders 200 with the form', async () => {
  const r = await request(buildApp()).get('/create/');
  expect(r.status).toBe(200);
  expect(r.text).toContain('Create a quiz');
});
