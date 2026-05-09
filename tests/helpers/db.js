const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { _setDbForTesting } = require('../../src/db');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8'));
  _setDbForTesting(db);
  return db;
}

module.exports = { freshDb };
