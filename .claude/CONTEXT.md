# qyzr — session context

Cross-session memory. Append to the journal, edit the parking lot. Newest entries on top.

This file is committed to the **public** repo. Never inline live secrets here — reference where the value lives (1Password vault, VPS `.env`, etc.) instead.

## Quick prod facts

- **VPS**: `root@5.223.61.145` (1Password SSH agent — plain `ssh`, no `-i`)
- **Path on VPS**: `/opt/qyzr`
- **Domain**: https://qyzr.app
- **`ADMIN_PASSWORD`**: set in `/opt/qyzr/.env` on the VPS; also in 1Password under "qyzr admin" (ask user if you need it). Gates `/admin/*`.
- **`GEMINI_API_KEY`**: managed via https://qyzr.app/admin/secrets (DB-backed, write-only via API).
- **Docker services**: `qyzr-app-1` (Node app) + `qyzr-caddy-1` (TLS reverse proxy).
- **Default branch**: `dev`. No `main` yet.

## Parking lot — productionization

User flagged "I am thinking I can productionize this" right before asking for this workspace. Brainstorm next session:

- [ ] **Multi-tenant**: today one self-hosted instance per event. For SaaS-shaped use, need accounts + plan tier + per-tenant rate limits + creator-token replacement with real auth.
- [ ] **Billing & quotas**: AI image gen costs real money via Gemini. Need usage metering per quiz/account.
- [ ] **Branch flow**: introduce `main` as prod, keep `dev` as integration. CI gate on `main`.
- [ ] **CI**: GitHub Actions to run `jest` on PR + auto-deploy on `main` push.
- [ ] **Backups**: SQLite is one file — nightly snapshot to S3/B2 of `data/`.
- [ ] **Image storage**: `data/uploads/` lives on VPS disk. For multi-instance + cheaper bandwidth, move to object storage with signed URLs.
- [ ] **Observability**: structured logs + something lightweight (Better Stack, Axiom).
- [ ] **Onboarding UX**: the host page is dense. Worth a "wizard mode" for first-time creators.
- [ ] **Marketing site / landing**: today `/` is a bare create page. Productionizing wants a real landing with examples, pricing, FAQ.
- [ ] **Templates**: pre-built quiz packs (wedding, baby shower, birthday) that copy in 10 seconds.

## Journal

### 2026-05-12 — Workspace + productionization prep
- Created `CLAUDE.md` + `.claude/CONTEXT.md` + `.claude/settings.json` so future sessions can pick up cold.
- All four feature phases from 2026-05-11 are live in prod and verified.

### 2026-05-11 — Post-wedding feedback → 4 shipped phases

User reported back after the wedding (which went well overall). Three pieces of feedback drove the day's work, each shipped end-to-end:

**Phase 1 — Reconnect** (commit `1054dd7`)
- *Problem*: clients got disconnected mid-event (mobile screen locks, flaky venue Wi-Fi).
- *Server already had* `player_token`-based rebind in `src/realtime/auth.js`. Gaps were on the client.
- *Shipped*:
  - `WQ_statusBanner(socket)` in `public/shared/socket.js` — soft amber "Reconnecting…" → after 8s sticky rose "Connection lost · Refresh".
  - Wired into play / host / display / present.
  - localStorage key `wq_player_token` is now per-room (`wq_player_token:<ROOM>`) — fixes cross-quiz collision.
  - New `state.my_answer_option_id` server-side (via `answers.byPlayerQuestion()`) so on rejoin mid-question the UI restores the locked-answer state.
  - New integration test in `tests/integration/socket-player.test.js`.

**Phase 2 — Admin secrets** (commit `4f4c376`)
- *Problem*: needed a place to store Gemini API key without every host providing their own.
- *Shipped*:
  - New `secrets` table (`key`, `value`, `updated_at`) via additive migration in `src/db/index.js`.
  - `src/repos/secrets.js` with in-memory cache + invalidation.
  - `src/lib/admin-auth.js` — HMAC-signed cookie sessions, 7-day TTL, session secret derived from `ADMIN_PASSWORD` (rotating PW invalidates all sessions).
  - `src/routes/admin.js`: GET/POST `/admin/login`, POST `/admin/logout`, GET `/admin/secrets` (HTML), GET/PUT/DELETE `/api/admin/secrets[/:key]`.
  - Values are **write-only via API** — list returns only `{key, present, updated_at}`, never the value.
  - `public/admin/secrets.html` — vanilla JS, known-secret promotion (helps surface `GEMINI_API_KEY` with link to AI Studio), custom-key support.

**Phase 3 — AI question scene generation** (commit `a8d2553`)
- *Problem*: at the wedding the user manually generated per-question images via Gemini 2.5 + Nano Banana, using a couple reference photo + a per-question prompt. Worked beautifully but was tedious.
- *Shipped*:
  - New `quizzes.couple_image_path` column (additive migration, stripped from public payload `/api/quiz/by-room/:code`).
  - `src/lib/gemini.js` — thin REST client (no SDK), maps API errors to friendly codes (`api_key_invalid`, `rate_limited`, `content_blocked`, `no_image_returned`).
  - `src/routes/ai.js`: `POST /api/quiz/:token/q/:qid/generate-image` — scene + style (`photorealistic`|`studio`|`whimsical`), validates 3–500 chars, calls Gemini with the couple ref + scene prompt, normalizes WebP, updates `questions.image_path`.
  - Host editor: collapsible ✨ "Generate scene with AI" details block per question.
  - Branding panel: "Couple reference photo" upload alongside Hero image.
  - Rate limit: `aiLimiter` = 60/hr/IP.

**Phase 4 — Sprite-pack wizard** (commit `f6e5160`)
- *Problem*: at the wedding the user manually cropped bride + groom faces, then ran 10 individual Gemini prompts to generate emotion sprites (winner/happy/neutral/sad/angry × 2). Loved the result, hated the manual process.
- *Shipped*:
  - `POST /api/quiz/:token/generate-sprites` — streams 10 generations via Server-Sent Events. Per-emotion prompts shape facial expression; reference photo holds likeness; final style is "cartoonish circular avatar on soft pastel background".
  - Wizard UI in `public/host/app.js`: bride + groom photo uploads → 5×2 grid that fills in as each SSE event arrives, with `N/10 sprites generated…` progress.
  - Outputs land in existing `couple_faces` slots via `faces.upsert`, so the VS panel picks them up automatically.

**Operational notes from the day**
- 1Password SSH agent: lost authorization mid-session, recovered when user touched ID. The Hetzner key is in the agent, not in `~/.ssh/id_ed25519` (which is a different key). **Don't use `-i ~/.ssh/id_ed25519`** — it'll fail with `publickey` errors. Plain `ssh root@5.223.61.145` works.
- `cat /opt/qyzr/.env` is blocked at the harness level (transcript leak risk). Use `grep -q` for presence checks, append idempotently via `sed -i` + check.
- Migration via additive ALTER works because additive migrations run on every boot — confirmed `quizzes.couple_image_path` landed on prod without issue.
- Local Playwright MCP screenshots were the fastest way to verify UI changes; the Playwright `npm run e2e` config exists but wasn't exercised.

### 2026-05-10 — Pre-wedding polish & live operation
(Compacted earlier in the original session — see git log for the day's commits. Key landmarks: hero-band on export, lone-wolves stat, click-to-zoom on question photos.)
