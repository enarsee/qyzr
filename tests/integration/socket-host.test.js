const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

function quiz() {
  const ct = ids.creatorToken();
  const rc = ids.roomCode();
  const q = quizzes.create({
    name: 'Q', bride_label: 'B', groom_label: 'G', group_label: 'T',
    accent_color: '#000', hero_image_path: null,
    creator_token: ct, room_code: rc
  });
  return { id: q.id, ct, rc };
}
function addQ(quiz_id, side) {
  return questions.create({ quiz_id, text: side + '?', side_tag: side,
    options: [{ text: 'a', is_correct: 1 }, { text: 'b' }] }).id;
}

test('start with no questions errors', async () => {
  const q = quiz();
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:start');
  expect((await errP).code).toBe('no_questions');
  host.close();
});

test('happy path: start -> next -> reveal -> next -> finish', async () => {
  const q = quiz();
  addQ(q.id, 'bride'); addQ(q.id, 'groom');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });

  const stateAfterStart = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const s1 = await stateAfterStart;
  expect(s1.status).toBe('lobby');
  const game_id = s1.game_id;

  const showP = new Promise(r => host.once('question:show', r));
  host.emit('host:next', { game_id });
  const shown = await showP;
  expect(shown.position).toBe(1);

  const revP = new Promise(r => host.once('question:reveal', r));
  host.emit('host:reveal', { game_id });
  const rev = await revP;
  expect(rev.question_id).toBe(shown.question_id);

  const show2 = new Promise(r => host.once('question:show', r));
  host.emit('host:next', { game_id });
  expect((await show2).position).toBe(2);

  const finP = new Promise(r => host.once('game:finished', r));
  host.emit('host:finish', { game_id });
  const fin = await finP;
  expect(fin).toBeTruthy();
  expect(games.byId(game_id).status).toBe('finished');

  host.close();
});

test('reveal from lobby is rejected', async () => {
  const q = quiz(); addQ(q.id, 'bride');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const stateP = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const game_id = (await stateP).game_id;
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:reveal', { game_id });
  expect((await errP).code).toBe('bad_state');
  host.close();
});

test('stale game_id from host event is rejected', async () => {
  const q = quiz(); addQ(q.id, 'bride');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const stateP = new Promise(r => host.once('state', r));
  host.emit('host:start');
  await stateP;
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:next', { game_id: 'totally-bogus' });
  expect((await errP).code).toBe('stale_game');
  host.close();
});
