const request = require('supertest');
const { freshDb } = require('../helpers/db');
const { buildApp } = require('../../src/server');

let app;
beforeEach(() => { freshDb(); app = buildApp(); });

async function makeQuiz() {
  const res = await request(app).post('/api/quiz').send({ name: 'Wedding' });
  return res.body;
}

test('POST /api/quiz creates and returns urls', async () => {
  const q = await makeQuiz();
  expect(q.creator_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(q.room_code).toMatch(/^[A-Z2-9]{6}$/);
});

test('GET /api/quiz?token=… requires token', async () => {
  const q = await makeQuiz();
  expect((await request(app).get('/api/quiz')).status).toBe(401);
  expect((await request(app).get(`/api/quiz?token=${q.creator_token}`)).status).toBe(200);
  expect((await request(app).get(`/api/quiz?token=garbage`)).status).toBe(404);
});

test('POST question rejects bad option counts', async () => {
  const q = await makeQuiz();
  const r = await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'Q?', side_tag: 'bride', options: [{ text: 'a', is_correct: true }]
  });
  expect(r.status).toBe(400);
  expect(r.body.error).toBe('options_count_invalid');
});

test('PUT question with options blocked after answers exist', async () => {
  const q = await makeQuiz();
  const created = await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'Q?', side_tag: 'bride',
    options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  });
  const games = require('../../src/repos/games');
  const players = require('../../src/repos/players');
  const answers = require('../../src/repos/answers');
  const questions = require('../../src/repos/questions');
  const game = games.create((await request(app).get(`/api/quiz?token=${q.creator_token}`)).body.id);
  const p = players.create({ game_id: game.id, name: 'A', group_value: '1' });
  const opt = questions.byId(created.body.id).options[0].id;
  answers.record({ game_id: game.id, question_id: created.body.id, player_id: p.id, option_id: opt, correct: true });

  const upd = await request(app).put(`/api/question/${created.body.id}?token=${q.creator_token}`).send({
    options: [{ text: 'x', is_correct: true }, { text: 'y' }]
  });
  expect(upd.status).toBe(409);
  expect(upd.body.error).toBe('options_locked_after_play');
});

test('reorder updates positions', async () => {
  const q = await makeQuiz();
  const a = (await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'A?', side_tag: 'bride', options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  })).body.id;
  const b = (await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'B?', side_tag: 'groom', options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  })).body.id;
  await request(app).post(`/api/quiz/${q.creator_token}/reorder`).send({ ids: [b, a] });
  const full = await request(app).get(`/api/quiz?token=${q.creator_token}`);
  expect(full.body.questions.map(q => q.id)).toEqual([b, a]);
});
