# Wedding Quiz — Design Spec

**Date:** 2026-05-09
**Status:** Approved (pending review)
**Author:** Nishant + Claude

## 1. Purpose

A self-hostable, Kahoot-style live quiz app, primarily for wedding entertainment but reusable for other group quizzes. Guests join from their phones and answer multiple-choice trivia about the couple. A big-screen TV shows the current question, live vote distribution, leaderboard, and a "Bride vs Groom" panel with mood-shifting face images that react to the score.

Hosted on a Hetzner VPS (Linux) with a custom subdomain and HTTPS via Let's Encrypt. Designed for ~150 concurrent players per game.

## 2. Goals & Non-goals

### Goals
- Anonymous quiz creation — no user accounts, just a unique creator URL.
- Multiple quizzes can coexist; each has its own 6-character room code.
- Host-paced gameplay (no timers per question) with simple 1-point-per-correct scoring.
- Multiple-choice questions with optional images.
- Required "table number" (or configurable group label) on player join, surfaced as a secondary leaderboard.
- "Couple mode": questions tagged Bride/Groom/Neutral, side scores tallied, mood-shifting face images on the display screen reflect the current score differential.
- Wedding-themed UI on a warm ivory/rose/gold palette.
- Single-command Docker deployment behind Caddy with auto-HTTPS.

### Non-goals (v1)
- User accounts / login / email recovery of creator URL.
- Question banks, templates, or quiz cloning.
- Audio or video questions.
- Real-time question editing while a question is live.
- Internationalization.
- Dark mode.
- Player-vs-player chat or messaging.
- Mobile native apps.

## 3. User roles & flows

### Roles
- **Creator/Host** — creates the quiz and runs the game. Identified solely by possession of the creator URL (32-char random token). Same person typically does both jobs but the URL can be shared.
- **Display** — passive read-only screen. Open in any browser at `/display/<room_code>`. No auth required (room code is the secret).
- **Player** — guest on a phone. Joins via `/play` + room code, enters name + table number.

### URLs
| Path | Audience | Auth |
|------|----------|------|
| `/` | Anyone | none |
| `/create` | Creator | none (returns creator URL) |
| `/host/<creator_token>` | Creator | token in URL |
| `/display/<room_code>` | Display TV | room code |
| `/play` | Player | none (form for room code) |
| `/play/<room_code>` | Player (deep link) | room code |

### Flow: creating a quiz
1. Creator visits `/create`, fills form: quiz name, couple names (Bride / Groom labels customizable), accent color choice, hero image upload, group label (default "Table"), 5 face images per side (states: winner / happy / neutral / sad / angry).
2. Server generates `creator_token` (32 chars, base62) and `room_code` (6 chars, base32 minus ambiguous chars), persists to DB.
3. Creator is redirected to `/host/<creator_token>` and shown the room code prominently. The creator URL is presented with a "Copy & save this link" warning.
4. Creator adds questions: text, optional image, 2–4 options, one marked correct, side tag (bride/groom/neutral). Drag-to-reorder.

### Flow: running the game
1. Host clicks **Start game** → status flips to `lobby`. Display screen (already open) transitions to lobby state showing room code + joined players.
2. Players load `/play`, enter room code, name, table number → join the lobby. Late join is allowed at any time.
3. Host clicks **Next question** → first question pushed via Socket.IO to display + all players. Players see question + options; tap to answer.
4. After everyone has answered (or host decides to move on), host clicks **Reveal** → display shows correct answer, vote bars, leaderboard, VS panel. Players see their result + running score.
5. Repeat until questions exhausted or host clicks **Finish**. Final state shows top-3 leaderboard, top-3 tables, winning side.

## 4. Tech stack

| Concern | Choice | Reason |
|---------|--------|--------|
| Runtime | Node.js 20 LTS | Mature, fits Socket.IO well |
| Web framework | Express 4 | Minimal, well-known |
| Realtime | Socket.IO 4 | Best-in-class WebSocket abstraction with rooms |
| Database | SQLite via better-sqlite3 | Zero-ops, fits single-VPS deployment |
| Frontend | Vanilla JS + HTML + CSS | Per user constraint; keeps deploy simple |
| Reverse proxy | Caddy 2 | Auto-HTTPS via Let's Encrypt, ~5 lines of config |
| Container | Docker + docker-compose | One-command deploy on the VPS |
| Image storage | Filesystem (`/data/uploads/`) | Simple; volume-mounted in Docker |
| Charts (display) | Hand-rolled CSS bars | No library needed for simple vote bars |

