const games = require('../../repos/games');
const questions = require('../../repos/questions');
const players = require('../../repos/players');
const { buildStatePayload, snapshotTotal, projectQuestion } = require('../state');
const { buildRevealPayload } = require('../reveal');

function rejectIfNotHost(socket) {
  if (socket.data.ctx.role !== 'host') {
    socket.emit('error', { code: 'forbidden', message: 'host role required' });
    return true;
  }
  return false;
}

function rejectIfStaleGame(socket, game_id) {
  if (socket.data.ctx.game_id && socket.data.ctx.game_id !== game_id) {
    socket.emit('error', { code: 'stale_game', message: 'game_id does not match active game' });
    return true;
  }
  return false;
}

function broadcastState(io, game_id) {
  io.to(`host:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: true }));
  io.to(`display:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: false }));
  io.to(`players:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: false }));
}

function register(io, socket) {
  socket.on('host:start', () => {
    if (rejectIfNotHost(socket)) return;
    const ctx = socket.data.ctx;
    const existing = games.activeForQuiz(ctx.quiz_id);
    if (existing) { socket.emit('error', { code: 'game_exists', message: 'finish current game first' }); return; }
    const all = questions.listByQuiz(ctx.quiz_id);
    if (!all.length) { socket.emit('error', { code: 'no_questions' }); return; }
    const { id: gid } = games.create(ctx.quiz_id);
    ctx.game_id = gid;
    socket.join(`host:${gid}`);
    broadcastState(io, gid);
  });

  socket.on('host:next', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game) { socket.emit('error', { code: 'no_game' }); return; }
    // Per spec §6: host:next is valid only from lobby or revealing.
    if (!['lobby', 'revealing'].includes(game.status)) { socket.emit('error', { code: 'bad_state' }); return; }

    const next = questions.nextAfter(game.quiz_id, game.current_question_id);
    if (!next) {
      broadcastState(io, game_id);
      return;
    }
    games.setStatus(game_id, 'active', next.id);
    snapshotTotal(game_id, next.id);
    const fullNext = questions.byId(next.id);
    const projHost = projectQuestion(fullNext, true);
    const projPub  = projectQuestion(fullNext, false);
    io.to(`host:${game_id}`).emit('question:show', projHost);
    io.to(`display:${game_id}`).emit('question:show', projPub);
    io.to(`players:${game_id}`).emit('question:show', projPub);
    broadcastState(io, game_id);
  });

  socket.on('host:reveal', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game || game.status !== 'active') { socket.emit('error', { code: 'bad_state' }); return; }
    games.setStatus(game_id, 'revealing', game.current_question_id);
    const payload = buildRevealPayload(game_id, game.current_question_id);
    io.to(`host:${game_id}`).emit('question:reveal', payload);
    io.to(`display:${game_id}`).emit('question:reveal', payload);
    io.to(`players:${game_id}`).emit('question:reveal', payload);
    broadcastState(io, game_id);
  });

  socket.on('host:finish', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game || game.status === 'finished') { socket.emit('error', { code: 'bad_state' }); return; }
    games.setStatus(game_id, 'finished', game.current_question_id);
    const final = buildRevealPayload(game_id, game.current_question_id);
    io.to(`host:${game_id}`).emit('game:finished', final);
    io.to(`display:${game_id}`).emit('game:finished', final);
    io.to(`players:${game_id}`).emit('game:finished', final);
    broadcastState(io, game_id);
  });

  socket.on('host:kick', ({ game_id, player_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const p = players.byId(player_id);
    if (!p || p.game_id !== game_id) { socket.emit('error', { code: 'not_found' }); return; }
    players.kick(player_id);
    if (p.socket_id) {
      const sock = io.sockets.sockets.get(p.socket_id);
      if (sock) { sock.emit('player:kicked', {}); sock.disconnect(true); }
    }
    io.to(`host:${game_id}`).emit('player:left', { player_id, reason: 'kicked' });
    io.to(`display:${game_id}`).emit('player:left', { player_id, reason: 'kicked' });
    broadcastState(io, game_id);
  });
}

module.exports = { register, broadcastState };
