# qyzr (wedding-quiz)

Self-hostable Kahoot-style live quiz/poll app, originally built for a wedding (Akriti & Ankit, May 2026) and now productionizing.

- **Production**: https://qyzr.app
- **Repo**: https://github.com/enarsee/qyzr (default branch: `dev`)
- **Default working branch**: `dev` (no `main` yet)
- **Host VPS**: Hetzner, `5.223.61.145`, code at `/opt/qyzr`

For session-to-session memory (what was last done, current parking lot, post-event learnings), see [`.claude/CONTEXT.md`](.claude/CONTEXT.md).

---

## Stack

- **Runtime**: Node.js 20, Express, Socket.IO
- **DB**: SQLite via `better-sqlite3`, WAL mode, file at `data/quiz.db`
- **Frontend**: vanilla JS / HTML / CSS — no build step, just `public/<role>/app.js` loaded by `<role>/index.html`
- **Auth**: creator_token in URL for hosts, signed cookie for `/admin`, room_code for players
- **Deploy**: Docker + Caddy reverse-proxy on `qyzr.app`; LE TLS handled by Caddy

## Repo layout

```
src/
  server.js              # Express bootstrap + Socket.IO attach
  config.js              # env-driven config
  db/                    # schema.sql + open()/migrations
  repos/                 # one file per table: quizzes, games, players, questions,
                         # options, answers, faces, secrets
  realtime/              # Socket.IO: index.js attach, auth.js, state.js, handlers/
  routes/                # api.js, upload.js, export.js, admin.js, ai.js, pages.js
  lib/                   # validators, rate-limit, ids, side-state, gemini, admin-auth
public/
  shared/                # styles.css, icons.js, socket.js (WQ_connect + WQ_statusBanner)
  index.html             # landing
  create/                # quiz creation form
  host/                  # host control panel (creator_token gated)
  present/               # full-screen presenter view
  display/               # public room display (room_code)
  play/                  # guest player
  join/                  # QR join landing
  admin/                 # /admin/secrets HTML
tests/
  unit/                  # validators, repos, reveal logic, side-state
  integration/           # full server + socket flows
docs/                    # spec, deploy notes
data/                    # SQLite + uploads (gitignored)
docker-compose.yml       # app + caddy services
Caddyfile                # reverse proxy + TLS
```

## Common commands

### Dev
```bash
npm start                    # plain run
npm run dev                  # node --watch (auto-restart on save)
npm test                     # jest (76 tests as of 2026-05-12)
npm run test:watch
npx jest tests/path/file.test.js   # single file
```

### Operating local DB
```bash
node -e 'const db=require("better-sqlite3")("data/quiz.db",{readonly:true}); console.log(db.prepare("SELECT id, name, room_code, creator_token FROM quizzes ORDER BY created_at DESC LIMIT 5").all());'
```

### Deploy to prod
```bash
# Push first, then pull+rebuild on VPS. NOTE: no -i flag — 1Password SSH agent supplies the Hetzner key.
git push origin dev && ssh root@5.223.61.145 "cd /opt/qyzr && git pull --ff-only origin dev && docker compose up -d --build"
```

### Verify prod
```bash
curl -sf -o /dev/null -w "%{http_code}\n" https://qyzr.app/
ssh root@5.223.61.145 "docker compose -f /opt/qyzr/docker-compose.yml ps && docker exec qyzr-app-1 grep -c '<some marker>' /app/src/<file>"
```

### Inspect prod DB safely
```bash
# Read-only via node inside the container. Never `cat` /opt/qyzr/.env (contains secrets).
ssh root@5.223.61.145 "docker exec qyzr-app-1 node -e \"const db=require('better-sqlite3')('/app/data/quiz.db',{readonly:true}); console.log(db.prepare('SELECT ...').all());\""
```

## Auth & secrets model

- **`creator_token`** in URL grants host control of one quiz (lives forever, treat as a bearer token).
- **`room_code`** (6-char alphanumeric) is the public join code shown on the display.
- **`player_token`** in client localStorage allows reconnect; scoped per-room (`wq_player_token:<ROOM>`).
- **Admin** at `/admin/login` is gated by `ADMIN_PASSWORD` (env var on VPS). Session is HMAC-signed cookie, 7-day TTL.
  - Current prod password is documented in `.claude/CONTEXT.md`.
- **App-wide secrets** (e.g. `GEMINI_API_KEY`) live in the SQLite `secrets` table, managed via `/admin/secrets`. The values are write-only via the API — never returned in list responses.
  - Admin password also serves as the session-signing secret (rotating password invalidates sessions automatically).

## AI features

Both endpoints read `GEMINI_API_KEY` from `secrets` table (falls back to env for local dev). Model: `gemini-2.5-flash-image` (Nano Banana).

- `POST /api/quiz/:token/q/:qid/generate-image` — single scene image for a question. Requires `quiz.couple_image_path` (uploaded under Branding).
- `POST /api/quiz/:token/generate-sprites` — SSE stream, 10 generations (5 emotions × bride/groom) in parallel. Body needs bride + groom photo paths.

Both are rate-limited via `aiLimiter` (60/hr/IP).

## Realtime (Socket.IO) shape

- Auth via handshake: `{ role: 'host'|'display'|'player', creator_token?, room_code?, player_token? }`
- Rooms: `host:<game_id>`, `display:<game_id>`, `players:<game_id>`
- Events worth knowing: `state`, `question:show`, `question:reveal`, `answer:received`, `game:finished`, `player:joined|left|kicked`
- On reconnect with `player_token`, the server rebinds and emits `state` including `my_answer_option_id` if mid-question.

## Common pitfalls

- **Don't use `ssh -i`** for the Hetzner box. The local `~/.ssh/id_ed25519` is a different key; the matching key is in 1Password's SSH agent. Plain `ssh root@5.223.61.145` works.
- **Don't `cat /opt/qyzr/.env`** — it has live secrets that shouldn't leak into the transcript. Use `grep -q` for existence checks; mutate idempotently.
- **Don't kill arbitrary `node` processes** — check what's running with `ps aux | grep "node src/server.js"` first; the user may have a dev server up.
- **WAL mode**: `quiz.db-wal` and `quiz.db-shm` belong to SQLite. Don't commit, don't move while the app is running.
- **Test fixtures**: quiz `5aca2ea1-...` with creator_token `_tcEC_dgDlrC9eCiTR9n7PLbUfxxYAT3` is the local smoke-test quiz. Don't rely on it existing in prod (it doesn't).

## Testing approach

- Unit tests for pure logic (validators, side-state, reveal math).
- Integration tests boot a real server + better-sqlite3 in a temp dir + real Socket.IO clients. See `tests/integration/socket-player.test.js` as a template for any new realtime feature.
- Browser flows: only one Playwright config exists (`npm run e2e`) — used sparingly. Most UI verification is screenshot-only via Claude's Playwright MCP.

## Release / promotion

There's currently only `dev`. As we productionize, expect to add a `main` and a release flow. See `.claude/CONTEXT.md` for the parking lot.
