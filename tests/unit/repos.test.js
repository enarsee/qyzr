const { freshDb } = require('../helpers/db');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const players = require('../../src/repos/players');
const answers = require('../../src/repos/answers');

beforeEach(() => freshDb());

function makeQuiz() {
  const { id } = quizzes.create({
    name: 'N', bride_label: 'B', groom_label: 'G', group_label: 'Table',
    accent_color: '#000', hero_image_path: null,
    creator_token: 'ctok'.padEnd(32, 'x'), room_code: 'ABC234'
  });
  return id;
}

test('quizzes.create + lookups', () => {
  const id = makeQuiz();
  expect(quizzes.byId(id).name).toBe('N');
  expect(quizzes.byCreatorToken('ctok'.padEnd(32, 'x')).id).toBe(id);
  expect(quizzes.byRoomCode('ABC234').id).toBe(id);
});

test('questions.create + listByQuiz orders by position', () => {
  const qz = makeQuiz();
  const a = questions.create({ quiz_id: qz, text: 'A?', side_tag: 'bride', options: [{ text: 'a', is_correct: 1 }, { text: 'b' }] }).id;
  const b = questions.create({ quiz_id: qz, text: 'B?', side_tag: 'groom', options: [{ text: 'a' }, { text: 'b', is_correct: 1 }] }).id;
  const list = questions.listByQuiz(qz);
  expect(list.map(q => q.id)).toEqual([a, b]);
  expect(list[0].options.length).toBe(2);
});

test('questions.reorder updates positions', () => {
  const qz = makeQuiz();
  const a = questions.create({ quiz_id: qz, text: 'A?', side_tag: 'neutral', options: [{ text: 'a' }] }).id;
  const b = questions.create({ quiz_id: qz, text: 'B?', side_tag: 'neutral', options: [{ text: 'b' }] }).id;
  questions.reorder(qz, [b, a]);
  expect(questions.listByQuiz(qz).map(q => q.id)).toEqual([b, a]);
});

test('players.create rejects duplicate name with code name_taken', () => {
  const qz = makeQuiz();
  const g = games.create(qz).id;
  players.create({ game_id: g, name: 'Alice', group_value: '1' });
  expect(() => players.create({ game_id: g, name: 'Alice', group_value: '2' }))
    .toThrow('name_taken');
});

test('answers.record dedupes per (game, question, player)', () => {
  const qz = makeQuiz();
  const q = questions.create({ quiz_id: qz, text: 'Q?', side_tag: 'bride', options: [{ text: 'x', is_correct: 1 }] }).id;
  const opt = questions.byId(q).options[0].id;
  const g = games.create(qz).id;
  const p = players.create({ game_id: g, name: 'A', group_value: '1' }).id;
  const r1 = answers.record({ game_id: g, question_id: q, player_id: p, option_id: opt, correct: true });
  const r2 = answers.record({ game_id: g, question_id: q, player_id: p, option_id: opt, correct: true });
  expect(r1.recorded).toBe(true);
  expect(r2.recorded).toBe(false);
  expect(answers.countForQuestion(g, q)).toBe(1);
});

test('answers.sideScores aggregates by question side_tag', () => {
  const qz = makeQuiz();
  const qb = questions.create({ quiz_id: qz, text: 'b?', side_tag: 'bride', options: [{ text: 'x', is_correct: 1 }] }).id;
  const qg = questions.create({ quiz_id: qz, text: 'g?', side_tag: 'groom', options: [{ text: 'x', is_correct: 1 }] }).id;
  const g = games.create(qz).id;
  const p = players.create({ game_id: g, name: 'A', group_value: '1' }).id;
  const optB = questions.byId(qb).options[0].id;
  const optG = questions.byId(qg).options[0].id;
  answers.record({ game_id: g, question_id: qb, player_id: p, option_id: optB, correct: true });
  answers.record({ game_id: g, question_id: qg, player_id: p, option_id: optG, correct: true });
  expect(answers.sideScores(g)).toEqual({ bride: 1, groom: 1 });
});