## 5. Data model

SQLite, foreign keys enforced. UUIDs as TEXT for portability.

```sql
CREATE TABLE quizzes (
  id TEXT PRIMARY KEY,
  creator_token TEXT UNIQUE NOT NULL,
  room_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bride_label TEXT NOT NULL DEFAULT 'Bride',
  groom_label TEXT NOT NULL DEFAULT 'Groom',
  group_label TEXT NOT NULL DEFAULT 'Table',
  accent_color TEXT NOT NULL DEFAULT '#C8587A',
  hero_image_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE couple_faces (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('bride','groom')),
  state TEXT NOT NULL CHECK (state IN ('winner','happy','neutral','sad','angry')),
  image_path TEXT NOT NULL,
  UNIQUE(quiz_id, side, state)
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  image_path TEXT,
  side_tag TEXT NOT NULL CHECK (side_tag IN ('bride','groom','neutral'))
);
CREATE INDEX idx_questions_quiz_position ON questions(quiz_id, position);

CREATE TABLE options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('lobby','active','revealing','finished')),
  current_question_id TEXT REFERENCES questions(id),
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  group_value TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  socket_id TEXT,
  kicked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, name)
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  option_id TEXT NOT NULL REFERENCES options(id),
  correct INTEGER NOT NULL,
  answered_at INTEGER NOT NULL,
  UNIQUE(game_id, question_id, player_id)
);
```

### Derived state (not stored, computed)
- **Player score** — `SELECT SUM(correct) FROM answers WHERE game_id=? AND player_id=?`
- **Side score** — `SELECT SUM(correct) FROM answers a JOIN questions q ON a.question_id=q.id WHERE a.game_id=? AND q.side_tag=?`
- **Side state** — see §7.

### Concurrency rules
- A quiz has **at most one non-finished game at a time.** Starting a new game when one is `lobby|active|revealing` is rejected; host must `Finish` first or use the explicit "Reset & start over" action which marks the existing game `finished` then creates a new row.
- `answers.correct` is **denormalized as a snapshot** — set at the moment the answer is recorded based on the option's `is_correct` flag at that time. Editing `is_correct` of an option that already has answers does **not** retroactively update past `answers.correct`. The host UI hides `is_correct` toggles once any answer references a question (locked-after-played semantics). Question/option *text* edits propagate (purely cosmetic).

## 6. Realtime protocol (Socket.IO)

All sockets join one of three rooms per game: `host:<game_id>`, `display:<game_id>`, or `players:<game_id>`. Some events broadcast to multiple rooms.

### Connection auth
On `connection`, client sends an `auth` payload with one of:
- `{ role: "host", creator_token }` → server resolves quiz by token, joins `host:<game_id>` of the active game.
- `{ role: "display", room_code }` → server resolves game, joins `display:<game_id>`.
- `{ role: "player", room_code, player_token? }` → if `player_token` matches an existing player row in the active game, **rebind**: update `socket_id`, mark online. Otherwise this is a fresh client; player_token will be issued via `player:join`.

Server **verifies the role on every event** — a player socket emitting a `host:*` event is rejected with `error`.

### Client → server
| Event | Payload | Sender | Notes |
|-------|---------|--------|-------|
| `player:join` | `{ name, group_value }` | player (fresh) | server trims+validates name; on `UNIQUE(game_id, name)` collision, **server rejects with `error { code: "name_taken" }`** and the player UI prompts for a different name (no auto-rename). On success, server generates `player_token` (24-char base64url), returns it in `joined` ack so client persists in localStorage. |
| `player:answer` | `{ game_id, question_id, option_id }` | player | rejected if `question_id` ≠ `games.current_question_id` or game not in `active`; duplicates silently dropped |
| `host:start` | `{ }` | host | quiz must have ≥1 question and no active game; creates a `games` row with `status='lobby'`, current_question_id=NULL |
| `host:next` | `{ game_id }` | host | advances to next question by `position`; sets status `lobby|revealing → active`; emits `question:show`. From `revealing`, advances `current_question_id` to next; if no next, no-op (host should call `host:finish`) |
| `host:reveal` | `{ game_id }` | host | only valid when status=`active`; transitions to `revealing`; emits `question:reveal` |
| `host:finish` | `{ game_id }` | host | sets status=`finished`, emits `game:finished`; valid from any non-`finished` state |
| `host:kick` | `{ game_id, player_id }` | host | sets `players.kicked=1`, force-disconnects the socket, broadcasts `player:kicked` |

