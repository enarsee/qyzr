const { randomUUID } = require('crypto');
const { getDb } = require('../db');
const { playerToken } = require('../lib/ids');

function create({ game_id, name, group_value }) {
  const id = randomUUID();
  const token = playerToken();
  try {
    getDb().prepare('INSERT INTO players (id, game_id, player_token, name, group_value, joined_at) VALUES (?,?,?,?,?,?)')
      .run(id, game_id, token, name, group_value, Date.now());
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' && /players\.name|game_id, players\.name/.test(e.message)) {
      const err = new Error('name_taken'); err.code = 'name_taken'; throw err;
    }
    throw e;
  }
  return { id, player_token: token };
}

function byToken(token) {
  return getDb().prepare('SELECT * FROM players WHERE player_token = ?').get(token);
}
function byId(id) { return getDb().prepare('SELECT * FROM players WHERE id = ?').get(id); }
function bindSocket(id, socketId) {
  getDb().prepare('UPDATE players SET socket_id = ? WHERE id = ?').run(socketId, id);
}
function unbindSocket(socketId) {
  getDb().prepare('UPDATE players SET socket_id = NULL WHERE socket_id = ?').run(socketId);
}
function listByGame(game_id) {
  return getDb().prepare('SELECT * FROM players WHERE game_id = ? AND kicked = 0 ORDER BY joined_at').all(game_id);
}
function kick(id) {
  getDb().prepare('UPDATE players SET kicked = 1, socket_id = NULL WHERE id = ?').run(id);
}

module.exports = { create, byToken, byId, bindSocket, unbindSocket, listByGame, kick };
