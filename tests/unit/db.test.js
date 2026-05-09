const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

describe('Database Schema', () => {
  test('schema applies cleanly to a fresh in-memory db', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8');
    expect(() => db.exec(schema)).not.toThrow();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const expected of ['quizzes','couple_faces','questions','options','games','players','answers']) {
      expect(tables).toContain(expected);
    }
  });

  test('foreign keys enforced — orphan question rejected', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8'));
    expect(() => db.prepare(
      "INSERT INTO questions (id, quiz_id, position, text, side_tag) VALUES ('q1','missing',1,'?','neutral')"
    ).run()).toThrow();
  });
});