All host events include `game_id` to prevent stale-tab actions targeting a previous game (e.g. host opened the dashboard, started a game, finished it, then a stale tab tries to act on the old game).

### Server → client
| Event | Payload | Recipients |
|-------|---------|------------|
| `state` | `{ game_id, status, quiz: {name, bride_label, groom_label, group_label, accent_color, hero_image_url}, current_question: {question_id, position, text, image_url, options} \| null, total_questions, players: [{id, name, group_value}], leaderboard, table_leaderboard, side_scores, side_states }` (sensitive fields like `is_correct` omitted unless status=`revealing`/`finished`) | on connect + on every transition. Also re-emitted as a no-op acknowledgement when `host:next` is called with no further questions. |
| `joined` (ack to `player:join`) | `{ player_id, player_token }` | joining player only |
| `player:joined` | `{ player_id, name, group_value }` | host + display |
| `player:left` | `{ player_id, reason: "disconnect"\|"kicked" }` | host + display |
| `player:kicked` | `{ }` | the kicked player only (then socket is closed) |
| `question:show` | `{ question_id, position, text, image_url, options: [{id, position, text}] }` | display + players |
| `answer:received` | `{ question_id, count, total }` | host + display |
| `question:reveal` | `{ question_id, correct_option_id, distribution, leaderboard, table_leaderboard, side_scores, side_states }` | all |
| `game:finished` | `{ leaderboard, table_leaderboard, side_scores, winning_side }` | all |
| `error` | `{ code, message }` | offending sender |

### `answer:received.total` definition
`total` = the count of non-kicked players in the `players:<game_id>` Socket.IO room **at the moment `question:show` was emitted**, snapshotted on the server. Players who join *during* the question are not added to `total` for that question (they appear as a higher `total` next question). This makes "47 / 62 answered" stable for the duration of the question.

### Game state machine
```
                 host:start
   (no game) ───────────────────► lobby
                                     │
                                     │ host:next  (loads first question)
                                     ▼
       ┌───────────────────────► active ─────────┐
       │                            │             │
       │ host:next (next q exists)  │ host:reveal │
       │                            ▼             │
       └────────────────────────  revealing ──────┘
                                     │
                                     │ host:finish (any state)
                                     ▼
                                  finished
```
- From `lobby`: `host:next` → `active` with first question loaded.
- From `active`: `host:reveal` → `revealing`. (Implementations may also accept `host:next` from `active` as "skip without reveal" — out of scope for v1; not implemented.)
- From `revealing`: `host:next` → `active` with next question loaded; if no more questions, host should call `host:finish`.
- `host:finish` is valid from `lobby|active|revealing`.

## 7. Couple-mode mechanic

### Side state computation
Run on every reveal:

```
delta = side_score_bride - side_score_groom
total = max(side_score_bride + side_score_groom, 1)
ratio = delta / total

if ratio > 0.40:   bride=winner, groom=angry
elif ratio > 0.15: bride=happy,  groom=sad
elif ratio > -0.15: bride=neutral, groom=neutral
elif ratio > -0.40: bride=sad,   groom=happy
else:              bride=angry,  groom=winner
```

Thresholds chosen so states change perceptibly across the game without flipping every question.

**Initial state (before any reveals):** both sides render in `neutral`. The VS panel is hidden in lobby state and during the *first* question's `question:show` (i.e. before any `question:reveal` has fired). It first appears in the reveal state of question 1.

### Display rendering
- Two square photos side by side at the bottom of the display, horizontal score bar between them filling proportionally toward the leading side.
- Faces cross-fade (250ms) when state changes. The new face is the one stored for that `(side, state)` key.
- Side currently in `winner` state gets a soft gold glow + small `crown` icon.

### Question tagging
- Every question must be tagged `bride`, `groom`, or `neutral`.
- Tag affects only side scoring. Individual leaderboard awards 1 point for any correct answer regardless of tag.

## 8. UI specification

