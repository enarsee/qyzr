const games = require('../repos/games');
const players = require('../repos/players');
const quizzes = require('../repos/quizzes');
const questions = require('../repos/questions');

const totalsByQuestion = new Map(); // game_id:question_id -> total

function snapshotTotal(game_id, question_id) {
  totalsByQuestion.set(`${game_id}:${question_id}`, players.listByGame(game_id).length);
}
function getTotal(game_id, question_id) {
  return totalsByQuestion.get(`${game_id}:${question_id}`) ?? players.listByGame(game_id).length;
}

function buildStatePayload({ game_id, includeCorrect }) {
  const game = games.byId(game_id);
  if (!game) return null;
  const quiz = quizzes.byId(game.quiz_id);
  const all = questions.listByQuiz(quiz.id);
  let current = null;
  if (game.current_question_id) {
    const q = all.find(x => x.id === game.current_question_id);
    if (q) current = projectQuestion(q, includeCorrect);
  }
  const playerList = players.listByGame(game_id).map(p => ({ id: p.id, name: p.name, group_value: p.group_value }));
  return {
    game_id,
    status: game.status,
    quiz: {
      name: quiz.name, bride_label: quiz.bride_label, groom_label: quiz.groom_label,
      group_label: quiz.group_label, accent_color: quiz.accent_color,
      hero_image_url: quiz.hero_image_path
    },
    current_question: current,
    total_questions: all.length,
    players: playerList
  };
}

function projectQuestion(q, includeCorrect) {
  return {
    question_id: q.id,
    position: q.position,
    text: q.text,
    image_url: q.image_path,
    is_trivia: !!q.is_trivia,
    side_tag: q.side_tag || 'neutral',
    options: q.options.map(o => ({
      id: o.id, position: o.position, text: o.text,
      ...(includeCorrect ? { is_correct: !!o.is_correct } : {})
    }))
  };
}

module.exports = { buildStatePayload, snapshotTotal, getTotal, projectQuestion };
