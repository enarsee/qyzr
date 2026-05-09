const answers = require('../repos/answers');

function buildRevealPayload(game_id, question_id) {
  return {
    question_id,
    correct_option_id: null,
    distribution: answers.distribution(game_id, question_id),
    leaderboard: answers.leaderboard(game_id),
    table_leaderboard: answers.tableLeaderboard(game_id),
    side_scores: answers.sideScores(game_id),
    side_states: { bride: 'neutral', groom: 'neutral' }
  };
}

module.exports = { buildRevealPayload };
