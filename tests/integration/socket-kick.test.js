const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const ids = require('../../src/lib/ids');
const playersRepo = require('../../src/repos/players');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

test('kicked player gets player:kicked + disconnected, cannot rejoin', async () => {
  const ct = ids.creatorToken(), rc = ids.roomCode();
  const q = quizzes.create({ name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null, creator_token: ct, room_code: rc });
  questions.create({ quiz_id: q.id, text:'Q?', side_tag:'bride',
    options: [{ text:'a', is_correct:1 }, { text:'b' }] });
  const host = await connect(s.url, { role: 'host', creator_token: ct });
  const sp = await new Promise(r => { host.once('state', r); host.emit('host:start'); });
  const player = await connect(s.url, { role: 'player', room_code: rc });
  const j = await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'Alice', group_value:'1' }); });

  const kickedP = new Promise(r => player.once('player:kicked', r));
  const disconnectP = new Promise(r => player.once('disconnect', r));
  host.emit('host:kick', { game_id: sp.game_id, player_id: j.player_id });
  await kickedP;
  await disconnectP;
  expect(playersRepo.byId(j.player_id).kicked).toBe(1);

  // Reconnect with same token -> auth hard-rejects (kicked) per spec §11
  await expect(connect(s.url, { role: 'player', room_code: rc, player_token: j.player_token }))
    .rejects.toThrow(/kicked/);
  host.close();
});
