window.WQ_connect = function(auth) {
  const s = io({ auth, transports: ['websocket'] });
  return s;
};
