const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create({ name, bride_label, groom_label, group_label, accent_color, hero_image_path, creator_token, room_code }) {
  const id = randomUUID();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO quizzes (id, creator_token, room_code, name, bride_label, groom_label, group_label, accent_color, hero_image_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, creator_token, room_code, name, bride_label, groom_label, group_label, accent_color, hero_image_path ?? null, now, now);
  return { id };
}

function byCreatorToken(token) {
  return getDb().prepare('SELECT * FROM quizzes WHERE creator_token = ?').get(token);
}
function byRoomCode(code) {
  return getDb().prepare('SELECT * FROM quizzes WHERE room_code = ?').get(code);
}
function byId(id) {
  return getDb().prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
}

function update(id, fields) {
  const allowed = ['name', 'bride_label', 'groom_label', 'group_label', 'accent_color', 'hero_image_path'];
  const set = [];
  const values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { set.push(`${k} = ?`); values.push(fields[k]); }
  }
  if (!set.length) return;
  set.push('updated_at = ?'); values.push(Date.now());
  values.push(id);
  getDb().prepare(`UPDATE quizzes SET ${set.join(', ')} WHERE id = ?`).run(...values);
}

module.exports = { create, byCreatorToken, byRoomCode, byId, update };
