const http = require('http');
const { buildApp } = require('../../src/server');
const realtime = require('../../src/realtime');

async function startTestServer() {
  const app = buildApp();
  const server = http.createServer(app);
  realtime.attach(server);
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  return {
    app,
    server,
    port,
    url: `http://localhost:${port}`,
    close: () => new Promise(r => server.close(r))
  };
}

module.exports = { startTestServer };