### Visual system
- **Palette:** ivory bg `#FBF7F2`, surface `#FFFFFF`, ink `#2A1B12`, muted `#8A7A6B`, rose accent `#C8587A`, gold `#B8893A`, bride pink `#D88BA8`, groom teal `#3F6B7B`, success `#3F8A5C`, error `#B5413B`.
- **Type:** Great Vibes (display script) for couple's names + page titles, Cormorant Infant (serif) for question/body text, Inter (sans, 600) for UI chrome (buttons, scores, timers).
- **Shadows:** soft, e.g. `0 4px 20px rgba(42,27,18,0.06)`.
- **Radii:** 12px small, 16px medium, 24px large surfaces.
- **Motion:** 200ms ease-out default; reveal cascade 400ms total. Respect `prefers-reduced-motion`.
- **Icons:** Lucide SVG only — no emoji.

### Creator/Host (desktop web)
- **Edit mode:** top app bar with quiz name, room code chip, "Start game" CTA. Two-column layout: left = drag-orderable question list (60% width), right = sticky question editor (40%).
- **Game mode:** single-column "control deck" — current question card centered, one big primary button cycling **Show question → Reveal → Next**. Live player count chip top-right. Player list collapsible side panel.
- Auto-save drafts on field blur. Inline validation on blur (not keystroke).
- Image upload via dropzone, 5MB limit, MIME-validated, preview inline.

### TV display (read-only)
Three states: lobby, question, reveal.

- **Lobby:** hero image upper half + couple's names in script overlay; large centered card "Join at quiz.example.com — Code: ABC123" (96px+ Inter tabular). Pulsing "32 guests joined" counter.
- **Question:** question text 56–72px, optional image right-of or above. 2×2 grid of option cards (letter + text). Vote bars fill from the bottom of each card as players answer (no exact numbers — preserves suspense). Bottom strip "47 / 62 answered".
- **Reveal:** correct option scales up + glows gold; wrong options desaturate. Vote distribution bars slide in. Right rail: top-5 individual leaderboard. Below: top-5 tables. Bottom: full-width Bride-vs-Groom panel with mood faces.
- All animations 200–400ms ease-out, interruptible, reduced-motion fallback to instant.

### Player (mobile-first)
- **Join screen:** centered card. Name input (autocaps, ≥16px to avoid iOS auto-zoom), table number input (`inputmode="numeric"`), room code (6-char monospace, autoupper). Sticky "Join" button anchored to safe-area inset.
- **Lobby:** hero image, "Welcome {name} · Table {n}", pulsing waiting indicator.
- **Question:** question text top third, optional image, 4 stacked option buttons (full-width, ≥64px tall). Tap commits — selected option scales 0.97 then back, others fade to 30% opacity. Lock state shows "Answer locked — wait for reveal." Optional `navigator.vibrate(20)` haptic.
- **Reveal:** "Correct! +1" with green Lucide `check-circle`, or "Not quite" with red Lucide `x-circle` (color is always paired with icon — never color-only). Running rank + side score below.
- Reconnect handling: socket disconnect → "Reconnecting…" banner; queued answer resends on reconnect.

### Accessibility
- All live updates use `aria-live="polite"`.
- Correct/wrong indicators always pair color with icon.
- Focus rings visible on creator dashboard (≥2px, ink color).
- Contrast verified ≥4.5:1 for body text, ≥3:1 for large display text.
- `prefers-reduced-motion` disables transitions/animations.
- Keyboard-navigable forms; tab order matches visual order.

## 9. Security

### Threat model
- Single-tenant VPS, internet-facing. Adversaries: internet randos who guess room codes; nosy guests who try to access the host panel; the wedding's own goofball who might spam answers.

### Mitigations
- **Creator token** — 32-char base62 (~190 bits). Treated as a bearer secret. URL-only; never logged.
- **Room code** — 6-char base32 minus `0/O/1/I` (~30 bits). Sufficient for guess-resistance over a ~6h event.
- **Rate limits:**
  - HTTP: `express-rate-limit` middleware. `/create` 10/hour/IP, `/play/*` 30/min/IP, image upload 20/hour/IP.
  - Socket connection: a custom Express middleware on the HTTP-upgrade path tracks IP → connection-rate (60/min/IP) using a per-process `lru-cache` (max 10,000 entries, 5-minute TTL). Excess upgrades are rejected with HTTP 429.
  - `player:answer`: server-side dedupe via `UNIQUE(game_id, question_id, player_id)` constraint; duplicate INSERT is caught and silently dropped. Independent of this, each player socket is throttled to **5 emits/sec** for any event (token-bucket per socket) to prevent flooding.
  - `host:*` events: throttled to 10/sec per host socket.
