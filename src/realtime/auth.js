const quizzes = require('../repos/quizzes');
const games = require('../repos/games');
const players = require('../repos/players');

function resolveAuth(handshakeAuth) {
  const a = handshakeAuth || {};
  if (a.role === 'host') {
    if (typeof a.creator_token !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byCreatorToken(a.creator_token);
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id); // may be null pre-start
    return { role: 'host', quiz_id: quiz.id, game_id: game ? game.id : null };
  }
  if (a.role === 'display') {
    if (typeof a.room_code !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byRoomCode(a.room_code.toUpperCase());
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id);
    return { role: 'display', quiz_id: quiz.id, game_id: game ? game.id : null };
  }
  if (a.role === 'player') {
    if (typeof a.room_code !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byRoomCode(a.room_code.toUpperCase());
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id);
    if (!game) throw new Error('no_active_game');
    let existing = null;
    if (typeof a.player_token === 'string') {
      const p = players.byToken(a.player_token);
      if (p && p.game_id === game.id) {
        if (p.kicked) throw new Error('kicked');
        existing = p;
      }
    }
    return { role: 'player', quiz_id: quiz.id, game_id: game.id, existing_player: existing };
  }
  throw new Error('auth_invalid');
}

module.exports = { resolveAuth };
