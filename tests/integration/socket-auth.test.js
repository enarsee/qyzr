const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => {
  freshDb();
  s = await startTestServer();
});
afterEach(async () => {
  await s.close();
});

function makeQuiz() {
  return quizzes.create({
    name: 'Q',
    bride_label: 'B',
    groom_label: 'G',
    group_label: 'Table',
    accent_color: '#000',
    hero_image_path: null,
    creator_token: ids.creatorToken(),
    room_code: ids.roomCode()
  });
}

test('host connect with bad token rejected', async () => {
  await expect(connect(s.url, { role: 'host', creator_token: 'no' })).rejects.toThrow();
});

test('player connect with no active game rejected', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  await expect(connect(s.url, { role: 'player', room_code: quiz.room_code })).rejects.toThrow(/no_active_game/);
});

test('host connect with valid token succeeds', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  const c = await connect(s.url, { role: 'host', creator_token: quiz.creator_token });
  expect(c.connected).toBe(true);
  c.close();
});

test('display connect with valid room_code succeeds even without game', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  const c = await connect(s.url, { role: 'display', room_code: quiz.room_code });
  expect(c.connected).toBe(true);
  c.close();
});
