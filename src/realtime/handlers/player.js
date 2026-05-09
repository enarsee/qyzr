const players = require('../../repos/players');
const games = require('../../repos/games');
const questions = require('../../repos/questions');
const answers = require('../../repos/answers');
const v = require('../../lib/validators');
const { buildStatePayload, getTotal } = require('../state');

function register(io, socket) {
  const ctx = socket.data.ctx;

  // If reconnect with player_token, rebind immediately.
  if (ctx.role === 'player' && ctx.existing_player) {
    const p = ctx.existing_player;
    players.bindSocket(p.id, socket.id);
    ctx.player_id = p.id;
    socket.join(`players:${ctx.game_id}`);
    socket.emit('joined', { player_id: p.id, player_token: p.player_token });
    socket.emit('state', buildStatePayload({ game_id: ctx.game_id, includeCorrect: false }));
    io.to(`host:${ctx.game_id}`).emit('player:joined', { player_id: p.id, name: p.name, group_value: p.group_value });
    io.to(`display:${ctx.game_id}`).emit('player:joined', { player_id: p.id, name: p.name, group_value: p.group_value });
  }

  socket.on('player:join', ({ name, group_value } = {}) => {
    if (ctx.role !== 'player') { socket.emit('error', { code: 'forbidden' }); return; }
    if (ctx.player_id) { socket.emit('error', { code: 'already_joined' }); return; }
    try {
      const cleanName = v.validateName(name);
      const cleanGv = v.validateGroupValue(group_value);
      const { id, player_token } = players.create({ game_id: ctx.game_id, name: cleanName, group_value: cleanGv });
      players.bindSocket(id, socket.id);
      ctx.player_id = id;
      socket.join(`players:${ctx.game_id}`);
      socket.emit('joined', { player_id: id, player_token });
      socket.emit('state', buildStatePayload({ game_id: ctx.game_id, includeCorrect: false }));
      io.to(`host:${ctx.game_id}`).emit('player:joined', { player_id: id, name: cleanName, group_value: cleanGv });
      io.to(`display:${ctx.game_id}`).emit('player:joined', { player_id: id, name: cleanName, group_value: cleanGv });
    } catch (e) {
      socket.emit('error', { code: e.code || e.message });
    }
  });

  socket.on('player:answer', ({ game_id, question_id, option_id } = {}) => {
    if (ctx.role !== 'player') { socket.emit('error', { code: 'forbidden' }); return; }
    if (!ctx.player_id) { socket.emit('error', { code: 'not_joined' }); return; }
    if (game_id !== ctx.game_id) { socket.emit('error', { code: 'stale_game' }); return; }
    const game = games.byId(game_id);
    if (!game || game.status !== 'active' || game.current_question_id !== question_id) {
      socket.emit('error', { code: 'question_not_active' }); return;
    }
    const q = questions.byId(question_id);
    const opt = q.options.find(o => o.id === option_id);
    if (!opt) { socket.emit('error', { code: 'option_not_found' }); return; }
    const result = answers.record({
      game_id, question_id, player_id: ctx.player_id, option_id, correct: !!opt.is_correct
    });
    if (!result.recorded) { return; } // duplicate; drop silently
    const count = answers.countForQuestion(game_id, question_id);
    const total = getTotal(game_id, question_id);
    // option_id is sent only to host + display rooms (not back to players) — guests can't infer others' votes.
    io.to(`host:${game_id}`).emit('answer:received', { question_id, option_id, count, total });
    io.to(`display:${game_id}`).emit('answer:received', { question_id, option_id, count, total });
  });
}

function handleDisconnect(io, socket) {
  const ctx = socket.data.ctx;
  if (!ctx || ctx.role !== 'player' || !ctx.player_id) return;
  players.unbindSocket(socket.id);
  io.to(`host:${ctx.game_id}`).emit('player:left', { player_id: ctx.player_id, reason: 'disconnect' });
  io.to(`display:${ctx.game_id}`).emit('player:left', { player_id: ctx.player_id, reason: 'disconnect' });
}

module.exports = { register, handleDisconnect };
