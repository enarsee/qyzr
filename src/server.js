const path = require('path');
const http = require('http');
const express = require('express');
const config = require('./config');
const { createLimiter, playLimiter, uploadLimiter } = require('./lib/rate-limit');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // Caddy in front sets X-Forwarded-For; required for express-rate-limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Rate limiters (applied before routers)
  app.use('/api/quiz', (req, res, next) => req.method === 'POST' ? createLimiter(req, res, next) : next());
  app.use('/play', playLimiter);
  app.use('/api/upload', uploadLimiter);
  // Routes
  app.use(require('./routes/api'));
  app.use(require('./routes/upload'));
  app.use(require('./routes/pages'));
  return app;
}

function start() {
  const app = buildApp();
  const server = http.createServer(app);
  require('./realtime').attach(server);
  server.listen(config.port, () => {
    console.log(`listening on ${config.publicUrl}`);
  });
  return { app, server };
}

if (require.main === module) start();
module.exports = { buildApp, start };
