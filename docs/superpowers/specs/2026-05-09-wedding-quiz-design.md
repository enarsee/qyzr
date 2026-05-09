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
  name TEXT NOT NULL,
  group_value TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  socket_id TEXT,
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

## 6. Realtime protocol (Socket.IO)

All sockets join one of two rooms per game: `display:<game_id>` or `players:<game_id>`. Some events go to both.

### Client → server
| Event | Payload | Sender |
|-------|---------|--------|
| `display:join` | `{ room_code }` | display |
| `player:join` | `{ room_code, name, group_value }` | player |
| `player:answer` | `{ option_id }` | player |
| `host:start` | `{ }` | host (authenticated by token) |
| `host:next` | `{ }` | host |
| `host:reveal` | `{ }` | host |
| `host:finish` | `{ }` | host |
| `host:kick` | `{ player_id }` | host |

### Server → client
| Event | Payload | Recipients |
|-------|---------|------------|
| `state` | full game state snapshot | on join + on transition |
| `player:joined` | `{ player_id, name, group_value }` | display + host |
| `player:left` | `{ player_id }` | display + host |
| `question:show` | `{ question, options (no `is_correct`) }` | display + players |
| `answer:received` | `{ count, total }` | display + host |
| `question:reveal` | `{ correct_option_id, distribution, leaderboard, table_leaderboard, side_scores, side_states }` | all |
| `game:finished` | final summary | all |
| `error` | `{ code, message }` | offending sender |

The host channel is authenticated by including the creator token in the connection auth payload. Server verifies on every host-namespaced event.

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
- **Reveal:** "✓ Correct! +1" or "✗ Not quite" with icon (color paired with icon, not color-only). Running rank + side score below.
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
- **Rate limits** (per-IP):
  - `/create`: 10/hour
  - `/play` join: 10/min
  - `player:answer`: server enforces 1 answer per (player, question); duplicates dropped silently.
  - Socket connections: 60/min per IP.
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
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

### Caddyfile
```
quiz.example.com {
  reverse_proxy app:3000
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000"
}
```

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

- **Unit tests** (Jest) for: side-state computation, score aggregation, room-code generation, input validators.
- **Integration tests** for: REST endpoints (create quiz, upload image, fetch quiz), Socket.IO event flows (join → answer → reveal).
- **Manual smoke test on the day-1 build:** open display + 3 player tabs locally, run a 5-question game end-to-end.
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
