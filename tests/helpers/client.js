const { io } = require('socket.io-client');

function connect(url, auth) {
  return new Promise((resolve, reject) => {
    const s = io(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', err => reject(err));
  });
}

module.exports = { connect };
