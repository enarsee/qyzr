const { freshDb } = require('../helpers/db');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const players = require('../../src/repos/players');
const answers = require('../../src/repos/answers');
const { buildRevealPayload } = require('../../src/realtime/reveal');
const ids = require('../../src/lib/ids');

beforeEach(() => freshDb());

test('reveal payload returns correct option, distribution, side scores, side states', () => {
  const q = quizzes.create({
    name: 'Q',
    bride_label: 'B',
    groom_label: 'G',
    group_label: 'T',
    accent_color: '#000',
    hero_image_path: null,
    creator_token: ids.creatorToken(),
    room_code: ids.roomCode()
  });
  const qb = questions.create({
    quiz_id: q.id,
    text: 'b?',
    side_tag: 'bride',
    options: [{ text: 'right', is_correct: 1 }, { text: 'wrong' }]
  }).id;
  const game = games.create(q.id);
  games.setStatus(game.id, 'active', qb);
  const p1 = players.create({ game_id: game.id, name: 'A', group_value: '1' }).id;
  const p2 = players.create({ game_id: game.id, name: 'B', group_value: '1' }).id;
  const opts = questions.byId(qb).options;
  answers.record({ game_id: game.id, question_id: qb, player_id: p1, option_id: opts[0].id, correct: true });
  answers.record({ game_id: game.id, question_id: qb, player_id: p2, option_id: opts[1].id, correct: false });

  const r = buildRevealPayload(game.id, qb);
  expect(r.correct_option_id).toBe(opts[0].id);
  expect(r.distribution).toEqual(expect.arrayContaining([
    { option_id: opts[0].id, n: 1 },
    { option_id: opts[1].id, n: 1 }
  ]));
  expect(r.side_scores).toEqual({ bride: 1, groom: 0 });
  expect(r.side_states).toEqual({ bride: 'winner', groom: 'angry' });
  expect(r.leaderboard.length).toBe(2);
});
