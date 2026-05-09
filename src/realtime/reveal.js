const answers = require('../repos/answers');
const questions = require('../repos/questions');
const { computeSideStates } = require('../lib/side-state');

function buildRevealPayload(game_id, question_id) {
  const q = questions.byId(question_id);
  const correct = q.options.find(o => o.is_correct);
  const sideScores = answers.sideScores(game_id);
  const winning_side = sideScores.bride > sideScores.groom
    ? 'bride'
    : sideScores.groom > sideScores.bride
      ? 'groom'
      : 'tie';
  return {
    question_id,
    correct_option_id: correct ? correct.id : null,
    distribution: answers.distribution(game_id, question_id),
    leaderboard: answers.leaderboard(game_id),
    table_leaderboard: answers.tableLeaderboard(game_id),
    side_scores: sideScores,
    side_states: computeSideStates(sideScores.bride, sideScores.groom),
    winning_side
  };
}

module.exports = { buildRevealPayload };
