const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create({ quiz_id, text, image_path, side_tag, options }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE quiz_id = ?').get(quiz_id).m;
    const id = randomUUID();
    db.prepare(`INSERT INTO questions (id, quiz_id, position, text, image_path, side_tag) VALUES (?,?,?,?,?,?)`)
      .run(id, quiz_id, maxPos + 1, text, image_path ?? null, side_tag);
    options.forEach((o, i) => {
      db.prepare(`INSERT INTO options (id, question_id, position, text, is_correct) VALUES (?,?,?,?,?)`)
        .run(randomUUID(), id, i + 1, o.text, o.is_correct ? 1 : 0);
    });
    return id;
  });
  return { id: tx() };
}

function update(id, { text, image_path, side_tag }) {
  const db = getDb();
  const sets = [], values = [];
  if (text !== undefined)       { sets.push('text = ?');       values.push(text); }
  if (image_path !== undefined) { sets.push('image_path = ?'); values.push(image_path); }
  if (side_tag !== undefined)   { sets.push('side_tag = ?');   values.push(side_tag); }
  if (!sets.length) return;
  values.push(id);
  db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function setOptions(question_id, options) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM options WHERE question_id = ?').run(question_id);
    options.forEach((o, i) => {
      db.prepare('INSERT INTO options (id, question_id, position, text, is_correct) VALUES (?,?,?,?,?)')
        .run(randomUUID(), question_id, i + 1, o.text, o.is_correct ? 1 : 0);
    });
  });
  tx();
}

function reorder(quiz_id, ids) {
  const db = getDb();
  const tx = db.transaction(() => {
    ids.forEach((qid, i) => {
      db.prepare('UPDATE questions SET position = ? WHERE id = ? AND quiz_id = ?').run(i + 1, qid, quiz_id);
    });
  });
  tx();
}

function remove(id) {
  getDb().prepare('DELETE FROM questions WHERE id = ?').run(id);
}

function listByQuiz(quiz_id) {
  const db = getDb();
  const qs = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position').all(quiz_id);
  const opts = db.prepare('SELECT * FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?) ORDER BY position').all(quiz_id);
  const byQ = {};
  for (const o of opts) (byQ[o.question_id] ||= []).push(o);
  return qs.map(q => ({ ...q, options: byQ[q.id] || [] }));
}

function byId(id) {
  const db = getDb();
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!q) return null;
  q.options = db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY position').all(id);
  return q;
}

function nextAfter(quiz_id, current_question_id) {
  const db = getDb();
  if (!current_question_id) {
    return db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position LIMIT 1').get(quiz_id) || null;
  }
  const cur = db.prepare('SELECT position FROM questions WHERE id = ?').get(current_question_id);
  if (!cur) return null;
  return db.prepare('SELECT * FROM questions WHERE quiz_id = ? AND position > ? ORDER BY position LIMIT 1').get(quiz_id, cur.position) || null;
}

function hasAnswers(question_id) {
  return !!getDb().prepare('SELECT 1 FROM answers WHERE question_id = ? LIMIT 1').get(question_id);
}

module.exports = { create, update, setOptions, reorder, remove, listByQuiz, byId, nextAfter, hasAnswers };
