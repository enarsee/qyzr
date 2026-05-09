const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  applyAdditiveMigrations(db);
  return db;
}

// Lightweight, idempotent migrations for additive columns on existing DBs.
function applyAdditiveMigrations(db) {
  const cols = db.prepare("PRAGMA table_info(questions)").all().map(c => c.name);
  if (!cols.includes('is_trivia')) {
    db.exec("ALTER TABLE questions ADD COLUMN is_trivia INTEGER NOT NULL DEFAULT 0");
  }
}

let _db;
function getDb() {
  if (!_db) _db = open(path.join(config.dataDir, 'quiz.db'));
  return _db;
}

// For tests: reset to a fresh in-memory or temp file db.
function _setDbForTesting(db) { _db = db; }

module.exports = { getDb, _setDbForTesting, open };
