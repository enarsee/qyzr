const { Server } = require('socket.io');
const { resolveAuth } = require('./auth');

function attach(httpServer) {
  const io = new Server(httpServer, { cors: { origin: false } });

  io.use((socket, next) => {
    try {
      const ctx = resolveAuth(socket.handshake.auth);
      socket.data.ctx = ctx;
      const room = `${ctx.role}:${ctx.game_id || 'pending'}`;
      socket.join(room);
      next();
    } catch (e) {
      next(new Error(e.message));
    }
  });

  io.on('connection', (socket) => {
    const ctx = socket.data.ctx;
    socket.on('disconnect', () => {
      const handlers = require('./handlers/player');
      if (ctx.role === 'player') handlers.handleDisconnect(io, socket);
    });
    require('./handlers/player').register(io, socket);
    require('./handlers/host').register(io, socket);
  });

  return io;
}

module.exports = { attach };