- **Image upload validation:** MIME sniffed via magic bytes (not just extension); reject anything not `image/jpeg|png|webp`; max 5MB; resize/strip EXIF on upload via `sharp` (privacy + size).
- **Input validation:** all string fields trimmed and length-capped (name ≤30, group_value ≤10, question text ≤300, option text ≤120).
- **No SQL string interpolation:** all queries parameterized.
- **CSRF:** non-issue — host actions go via Socket.IO with token in auth payload, not cookies. `/create` uses POST with same-origin check.
- **HTTPS only:** Caddy redirects HTTP → HTTPS; `Strict-Transport-Security` header set.
- **Secrets:** no API keys needed for v1. Creator tokens generated via `crypto.randomBytes(24).toString('base64url')`.

### What we accept
- Anyone with the room code can join as a player. That's by design (guests don't have invites).
- Anyone with the room code can open `/display`. Also by design.
- A guest who finds the creator URL (e.g. you screen-shared it accidentally) can host the quiz. Document this.

## 10. Deployment

### Architecture
```
Internet → Hetzner VPS:80,443 → Caddy (auto-HTTPS) → app:3000 (Node)
                                  └─> /uploads (static)
                                  └─> /sqlite mounted volume
```

### docker-compose.yml (sketch)
```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - PUBLIC_URL=https://quiz.example.com
    volumes:
      - ./data:/data
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./data/uploads:/srv/uploads:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

### Caddyfile
```
quiz.example.com {
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000"

  # Uploaded images served as static files (volume-mounted from app container).
  handle_path /uploads/* {
    root * /srv/uploads
    file_server
  }

  # Everything else (HTML, /api, /socket.io WebSockets) goes to the app.
  reverse_proxy app:3000
}
```
The `caddy` service mounts the app container's `/data/uploads` as `/srv/uploads` (read-only) so it can serve images directly without round-tripping through Node. The architecture diagram in this section reflects that path.

### Steps (documented in DEPLOY.md)
1. Point DNS A record `quiz.example.com` → VPS IP.
2. SSH to VPS, install Docker.
3. Clone repo, copy `.env.example` to `.env` (no secrets needed for v1 but reserved).
4. Edit `Caddyfile` with actual subdomain.
5. `docker compose up -d`.
6. Caddy auto-provisions Let's Encrypt cert on first request.

### Backup
- The `./data` volume contains SQLite DB + uploaded images. Recommend `tar + scp` before the wedding.

## 11. Testing strategy

- **Unit tests** (Jest) for: side-state computation, score aggregation, room-code generation, input validators, snapshot semantics of `answers.correct`.
- **Integration tests** for:
  - REST endpoints (create quiz, upload image, fetch quiz, edit question, image MIME validation)
  - Socket.IO event flows: join → answer → reveal full lifecycle
  - **Auth enforcement** — player socket emitting `host:*` is rejected; host socket with bad/missing creator_token cannot join host room; stale `game_id` in host event is rejected
  - **Reconnect path** — player joins, gets player_token, disconnects, reconnects with token, rebinds to existing player row (no duplicate row, scores preserved)
  - **Kick path** — kicked player is disconnected, marked kicked, cannot rejoin with same token
  - Game state machine — invalid transitions (e.g. `host:reveal` while in `lobby`) rejected
- **Manual smoke test on the day-1 build:** open display + 3 player tabs locally, run a 5-question game end-to-end including a forced disconnect/reconnect of one player.
- **Load test (lightweight):** Artillery script simulating 150 players joining + answering one question; verify latency and no dropped events on a CX11-class VPS.

## 12. Out-of-scope risks (acknowledge)

- **Lost creator URL** — documented as user responsibility. Add to creation success page: "Bookmark this link. We can't recover it."
- **Server restart mid-game** — game state is mirrored from SQLite, so on reboot the game can resume from the last persisted question. Active socket connections drop and reconnect; queued answers retry.
- **Network flakiness for guests** — Socket.IO reconnects automatically; queued answers preserved client-side.
- **VPS dies during the wedding** — out of scope for v1. Mitigated by: deploying days early, smoke-testing, having a local-network fallback (run the same Docker stack on a laptop on hotel Wi-Fi).

## 13. Open questions / future work

- Email-based recovery of creator URL.
- Question banks / templates / clone-quiz.
- Audio/video questions.
- Real-time question editing while a question is live.
- Player avatars (random whimsical illustrations on join).
- Post-game export (CSV of answers, photo of final leaderboard).
- Themes beyond wedding (configurable palette presets).
