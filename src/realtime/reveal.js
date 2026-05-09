const answers = require('../repos/answers');
const questions = require('../repos/questions');
const { computeSideStates } = require('../lib/side-state');

function buildRevealPayload(game_id, question_id) {
  const q = questions.byId(question_id);
  const correct = q.options.find(o => o.is_correct);
  const sideScores = answers.sideScores(game_id);
  return {
    question_id,
    correct_option_id: correct ? correct.id : null,
    distribution: answers.distribution(game_id, question_id),
    leaderboard: answers.leaderboard(game_id),
    table_leaderboard: answers.tableLeaderboard(game_id),
    side_scores: sideScores,
    side_states: computeSideStates(sideScores.bride, sideScores.groom)
  };
}

module.exports = { buildRevealPayload };
