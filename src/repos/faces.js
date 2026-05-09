const { randomUUID } = require('crypto');
const { getDb } = require('../db');

const STATES = ['winner', 'happy', 'neutral', 'sad', 'angry'];
const SIDES = ['bride', 'groom'];

function upsert({ quiz_id, side, state, image_path }) {
  if (!SIDES.includes(side)) throw new Error('side_invalid');
  if (!STATES.includes(state)) throw new Error('state_invalid');
  const db = getDb();
  db.prepare('DELETE FROM couple_faces WHERE quiz_id = ? AND side = ? AND state = ?').run(quiz_id, side, state);
  db.prepare('INSERT INTO couple_faces (id, quiz_id, side, state, image_path) VALUES (?,?,?,?,?)')
    .run(randomUUID(), quiz_id, side, state, image_path);
}

function byQuiz(quiz_id) {
  return getDb().prepare('SELECT * FROM couple_faces WHERE quiz_id = ?').all(quiz_id);
}

module.exports = { upsert, byQuiz, STATES, SIDES };
