/**
 * Stress test the live realtime path with N players.
 * Usage:
 *   PROD=1 node scripts/loadtest.js               # against https://qyzr.app
 *   N=150 node scripts/loadtest.js                # specify guest count
 *   HOST_TOKEN=... ROOM_CODE=... node ...          # use an existing quiz/game
 *
 * If HOST_TOKEN+ROOM_CODE are not provided, the script creates a fresh
 * quiz, adds one question, starts a game, runs the test, then finishes.
 *
 * What it measures:
 *   - join latency (ms): handshake + player:join ack
 *   - answer roundtrip (ms): emit player:answer → corresponding answer:received via host
 *   - drops: how many of the N players never received a question:show or
 *            never had their answer counted
 *
 * Requires: socket.io-client (already in devDependencies).
 */

const { io } = require('socket.io-client');
const https = require('https');
const http = require('http');

const N = parseInt(process.env.N || '150', 10);
const PROD = !!process.env.PROD;
const BASE = PROD ? 'https://qyzr.app' : 'http://localhost:3000';
const WS = BASE; // socket.io-client picks scheme from URL

function httpJSON(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const lib = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request({
      method, hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: {
        'content-type': 'application/json',
        'content-length': data ? Buffer.byteLength(data) : 0,
        ...extraHeaders
      }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${method} ${path}: ${res.statusCode} ${buf}`));
        try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b) => a-b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
}

async function setupQuiz() {
  console.log(`[setup] creating quiz against ${BASE}…`);
  const quiz = await httpJSON('POST', '/api/quiz', { name: `Loadtest ${Date.now()}` });
  console.log(`[setup] token=${quiz.creator_token.slice(0,8)}… code=${quiz.room_code}`);
  await httpJSON('POST', `/api/quiz/${quiz.creator_token}/question`, {
    text: 'Loadtest Q?',
    options: [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }]
  });
  return { creator_token: quiz.creator_token, room_code: quiz.room_code };
}

async function main() {
  console.log(`Loadtest: ${N} players against ${BASE}`);

  // Wait for any prior rate-limit window to clear (LRU resets when no
  // connection from this IP for 60s).
  if (process.env.WARMUP !== '0') {
    console.log('[warmup] waiting 70s for rate-limit window to clear…');
    await new Promise(r => setTimeout(r, 70000));
  }

  const { creator_token, room_code } = process.env.HOST_TOKEN && process.env.ROOM_CODE
    ? { creator_token: process.env.HOST_TOKEN, room_code: process.env.ROOM_CODE }
    : await setupQuiz();

  // Connect host
  console.log('[host] connecting…');
  const t0 = Date.now();
  const host = io(WS, { auth: { role: 'host', creator_token }, transports: ['websocket'], forceNew: true });
  await new Promise((res, rej) => { host.once('connect', res); host.once('connect_error', rej); });
  console.log(`[host] connected in ${Date.now() - t0}ms`);

  // Start game (creates a new game with status=lobby)
  let gameId = null;
  await new Promise((res) => {
    host.once('state', (s) => { gameId = s.game_id; res(); });
    host.emit('host:start');
  });
  console.log(`[host] game started, gameId=${gameId}`);

  // Track answer:received counts
  let answerReceivedCount = 0;
  const recvLatencies = [];
  const answeredAt = new Map(); // player_id -> emit ts (for latency)
  host.on('answer:received', () => { answerReceivedCount++; });

  // Track question:show for current question id
  let questionId = null;
  let firstOptionId = null;
  const showAt = new Map(); // player socket index -> Date.now()

  // Spawn players paced to stay under the 60-conn/min/IP socket limit (~50/min target)
  // and simulate realistic wedding-guest arrival cadence.
  console.log(`[players] spawning ${N} players paced @ ~50/min (~3 min total)…`);
  const players = [];
  const joinLatencies = [];
  const errors = [];
  const PACE_MS = 1500; // 40/min — comfortable under 60/min server cap

  const spawnOne = async (i) => {
    const tStart = Date.now();
    const sock = io(WS, { auth: { role: 'player', room_code }, transports: ['websocket'], forceNew: true });
    try {
      await new Promise((res, rej) => {
        sock.once('connect', res);
        sock.once('connect_error', rej);
        setTimeout(() => rej(new Error('connect timeout')), 10000);
      });
      const joined = await new Promise((res, rej) => {
        sock.once('joined', res);
        sock.once('error', rej);
        sock.emit('player:join', { name: `Guest${i.toString().padStart(3,'0')}`, group_value: String((i % 12) + 1) });
        setTimeout(() => rej(new Error('join timeout')), 8000);
      });
      joinLatencies.push(Date.now() - tStart);
      sock.on('question:show', (q) => {
        showAt.set(i, Date.now());
        if (!questionId) { questionId = q.question_id; firstOptionId = q.options[0].id; }
      });
      players.push({ i, sock, player_id: joined.player_id });
    } catch (e) {
      errors.push({ i, msg: e.message });
      try { sock.close(); } catch {}
    }
  };

  // Fire spawns at pace; don't await each individually so multiple can be in-flight.
  const spawnPromises = [];
  for (let i = 0; i < N; i++) {
    spawnPromises.push(spawnOne(i));
    if ((i + 1) % 10 === 0) process.stdout.write(`${i+1} `);
    await new Promise(r => setTimeout(r, PACE_MS));
  }
  await Promise.all(spawnPromises);
  process.stdout.write('\n');
  console.log(`[players] ${players.length}/${N} joined; ${errors.length} errors`);
  if (errors.length) console.log('  sample errors:', errors.slice(0,3));

  // Show question
  console.log('[host] sending question…');
  host.emit('host:next', { game_id: gameId });
  await new Promise(r => setTimeout(r, 1500)); // let everyone receive question:show

  const playersWithShow = players.filter(p => showAt.has(p.i)).length;
  console.log(`[players] ${playersWithShow}/${players.length} received question:show`);

  // All answer at once
  console.log('[players] firing answers…');
  const answerStart = Date.now();
  for (const p of players) {
    answeredAt.set(p.player_id, Date.now());
    p.sock.emit('player:answer', { game_id: gameId, question_id: questionId, option_id: firstOptionId });
  }
  // Wait for answer:received to settle
  await new Promise(r => setTimeout(r, 3000));
  const answerEnd = Date.now();

  console.log(`[host] answer:received fired ${answerReceivedCount} times over ${answerEnd - answerStart}ms`);

  // Reveal
  host.emit('host:reveal', { game_id: gameId });
  await new Promise(r => setTimeout(r, 500));
  host.emit('host:finish', { game_id: gameId });
  await new Promise(r => setTimeout(r, 500));

  // Tear down
  for (const p of players) p.sock.close();
  host.close();

  // Report
  console.log('\n=== Results ===');
  console.log(`Players spawned          : ${players.length}/${N}  (errors: ${errors.length})`);
  console.log(`question:show received   : ${playersWithShow}/${players.length}  (drop rate: ${((1 - playersWithShow/players.length) * 100).toFixed(1)}%)`);
  console.log(`answer:received count    : ${answerReceivedCount}/${players.length}  (drop rate: ${((1 - answerReceivedCount/players.length) * 100).toFixed(1)}%)`);
  console.log(`Join latency  p50/p95/p99: ${pct(joinLatencies, 50)} / ${pct(joinLatencies, 95)} / ${pct(joinLatencies, 99)} ms`);
  console.log(`Answer fan-in window     : ${answerEnd - answerStart} ms`);
}

process.on('unhandledRejection', (r) => { console.error('UNHANDLED REJECTION:', r); });
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e); });
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
