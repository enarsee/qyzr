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
  // NB: must scope createLimiter to the EXACT path /api/quiz, not the whole
  // /api/quiz/* tree — otherwise question/face/reorder POSTs share the cap
  // (10/hr) with quiz creation, and a host adding 10+ faces gets locked out.
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.path === '/api/quiz') return createLimiter(req, res, next);
    next();
  });
  app.use('/play', playLimiter);
  app.use('/api/upload', uploadLimiter);
  // Routes
  app.use(require('./routes/api'));
  app.use(require('./routes/upload'));
  app.use(require('./routes/export'));
  app.use(require('./routes/admin'));
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
