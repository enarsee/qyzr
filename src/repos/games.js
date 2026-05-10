const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create(quiz_id) {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO games (id, quiz_id, status, current_question_id, started_at) VALUES (?,?,?,?,?)`)
    .run(id, quiz_id, 'lobby', null, Date.now());
  return { id };
}
function byId(id) {
  return getDb().prepare('SELECT * FROM games WHERE id = ?').get(id);
}
function activeForQuiz(quiz_id) {
  return getDb().prepare("SELECT * FROM games WHERE quiz_id = ? AND status != 'finished' ORDER BY started_at DESC LIMIT 1").get(quiz_id);
}
function lastFinishedForQuiz(quiz_id) {
  return getDb().prepare("SELECT * FROM games WHERE quiz_id = ? AND status = 'finished' ORDER BY finished_at DESC LIMIT 1").get(quiz_id);
}
function setStatus(id, status, currentQuestionId) {
  const db = getDb();
  const ts = status === 'finished' ? Date.now() : null;
  db.prepare(`UPDATE games SET status = ?, current_question_id = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?`)
    .run(status, currentQuestionId ?? null, ts, id);
}

module.exports = { create, byId, activeForQuiz, lastFinishedForQuiz, setStatus };
