const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

async function bootstrap() {
  const ct = ids.creatorToken(), rc = ids.roomCode();
  const q = quizzes.create({ name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null, creator_token: ct, room_code: rc });
  questions.create({ quiz_id: q.id, text:'Q1?', side_tag:'bride',
    options: [{ text:'a', is_correct:1 }, { text:'b' }] });
  const host = await connect(s.url, { role: 'host', creator_token: ct });
  const startState = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const sp = await startState;
  return { host, room_code: rc, game_id: sp.game_id, quiz_id: q.id };
}

test('player joins and host receives player:joined', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  const joinedP = new Promise(r => player.once('joined', r));
  const hostNotice = new Promise(r => host.once('player:joined', r));
  player.emit('player:join', { name: 'Alice', group_value: '7' });
  const joined = await joinedP;
  expect(joined.player_token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  const notice = await hostNotice;
  expect(notice.name).toBe('Alice');
  player.close(); host.close();
});

test('duplicate name rejected with name_taken', async () => {
  const { host, room_code } = await bootstrap();
  const a = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { a.once('joined', r); a.emit('player:join', { name: 'Alice', group_value: '1' }); });
  const b = await connect(s.url, { role: 'player', room_code });
  const errP = new Promise(r => b.once('error', r));
  b.emit('player:join', { name: 'Alice', group_value: '2' });
  expect((await errP).code).toBe('name_taken');
  a.close(); b.close(); host.close();
});

test('reconnect with player_token rebinds without duplicate row', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const a = await connect(s.url, { role: 'player', room_code });
  const j = await new Promise(r => { a.once('joined', r); a.emit('player:join', { name: 'Alice', group_value: '1' }); });
  a.close();
  const players = require('../../src/repos/players');
  expect(players.listByGame(game_id).length).toBe(1);
  // Connect with player_token; listen for `joined` before the connection resolves
  const { io: sioClient } = require('socket.io-client');
  const j2 = await new Promise((resolve, reject) => {
    const sock = sioClient(s.url, {
      auth: { role: 'player', room_code, player_token: j.player_token },
      transports: ['websocket'], forceNew: true, reconnection: false
    });
    sock.once('joined', data => resolve({ data, sock }));
    sock.once('connect_error', reject);
  });
  expect(j2.data.player_id).toBe(j.player_id);
  expect(players.listByGame(game_id).length).toBe(1); // still one row
  j2.sock.close(); host.close();
});

test('answer outside active state is rejected', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  // Game is in lobby; emit a fake answer
  const errP = new Promise(r => player.once('error', r));
  player.emit('player:answer', { game_id, question_id: 'whatever', option_id: 'whatever' });
  expect((await errP).code).toBe('question_not_active');
  player.close(); host.close();
});

test('answer dedupe: second answer silently dropped', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  // host:next to make question active
  const showP = new Promise(r => player.once('question:show', r));
  host.emit('host:next', { game_id });
  const shown = await showP;
  const optId = shown.options[0].id;
  // Two answers — second is a duplicate; host receives count=1 only once.
  let received = 0;
  host.on('answer:received', () => received++);
  player.emit('player:answer', { game_id, question_id: shown.question_id, option_id: optId });
  player.emit('player:answer', { game_id, question_id: shown.question_id, option_id: optId });
  await new Promise(r => setTimeout(r, 100));
  expect(received).toBe(1);
  player.close(); host.close();
});

test('player socket emitting host:start is silently ignored (forbidden)', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  const errP = new Promise(r => player.once('error', r));
  player.emit('host:start');
  expect((await errP).code).toBe('forbidden');
  player.close(); host.close();
});
