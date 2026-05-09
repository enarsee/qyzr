const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function record({ game_id, question_id, player_id, option_id, correct }) {
  try {
    getDb().prepare(`INSERT INTO answers (id, game_id, question_id, player_id, option_id, correct, answered_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), game_id, question_id, player_id, option_id, correct ? 1 : 0, Date.now());
    return { recorded: true };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return { recorded: false, reason: 'duplicate' };
    throw e;
  }
}

function countForQuestion(game_id, question_id) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM answers WHERE game_id = ? AND question_id = ?').get(game_id, question_id).n;
}

function distribution(game_id, question_id) {
  return getDb().prepare(`
    SELECT option_id, COUNT(*) AS n FROM answers
    WHERE game_id = ? AND question_id = ?
    GROUP BY option_id
  `).all(game_id, question_id);
}

function leaderboard(game_id) {
  return getDb().prepare(`
    SELECT p.id, p.name, p.group_value, COALESCE(SUM(a.correct), 0) AS score
    FROM players p
    LEFT JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.id
    ORDER BY score DESC, p.joined_at ASC
  `).all(game_id);
}

function tableLeaderboard(game_id) {
  return getDb().prepare(`
    SELECT p.group_value, SUM(a.correct) AS score
    FROM players p
    JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.group_value
    ORDER BY score DESC
  `).all(game_id);
}

function sideScores(game_id) {
  const rows = getDb().prepare(`
    SELECT q.side_tag AS side, COALESCE(SUM(a.correct), 0) AS score
    FROM answers a JOIN questions q ON a.question_id = q.id
    WHERE a.game_id = ?
    GROUP BY q.side_tag
  `).all(game_id);
  const out = { bride: 0, groom: 0 };
  for (const r of rows) if (r.side === 'bride' || r.side === 'groom') out[r.side] = r.score;
  return out;
}

function playerScore(game_id, player_id) {
  return getDb().prepare('SELECT COALESCE(SUM(correct), 0) AS score FROM answers WHERE game_id = ? AND player_id = ?')
    .get(game_id, player_id).score;
}

module.exports = { record, countForQuestion, distribution, leaderboard, tableLeaderboard, sideScores, playerScore };
