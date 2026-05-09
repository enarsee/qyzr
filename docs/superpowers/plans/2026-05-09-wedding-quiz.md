# Wedding Quiz Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hostable Kahoot-style wedding quiz app per the spec at `docs/superpowers/specs/2026-05-09-wedding-quiz-design.md`.

**Architecture:** Node.js 20 + Express + Socket.IO + SQLite (better-sqlite3) backend with a vanilla-JS frontend served as static files. Game state is persisted to SQLite and mirrored in an in-memory cache for hot-path realtime ops. Deployment: Docker Compose with Caddy as a reverse proxy doing automatic HTTPS via Let's Encrypt.

**Tech Stack:** Node 20 LTS · Express 4 · Socket.IO 4 · better-sqlite3 · sharp (image processing) · express-rate-limit · lru-cache · Jest · Playwright (smoke e2e) · Docker · Caddy 2.

**Layout (will be created task-by-task):**
```
wedding-quiz/
├── package.json
├── jest.config.js
├── .gitignore
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
├── DEPLOY.md
├── README.md
├── src/
│   ├── server.js                  Express + Socket.IO bootstrap
│   ├── config.js                  env vars (PORT, PUBLIC_URL, DATA_DIR)
│   ├── db/
│   │   ├── index.js               better-sqlite3 connection + migrate-on-boot
│   │   └── schema.sql             table DDL
│   ├── lib/
│   │   ├── ids.js                 creator_token / player_token / room_code generators
│   │   ├── validators.js          input validation helpers
│   │   ├── side-state.js          couple-mode mood-state computation
│   │   └── rate-limit.js          HTTP + socket-upgrade rate limiters
│   ├── repos/
│   │   ├── quizzes.js             quiz CRUD
│   │   ├── faces.js               couple_faces CRUD
│   │   ├── questions.js           questions+options CRUD
│   │   ├── games.js               game lifecycle
│   │   ├── players.js             player CRUD + reconnect
│   │   └── answers.js             answer record + dedupe
│   ├── routes/
│   │   ├── pages.js               GET HTML pages
│   │   ├── api.js                 REST endpoints (quiz/question/option CRUD)
│   │   └── upload.js              image upload + sharp pipeline
│   └── realtime/
│       ├── index.js               Socket.IO setup + per-event role dispatch
│       ├── auth.js                connection auth + per-event role enforcement
│       ├── reveal.js              build reveal payload (distribution, leaderboard, side scores)
│       └── handlers/
│           ├── player.js          player:join / player:answer
│           └── host.js            host:start / next / reveal / finish / kick
├── public/
│   ├── shared/
│   │   ├── styles.css             palette + typography + component styles
│   │   ├── icons.js               Lucide SVG strings (inline)
│   │   └── socket.js              thin wrapper around socket.io-client
│   ├── index.html                 landing
│   ├── create/{index.html, app.js}
│   ├── host/{index.html, app.js}
│   ├── display/{index.html, app.js}
│   └── play/{index.html, app.js}
└── tests/
    ├── setup.js
    ├── helpers/
    │   ├── server.js              spin up an isolated app on a free port
    │   └── client.js              Socket.IO client factory
    └── (test files per chunk)
```

**Conventions:**
- TDD: write failing test → minimal code → green → commit. Frequent commits.
- All SQL via better-sqlite3 prepared statements. No string interpolation of values.
- Prefer pure functions for business logic (side-state, scoring, validators) so tests don't need DB.
- Commit messages: Conventional Commits (`feat:`, `test:`, `chore:`, `fix:`, `docs:`).

---

## Chunk 1: Foundation & data layer

### Task 1.1: Project scaffolding

**Files:**
- Create: `package.json`, `.gitignore`, `jest.config.js`, `.env.example`, `tests/setup.js`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
data/
coverage/
*.log
.env
.DS_Store
playwright-report/
test-results/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "wedding-quiz",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "e2e": "playwright test"
  },
  "dependencies": {
    "better-sqlite3": "^11.5.0",
    "express": "^4.21.0",
    "express-rate-limit": "^7.4.0",
    "lru-cache": "^11.0.0",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.5",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "jest": "^29.7.0",
    "socket.io-client": "^4.7.5",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 3: Create `jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  setupFiles: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  testTimeout: 10000
};
```

- [ ] **Step 4: Create `tests/setup.js`** (empty for now; placeholder for cleanup hooks)

```js
// Per-test cleanup hooks live here when needed.
```

- [ ] **Step 5: Create `.env.example`**

```
PORT=3000
PUBLIC_URL=http://localhost:3000
DATA_DIR=./data
NODE_ENV=development
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `node_modules/` populated, no errors.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json jest.config.js .env.example tests/setup.js
git commit -m "chore: project scaffolding and dependencies"
```

### Task 1.2: ID generators (TDD)

**Files:**
- Create: `src/lib/ids.js`
- Test: `tests/unit/ids.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/ids.test.js
const { creatorToken, playerToken, roomCode } = require('../../src/lib/ids');

describe('creatorToken', () => {
  test('produces 32-character base64url string', () => {
    const t = creatorToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  test('produces unique values', () => {
    const set = new Set(Array.from({ length: 100 }, creatorToken));
    expect(set.size).toBe(100);
  });
});

describe('playerToken', () => {
  test('produces 24-character base64url string', () => {
    expect(playerToken()).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});

describe('roomCode', () => {
  test('produces 6 characters from base32 minus 0/O/1/I', () => {
    const c = roomCode();
    expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  test('produces unique values across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, roomCode));
    expect(set.size).toBeGreaterThan(990); // allow rare collisions
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx jest tests/unit/ids.test.js`
Expected: fails — module not found.

- [ ] **Step 3: Implement `src/lib/ids.js`**

```js
const { randomBytes } = require('crypto');

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function creatorToken() {
  return randomBytes(24).toString('base64url'); // 24 bytes -> 32 chars
}

function playerToken() {
  return randomBytes(18).toString('base64url'); // 18 bytes -> 24 chars
}

function roomCode() {
  // 6 chars from a 32-char alphabet via crypto-random byte mapping.
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += ROOM_ALPHABET[bytes[i] % 32];
  return out;
}

module.exports = { creatorToken, playerToken, roomCode };
```

- [ ] **Step 4: Run tests, verify green**

Run: `npx jest tests/unit/ids.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ids.js tests/unit/ids.test.js
git commit -m "feat: ID and room code generators"
```

### Task 1.3: Input validators (TDD)

**Files:**
- Create: `src/lib/validators.js`
- Test: `tests/unit/validators.test.js`

Per spec §9: name ≤30, group_value ≤10, question text ≤300, option text ≤120. Strings are trimmed. Empty after trim is invalid.

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/validators.test.js
const v = require('../../src/lib/validators');

describe('validateName', () => {
  test('trims and accepts 1-30 chars', () => {
    expect(v.validateName('  Alice ')).toBe('Alice');
  });
  test('rejects empty', () => {
    expect(() => v.validateName('   ')).toThrow('name_required');
  });
  test('rejects >30 chars', () => {
    expect(() => v.validateName('a'.repeat(31))).toThrow('name_too_long');
  });
  test('rejects non-string', () => {
    expect(() => v.validateName(123)).toThrow('name_invalid');
  });
});

describe('validateGroupValue', () => {
  test('accepts up to 10 chars', () => {
    expect(v.validateGroupValue('Table 7')).toBe('Table 7');
  });
  test('rejects empty', () => {
    expect(() => v.validateGroupValue('')).toThrow('group_value_required');
  });
});

describe('validateQuestionText', () => {
  test('rejects >300 chars', () => {
    expect(() => v.validateQuestionText('a'.repeat(301))).toThrow('question_too_long');
  });
});

describe('validateOptionText', () => {
  test('rejects >120 chars', () => {
    expect(() => v.validateOptionText('a'.repeat(121))).toThrow('option_too_long');
  });
});

describe('validateSideTag', () => {
  test('accepts known values', () => {
    for (const t of ['bride', 'groom', 'neutral']) {
      expect(v.validateSideTag(t)).toBe(t);
    }
  });
  test('rejects unknown', () => {
    expect(() => v.validateSideTag('partner')).toThrow('side_tag_invalid');
  });
});

describe('validateRoomCode', () => {
  test('upper-cases and validates 6 chars from alphabet', () => {
    expect(v.validateRoomCode('abc234')).toBe('ABC234'); // lowercase a/b/c are valid; 1/0/I/O excluded
  });
  test('rejects ambiguous chars', () => {
    expect(() => v.validateRoomCode('ABCDE0')).toThrow('room_code_invalid');
    expect(() => v.validateRoomCode('ABCDEI')).toThrow('room_code_invalid');
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npx jest tests/unit/validators.test.js`
Expected: cannot find module.

- [ ] **Step 3: Implement `src/lib/validators.js`**

```js
const ROOM_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function makeStringValidator({ key, max, allowEmpty = false }) {
  return (raw) => {
    if (typeof raw !== 'string') throw new Error(`${key}_invalid`);
    const trimmed = raw.trim();
    if (!trimmed && !allowEmpty) throw new Error(`${key}_required`);
    if (trimmed.length > max) throw new Error(`${key}_too_long`);
    return trimmed;
  };
}

const validateName = makeStringValidator({ key: 'name', max: 30 });
const validateGroupValue = makeStringValidator({ key: 'group_value', max: 10 });
const validateQuestionText = makeStringValidator({ key: 'question', max: 300 });
const validateOptionText = makeStringValidator({ key: 'option', max: 120 });

function validateSideTag(t) {
  if (!['bride', 'groom', 'neutral'].includes(t)) throw new Error('side_tag_invalid');
  return t;
}

function validateRoomCode(raw) {
  if (typeof raw !== 'string') throw new Error('room_code_invalid');
  const upper = raw.toUpperCase();
  if (!ROOM_ALPHABET.test(upper)) throw new Error('room_code_invalid');
  return upper;
}

module.exports = {
  validateName, validateGroupValue, validateQuestionText,
  validateOptionText, validateSideTag, validateRoomCode
};
```

- [ ] **Step 4: Run tests, verify green**

Run: `npx jest tests/unit/validators.test.js`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validators.js tests/unit/validators.test.js
git commit -m "feat: input validators with length limits"
```

### Task 1.4: Side-state computation (TDD)

**Files:**
- Create: `src/lib/side-state.js`
- Test: `tests/unit/side-state.test.js`

Per spec §7: `delta = bride - groom; ratio = delta / max(total, 1)`. Thresholds: ±0.40 → winner/angry, ±0.15 → happy/sad, else neutral.

- [ ] **Step 1: Write failing tests**

```js
// tests/unit/side-state.test.js
const { computeSideStates } = require('../../src/lib/side-state');

describe('computeSideStates', () => {
  test('zero/zero -> neutral/neutral', () => {
    expect(computeSideStates(0, 0)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });
  test('bride leads big -> winner/angry', () => {
    // 8-2 of 10 -> ratio 0.6
    expect(computeSideStates(8, 2)).toEqual({ bride: 'winner', groom: 'angry' });
  });
  test('bride leads small -> happy/sad', () => {
    // 6-4 of 10 -> ratio 0.2
    expect(computeSideStates(6, 4)).toEqual({ bride: 'happy', groom: 'sad' });
  });
  test('groom leads small -> sad/happy', () => {
    expect(computeSideStates(4, 6)).toEqual({ bride: 'sad', groom: 'happy' });
  });
  test('groom leads big -> angry/winner', () => {
    expect(computeSideStates(2, 8)).toEqual({ bride: 'angry', groom: 'winner' });
  });
  test('within neutral band', () => {
    // 10-9 of 19 -> ratio ~0.05 -> neutral
    expect(computeSideStates(10, 9)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });
  test('boundary at 0.15 strict', () => {
    // 23-17 of 40 -> ratio 0.15 exactly: per spec uses '> 0.15' so 0.15 is neutral
    expect(computeSideStates(23, 17)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });
  test('boundary just above 0.15', () => {
    // 24-17 of 41 -> ratio ~0.171 -> happy/sad
    expect(computeSideStates(24, 17)).toEqual({ bride: 'happy', groom: 'sad' });
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx jest tests/unit/side-state.test.js` → fails.

- [ ] **Step 3: Implement `src/lib/side-state.js`**

```js
function computeSideStates(brideScore, groomScore) {
  const total = Math.max(brideScore + groomScore, 1);
  const ratio = (brideScore - groomScore) / total;
  if (ratio > 0.40)  return { bride: 'winner', groom: 'angry' };
  if (ratio > 0.15)  return { bride: 'happy',  groom: 'sad' };
  if (ratio > -0.15) return { bride: 'neutral', groom: 'neutral' };
  if (ratio > -0.40) return { bride: 'sad',    groom: 'happy' };
  return { bride: 'angry', groom: 'winner' };
}

module.exports = { computeSideStates };
```

- [ ] **Step 4: Run, verify green**

- [ ] **Step 5: Commit**

```bash
git add src/lib/side-state.js tests/unit/side-state.test.js
git commit -m "feat: couple-mode side-state computation"
```

### Task 1.5: Database schema + connection module

**Files:**
- Create: `src/db/schema.sql`, `src/db/index.js`, `src/config.js`
- Test: `tests/unit/db.test.js`

- [ ] **Step 1: Create `src/config.js`**

```js
const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  nodeEnv: process.env.NODE_ENV || 'development'
};

module.exports = config;
```

- [ ] **Step 2: Create `src/db/schema.sql`** (paste verbatim from spec §5, including the player_token + kicked columns from round-1 review)

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS quizzes (
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

CREATE TABLE IF NOT EXISTS couple_faces (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('bride','groom')),
  state TEXT NOT NULL CHECK (state IN ('winner','happy','neutral','sad','angry')),
  image_path TEXT NOT NULL,
  UNIQUE(quiz_id, side, state)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  image_path TEXT,
  side_tag TEXT NOT NULL CHECK (side_tag IN ('bride','groom','neutral'))
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_position ON questions(quiz_id, position);

CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('lobby','active','revealing','finished')),
  current_question_id TEXT REFERENCES questions(id),
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_games_quiz_status ON games(quiz_id, status);

CREATE TABLE IF NOT EXISTS players (
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

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  option_id TEXT NOT NULL REFERENCES options(id),
  correct INTEGER NOT NULL,
  answered_at INTEGER NOT NULL,
  UNIQUE(game_id, question_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_answers_game_question ON answers(game_id, question_id);
```

- [ ] **Step 3: Create `src/db/index.js`**

```js
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

let _db;
function getDb() {
  if (!_db) _db = open(path.join(config.dataDir, 'quiz.db'));
  return _db;
}

// For tests: reset to a fresh in-memory or temp file db.
function _setDbForTesting(db) { _db = db; }

module.exports = { getDb, _setDbForTesting, open };
```

- [ ] **Step 4: Write a smoke test for schema apply**

```js
// tests/unit/db.test.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

test('schema applies cleanly to a fresh in-memory db', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8');
  expect(() => db.exec(schema)).not.toThrow();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const expected of ['quizzes','couple_faces','questions','options','games','players','answers']) {
    expect(tables).toContain(expected);
  }
});

test('foreign keys enforced — orphan question rejected', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8'));
  expect(() => db.prepare(
    "INSERT INTO questions (id, quiz_id, position, text, side_tag) VALUES ('q1','missing',1,'?','neutral')"
  ).run()).toThrow();
});
```

- [ ] **Step 5: Run, verify green**

Run: `npx jest tests/unit/db.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.sql src/db/index.js src/config.js tests/unit/db.test.js
git commit -m "feat: SQLite schema and connection module"
```

### Task 1.6: Repos — quizzes, faces, questions, games, players, answers

Each repo file exports a thin set of pure-data-layer functions. Tests use an in-memory DB. No business logic here — just SQL.

**Files:**
- Create: `src/repos/quizzes.js`, `src/repos/faces.js`, `src/repos/questions.js`, `src/repos/games.js`, `src/repos/players.js`, `src/repos/answers.js`
- Create test helper: `tests/helpers/db.js`
- Test: `tests/unit/repos.test.js`

- [ ] **Step 1: Create test DB helper**

```js
// tests/helpers/db.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { _setDbForTesting } = require('../../src/db');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '../../src/db/schema.sql'), 'utf8'));
  _setDbForTesting(db);
  return db;
}

module.exports = { freshDb };
```

- [ ] **Step 2: Implement `src/repos/quizzes.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create({ name, bride_label, groom_label, group_label, accent_color, hero_image_path, creator_token, room_code }) {
  const id = randomUUID();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO quizzes (id, creator_token, room_code, name, bride_label, groom_label, group_label, accent_color, hero_image_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, creator_token, room_code, name, bride_label, groom_label, group_label, accent_color, hero_image_path ?? null, now, now);
  return { id };
}

function byCreatorToken(token) {
  return getDb().prepare('SELECT * FROM quizzes WHERE creator_token = ?').get(token);
}
function byRoomCode(code) {
  return getDb().prepare('SELECT * FROM quizzes WHERE room_code = ?').get(code);
}
function byId(id) {
  return getDb().prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
}

function update(id, fields) {
  const allowed = ['name','bride_label','groom_label','group_label','accent_color','hero_image_path'];
  const set = [];
  const values = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { set.push(`${k} = ?`); values.push(fields[k]); }
  }
  if (!set.length) return;
  set.push('updated_at = ?'); values.push(Date.now());
  values.push(id);
  getDb().prepare(`UPDATE quizzes SET ${set.join(', ')} WHERE id = ?`).run(...values);
}

module.exports = { create, byCreatorToken, byRoomCode, byId, update };
```

- [ ] **Step 3: Implement `src/repos/faces.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

const STATES = ['winner','happy','neutral','sad','angry'];
const SIDES = ['bride','groom'];

function upsert({ quiz_id, side, state, image_path }) {
  if (!SIDES.includes(side)) throw new Error('side_invalid');
  if (!STATES.includes(state)) throw new Error('state_invalid');
  // delete existing then insert (idempotent upsert)
  const db = getDb();
  db.prepare('DELETE FROM couple_faces WHERE quiz_id = ? AND side = ? AND state = ?').run(quiz_id, side, state);
  db.prepare('INSERT INTO couple_faces (id, quiz_id, side, state, image_path) VALUES (?,?,?,?,?)')
    .run(randomUUID(), quiz_id, side, state, image_path);
}

function byQuiz(quiz_id) {
  return getDb().prepare('SELECT * FROM couple_faces WHERE quiz_id = ?').all(quiz_id);
}

module.exports = { upsert, byQuiz, STATES, SIDES };
```

- [ ] **Step 4: Implement `src/repos/questions.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create({ quiz_id, text, image_path, side_tag, options }) {
  const db = getDb();
  const tx = db.transaction(() => {
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE quiz_id = ?').get(quiz_id).m;
    const id = randomUUID();
    db.prepare(`INSERT INTO questions (id, quiz_id, position, text, image_path, side_tag) VALUES (?,?,?,?,?,?)`)
      .run(id, quiz_id, maxPos + 1, text, image_path ?? null, side_tag);
    options.forEach((o, i) => {
      db.prepare(`INSERT INTO options (id, question_id, position, text, is_correct) VALUES (?,?,?,?,?)`)
        .run(randomUUID(), id, i + 1, o.text, o.is_correct ? 1 : 0);
    });
    return id;
  });
  return { id: tx() };
}

function update(id, { text, image_path, side_tag }) {
  const db = getDb();
  const sets = [], values = [];
  if (text !== undefined)       { sets.push('text = ?');       values.push(text); }
  if (image_path !== undefined) { sets.push('image_path = ?'); values.push(image_path); }
  if (side_tag !== undefined)   { sets.push('side_tag = ?');   values.push(side_tag); }
  if (!sets.length) return;
  values.push(id);
  db.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function setOptions(question_id, options) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM options WHERE question_id = ?').run(question_id);
    options.forEach((o, i) => {
      db.prepare('INSERT INTO options (id, question_id, position, text, is_correct) VALUES (?,?,?,?,?)')
        .run(randomUUID(), question_id, i + 1, o.text, o.is_correct ? 1 : 0);
    });
  });
  tx();
}

function reorder(quiz_id, ids) {
  const db = getDb();
  const tx = db.transaction(() => {
    ids.forEach((qid, i) => {
      db.prepare('UPDATE questions SET position = ? WHERE id = ? AND quiz_id = ?').run(i + 1, qid, quiz_id);
    });
  });
  tx();
}

function remove(id) {
  getDb().prepare('DELETE FROM questions WHERE id = ?').run(id);
}

function listByQuiz(quiz_id) {
  const db = getDb();
  const qs = db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position').all(quiz_id);
  const opts = db.prepare('SELECT * FROM options WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?) ORDER BY position').all(quiz_id);
  const byQ = {};
  for (const o of opts) (byQ[o.question_id] ||= []).push(o);
  return qs.map(q => ({ ...q, options: byQ[q.id] || [] }));
}

function byId(id) {
  const db = getDb();
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!q) return null;
  q.options = db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY position').all(id);
  return q;
}

function nextAfter(quiz_id, current_question_id) {
  const db = getDb();
  if (!current_question_id) {
    return db.prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position LIMIT 1').get(quiz_id) || null;
  }
  const cur = db.prepare('SELECT position FROM questions WHERE id = ?').get(current_question_id);
  if (!cur) return null;
  return db.prepare('SELECT * FROM questions WHERE quiz_id = ? AND position > ? ORDER BY position LIMIT 1').get(quiz_id, cur.position) || null;
}

function hasAnswers(question_id) {
  return !!getDb().prepare('SELECT 1 FROM answers WHERE question_id = ? LIMIT 1').get(question_id);
}

module.exports = { create, update, setOptions, reorder, remove, listByQuiz, byId, nextAfter, hasAnswers };
```

- [ ] **Step 5: Implement `src/repos/games.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function create(quiz_id) {
  const id = randomUUID();
  getDb().prepare(`INSERT INTO games (id, quiz_id, status, current_question_id, started_at) VALUES (?,?,?,?,?)`)
    .run(id, quiz_id, 'lobby', null, Date.now());
  return { id };
}
function byId(id) {
  return getDb().prepare('SELECT * FROM games WHERE id = ?').get(id);
}
function activeForQuiz(quiz_id) {
  return getDb().prepare("SELECT * FROM games WHERE quiz_id = ? AND status != 'finished' ORDER BY started_at DESC LIMIT 1").get(quiz_id);
}
function setStatus(id, status, currentQuestionId) {
  const db = getDb();
  const ts = status === 'finished' ? Date.now() : null;
  db.prepare(`UPDATE games SET status = ?, current_question_id = ?, finished_at = COALESCE(?, finished_at) WHERE id = ?`)
    .run(status, currentQuestionId ?? null, ts, id);
}

module.exports = { create, byId, activeForQuiz, setStatus };
```

- [ ] **Step 6: Implement `src/repos/players.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');
const { playerToken } = require('../lib/ids');

function create({ game_id, name, group_value }) {
  const id = randomUUID();
  const token = playerToken();
  try {
    getDb().prepare('INSERT INTO players (id, game_id, player_token, name, group_value, joined_at) VALUES (?,?,?,?,?,?)')
      .run(id, game_id, token, name, group_value, Date.now());
  } catch (e) {
    // better-sqlite3 sets `code` on constraint errors.
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' && /players\.name|game_id, players\.name/.test(e.message)) {
      const err = new Error('name_taken'); err.code = 'name_taken'; throw err;
    }
    throw e;
  }
  return { id, player_token: token };
}

function byToken(token) {
  return getDb().prepare('SELECT * FROM players WHERE player_token = ?').get(token);
}
function byId(id) { return getDb().prepare('SELECT * FROM players WHERE id = ?').get(id); }
function bindSocket(id, socketId) {
  getDb().prepare('UPDATE players SET socket_id = ? WHERE id = ?').run(socketId, id);
}
function unbindSocket(socketId) {
  getDb().prepare('UPDATE players SET socket_id = NULL WHERE socket_id = ?').run(socketId);
}
function listByGame(game_id) {
  return getDb().prepare('SELECT * FROM players WHERE game_id = ? AND kicked = 0 ORDER BY joined_at').all(game_id);
}
function kick(id) {
  getDb().prepare('UPDATE players SET kicked = 1, socket_id = NULL WHERE id = ?').run(id);
}

module.exports = { create, byToken, byId, bindSocket, unbindSocket, listByGame, kick };
```

- [ ] **Step 7: Implement `src/repos/answers.js`**

```js
const { randomUUID } = require('crypto');
const { getDb } = require('../db');

function record({ game_id, question_id, player_id, option_id, correct }) {
  try {
    getDb().prepare(`INSERT INTO answers (id, game_id, question_id, player_id, option_id, correct, answered_at) VALUES (?,?,?,?,?,?,?)`)
      .run(randomUUID(), game_id, question_id, player_id, option_id, correct ? 1 : 0, Date.now());
    return { recorded: true };
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return { recorded: false, reason: 'duplicate' };
    throw e;
  }
}

function countForQuestion(game_id, question_id) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM answers WHERE game_id = ? AND question_id = ?').get(game_id, question_id).n;
}

function distribution(game_id, question_id) {
  return getDb().prepare(`
    SELECT option_id, COUNT(*) AS n FROM answers
    WHERE game_id = ? AND question_id = ?
    GROUP BY option_id
  `).all(game_id, question_id);
}

function leaderboard(game_id) {
  return getDb().prepare(`
    SELECT p.id, p.name, p.group_value, COALESCE(SUM(a.correct), 0) AS score
    FROM players p
    LEFT JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.id
    ORDER BY score DESC, p.joined_at ASC
  `).all(game_id);
}

function tableLeaderboard(game_id) {
  return getDb().prepare(`
    SELECT p.group_value, SUM(a.correct) AS score
    FROM players p
    JOIN answers a ON a.player_id = p.id AND a.game_id = p.game_id
    WHERE p.game_id = ? AND p.kicked = 0
    GROUP BY p.group_value
    ORDER BY score DESC
  `).all(game_id);
}

function sideScores(game_id) {
  const rows = getDb().prepare(`
    SELECT q.side_tag AS side, COALESCE(SUM(a.correct), 0) AS score
    FROM answers a JOIN questions q ON a.question_id = q.id
    WHERE a.game_id = ?
    GROUP BY q.side_tag
  `).all(game_id);
  const out = { bride: 0, groom: 0 };
  for (const r of rows) if (r.side === 'bride' || r.side === 'groom') out[r.side] = r.score;
  return out;
}

function playerScore(game_id, player_id) {
  return getDb().prepare('SELECT COALESCE(SUM(correct), 0) AS score FROM answers WHERE game_id = ? AND player_id = ?')
    .get(game_id, player_id).score;
}

module.exports = { record, countForQuestion, distribution, leaderboard, tableLeaderboard, sideScores, playerScore };
```

- [ ] **Step 8: Repo integration tests**

```js
// tests/unit/repos.test.js
const { freshDb } = require('../helpers/db');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const players = require('../../src/repos/players');
const answers = require('../../src/repos/answers');

beforeEach(() => freshDb());

function makeQuiz() {
  const { id } = quizzes.create({
    name: 'N', bride_label: 'B', groom_label: 'G', group_label: 'Table',
    accent_color: '#000', hero_image_path: null,
    creator_token: 'ctok'.padEnd(32, 'x'), room_code: 'ABC234'
  });
  return id;
}

test('quizzes.create + lookups', () => {
  const id = makeQuiz();
  expect(quizzes.byId(id).name).toBe('N');
  expect(quizzes.byCreatorToken('ctok'.padEnd(32,'x')).id).toBe(id);
  expect(quizzes.byRoomCode('ABC234').id).toBe(id);
});

test('questions.create + listByQuiz orders by position', () => {
  const qz = makeQuiz();
  const a = questions.create({ quiz_id: qz, text: 'A?', side_tag: 'bride', options: [{ text: 'a', is_correct: 1 }, { text: 'b' }] }).id;
  const b = questions.create({ quiz_id: qz, text: 'B?', side_tag: 'groom', options: [{ text: 'a' }, { text: 'b', is_correct: 1 }] }).id;
  const list = questions.listByQuiz(qz);
  expect(list.map(q => q.id)).toEqual([a, b]);
  expect(list[0].options.length).toBe(2);
});

test('questions.reorder updates positions', () => {
  const qz = makeQuiz();
  const a = questions.create({ quiz_id: qz, text: 'A?', side_tag: 'neutral', options: [{ text: 'a' }] }).id;
  const b = questions.create({ quiz_id: qz, text: 'B?', side_tag: 'neutral', options: [{ text: 'b' }] }).id;
  questions.reorder(qz, [b, a]);
  expect(questions.listByQuiz(qz).map(q => q.id)).toEqual([b, a]);
});

test('players.create rejects duplicate name with code name_taken', () => {
  const qz = makeQuiz();
  const g = games.create(qz).id;
  players.create({ game_id: g, name: 'Alice', group_value: '1' });
  expect(() => players.create({ game_id: g, name: 'Alice', group_value: '2' }))
    .toThrow('name_taken');
});

test('answers.record dedupes per (game, question, player)', () => {
  const qz = makeQuiz();
  const q = questions.create({ quiz_id: qz, text: 'Q?', side_tag: 'bride', options: [{ text: 'x', is_correct: 1 }] }).id;
  const opt = questions.byId(q).options[0].id;
  const g = games.create(qz).id;
  const p = players.create({ game_id: g, name: 'A', group_value: '1' }).id;
  const r1 = answers.record({ game_id: g, question_id: q, player_id: p, option_id: opt, correct: true });
  const r2 = answers.record({ game_id: g, question_id: q, player_id: p, option_id: opt, correct: true });
  expect(r1.recorded).toBe(true);
  expect(r2.recorded).toBe(false);
  expect(answers.countForQuestion(g, q)).toBe(1);
});

test('answers.sideScores aggregates by question side_tag', () => {
  const qz = makeQuiz();
  const qb = questions.create({ quiz_id: qz, text: 'b?', side_tag: 'bride', options: [{ text: 'x', is_correct: 1 }] }).id;
  const qg = questions.create({ quiz_id: qz, text: 'g?', side_tag: 'groom', options: [{ text: 'x', is_correct: 1 }] }).id;
  const g = games.create(qz).id;
  const p = players.create({ game_id: g, name: 'A', group_value: '1' }).id;
  const optB = questions.byId(qb).options[0].id;
  const optG = questions.byId(qg).options[0].id;
  answers.record({ game_id: g, question_id: qb, player_id: p, option_id: optB, correct: true });
  answers.record({ game_id: g, question_id: qg, player_id: p, option_id: optG, correct: true });
  expect(answers.sideScores(g)).toEqual({ bride: 1, groom: 1 });
});
```

- [ ] **Step 9: Run + commit**

Run: `npx jest tests/unit/repos.test.js`
Expected: all green.

```bash
git add src/repos tests/helpers/db.js tests/unit/repos.test.js
git commit -m "feat: data-layer repos for all entities with TDD"
```

---

## Chunk 2: HTTP API + image upload

### Task 2.1: Bare server bootstrap

**Files:**
- Create: `src/server.js`, `src/routes/pages.js`

- [ ] **Step 1: Create `src/server.js`**

```js
const path = require('path');
const http = require('http');
const express = require('express');
const config = require('./config');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1); // Caddy in front sets X-Forwarded-For; required for express-rate-limit
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Routes wired in later tasks:
  app.use(require('./routes/pages'));
  return app;
}

function start() {
  const app = buildApp();
  const server = http.createServer(app);
  // realtime is wired later
  server.listen(config.port, () => {
    console.log(`listening on ${config.publicUrl}`);
  });
  return { app, server };
}

if (require.main === module) start();
module.exports = { buildApp, start };
```

- [ ] **Step 2: Create `src/routes/pages.js`** (placeholder; HTML pages added in Chunk 6+)

```js
const path = require('path');
const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html')));
router.get('/create', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'create', 'index.html')));
router.get('/host/:token', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'host', 'index.html')));
router.get('/display/:code', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'display', 'index.html')));
router.get('/play', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'play', 'index.html')));
router.get('/play/:code', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'play', 'index.html')));

module.exports = router;
```

- [ ] **Step 3: Create temporary placeholder HTML files** (so 200s; full UI in chunks 6–8)

```bash
mkdir -p public/create public/host public/display public/play
for d in . create host display play; do
  echo '<!doctype html><meta charset="utf-8"><title>WQ</title><h1>placeholder</h1>' > public/$d/index.html
done
mv public/./index.html public/index.html
```

- [ ] **Step 4: Smoke test**

```js
// tests/integration/server.test.js
const request = require('supertest');
const { buildApp } = require('../../src/server');

test('GET / returns 200', async () => {
  const res = await request(buildApp()).get('/');
  expect(res.status).toBe(200);
});
test('GET /create returns 200', async () => {
  const res = await request(buildApp()).get('/create');
  expect(res.status).toBe(200);
});
```

- [ ] **Step 5: Run + commit**

```bash
npx jest tests/integration/server.test.js
git add src/server.js src/routes/pages.js public tests/integration/server.test.js
git commit -m "feat: minimal Express server with page routes"
```

### Task 2.2: Image upload pipeline (multer + sharp)

**Files:**
- Create: `src/routes/upload.js`
- Test: `tests/integration/upload.test.js`

Spec §9: validate by magic bytes, max 5MB, allow jpeg/png/webp, strip EXIF, resize to ≤2048×2048.

- [ ] **Step 1: Implement `src/routes/upload.js`**

```js
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const config = require('../config');

const router = express.Router();
const uploadDir = path.join(config.dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

router.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const meta = await sharp(req.file.buffer).metadata();
    if (!ALLOWED_FORMATS.has(meta.format)) {
      return res.status(400).json({ error: 'unsupported_format' });
    }
    const out = await sharp(req.file.buffer)
      .rotate()                 // auto-orient
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
      .toFormat('webp', { quality: 85 })
      .toBuffer();
    const fname = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.webp`;
    fs.writeFileSync(path.join(uploadDir, fname), out);
    res.json({ path: `/uploads/${fname}` });
  } catch {
    res.status(400).json({ error: 'image_invalid' });
  }
});

router.use('/uploads', express.static(uploadDir));

module.exports = router;
```

- [ ] **Step 2: Wire into `src/server.js`** (add `app.use(require('./routes/upload'));` before `pages`).

- [ ] **Step 3: Integration test**

```js
// tests/integration/upload.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');

beforeAll(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-'));
});
const { buildApp } = require('../../src/server');

test('rejects non-image', async () => {
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', Buffer.from('not an image'), 'fake.jpg');
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('image_invalid');
});

test('accepts a small PNG and returns webp path', async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .png().toBuffer();
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', png, 'pic.png');
  expect(res.status).toBe(200);
  expect(res.body.path).toMatch(/^\/uploads\/.+\.webp$/);
});

test('rejects file >5MB', async () => {
  const big = Buffer.alloc(6 * 1024 * 1024, 0xff);
  const res = await request(buildApp())
    .post('/api/upload')
    .attach('image', big, 'big.jpg');
  expect(res.status).toBe(400);
});
```

- [ ] **Step 4: Run + commit**

```bash
npx jest tests/integration/upload.test.js
git add src/routes/upload.js src/server.js tests/integration/upload.test.js
git commit -m "feat: image upload with sharp re-encoding and EXIF strip"
```

### Task 2.3: Quiz CRUD API

**Files:**
- Create: `src/routes/api.js`
- Test: `tests/integration/api.test.js`

Endpoints:
- `POST /api/quiz` — body: `{ name, bride_label?, groom_label?, group_label?, accent_color?, hero_image_path? }`. Returns `{ creator_token, room_code, host_url }`.
- `GET /api/quiz?token=…` — returns full quiz including faces + questions (auth: creator_token in query).
- `GET /api/quiz/by-room/:code` — returns quiz public fields only (used by display + player pages).
- `PUT /api/quiz?token=…` — patch quiz fields.
- `POST /api/quiz/:token/face` — body: `{ side, state, image_path }`.
- `POST /api/quiz/:token/question` — body: `{ text, image_path?, side_tag, options }`.
- `PUT /api/question/:id?token=…` — body: `{ text?, image_path?, side_tag?, options? }`. Rejects updating `is_correct` of a question whose answers exist (snapshot rule §5).
- `POST /api/quiz/:token/reorder` — body: `{ ids: [...] }`.
- `DELETE /api/question/:id?token=…`.

For brevity each endpoint follows the same shape: validate inputs → resolve quiz by token → call repo. Below is the file in full:

- [ ] **Step 1: Implement `src/routes/api.js`**

```js
const express = require('express');
const v = require('../lib/validators');
const ids = require('../lib/ids');
const quizzes = require('../repos/quizzes');
const faces = require('../repos/faces');
const questions = require('../repos/questions');
const config = require('../config');

const router = express.Router();

function requireQuizByToken(req, res) {
  const token = req.query.token || req.params.token;
  if (typeof token !== 'string' || !token) {
    res.status(401).json({ error: 'token_required' }); return null;
  }
  const q = quizzes.byCreatorToken(token);
  if (!q) { res.status(404).json({ error: 'quiz_not_found' }); return null; }
  return q;
}

router.post('/api/quiz', (req, res) => {
  try {
    const name = v.validateName(req.body.name);
    const bride_label = v.validateName(req.body.bride_label || 'Bride');
    const groom_label = v.validateName(req.body.groom_label || 'Groom');
    const group_label = v.validateName(req.body.group_label || 'Table');
    const accent_color = (() => {
      const c = (req.body.accent_color || '#C8587A').toString();
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new Error('accent_color_invalid');
      return c;
    })();
    const hero_image_path = req.body.hero_image_path || null;

    const creator_token = ids.creatorToken();
    let room_code = ids.roomCode();
    // Retry up to 5 times if collision
    for (let i = 0; i < 5 && quizzes.byRoomCode(room_code); i++) room_code = ids.roomCode();

    const { id } = quizzes.create({ name, bride_label, groom_label, group_label, accent_color, hero_image_path, creator_token, room_code });
    res.json({
      id, creator_token, room_code,
      host_url: `${config.publicUrl}/host/${creator_token}`,
      display_url: `${config.publicUrl}/display/${room_code}`,
      play_url: `${config.publicUrl}/play/${room_code}`
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/api/quiz', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  res.json({ ...q, faces: faces.byQuiz(q.id), questions: questions.listByQuiz(q.id) });
});

router.get('/api/quiz/by-room/:code', (req, res) => {
  try {
    const code = v.validateRoomCode(req.params.code);
    const q = quizzes.byRoomCode(code);
    if (!q) return res.status(404).json({ error: 'not_found' });
    // public fields only
    const { creator_token, ...pub } = q; void creator_token;
    res.json({ ...pub, faces: faces.byQuiz(q.id) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/quiz', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const fields = {};
  for (const k of ['name','bride_label','groom_label','group_label','accent_color','hero_image_path']) {
    if (req.body[k] !== undefined) fields[k] = req.body[k];
  }
  quizzes.update(q.id, fields);
  res.json({ ok: true });
});

router.post('/api/quiz/:token/face', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  try {
    faces.upsert({ quiz_id: q.id, side: req.body.side, state: req.body.state, image_path: req.body.image_path });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/quiz/:token/question', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  try {
    const text = v.validateQuestionText(req.body.text);
    const side_tag = v.validateSideTag(req.body.side_tag);
    const opts = (req.body.options || []).map(o => ({
      text: v.validateOptionText(o.text),
      is_correct: !!o.is_correct
    }));
    if (opts.length < 2 || opts.length > 4) throw new Error('options_count_invalid');
    if (opts.filter(o => o.is_correct).length !== 1) throw new Error('exactly_one_correct_required');
    const out = questions.create({ quiz_id: q.id, text, image_path: req.body.image_path || null, side_tag, options: opts });
    res.json(out);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/api/question/:id', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const existing = questions.byId(req.params.id);
  if (!existing || existing.quiz_id !== q.id) return res.status(404).json({ error: 'not_found' });
  try {
    const fields = {};
    if (req.body.text !== undefined) fields.text = v.validateQuestionText(req.body.text);
    if (req.body.side_tag !== undefined) fields.side_tag = v.validateSideTag(req.body.side_tag);
    if (req.body.image_path !== undefined) fields.image_path = req.body.image_path;
    questions.update(req.params.id, fields);

    if (Array.isArray(req.body.options)) {
      if (questions.hasAnswers(req.params.id)) {
        return res.status(409).json({ error: 'options_locked_after_play' });
      }
      const opts = req.body.options.map(o => ({
        text: v.validateOptionText(o.text), is_correct: !!o.is_correct
      }));
      if (opts.length < 2 || opts.length > 4) throw new Error('options_count_invalid');
      if (opts.filter(o => o.is_correct).length !== 1) throw new Error('exactly_one_correct_required');
      questions.setOptions(req.params.id, opts);
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/quiz/:token/reorder', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  questions.reorder(q.id, ids);
  res.json({ ok: true });
});

router.delete('/api/question/:id', (req, res) => {
  const q = requireQuizByToken(req, res); if (!q) return;
  const existing = questions.byId(req.params.id);
  if (!existing || existing.quiz_id !== q.id) return res.status(404).json({ error: 'not_found' });
  questions.remove(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
```

- [ ] **Step 2: Wire into `src/server.js`** before `pages`.

- [ ] **Step 3: Integration tests**

```js
// tests/integration/api.test.js
const request = require('supertest');
const { freshDb } = require('../helpers/db');
const { buildApp } = require('../../src/server');

let app;
beforeEach(() => { freshDb(); app = buildApp(); });

async function makeQuiz() {
  const res = await request(app).post('/api/quiz').send({ name: 'Wedding' });
  return res.body;
}

test('POST /api/quiz creates and returns urls', async () => {
  const q = await makeQuiz();
  expect(q.creator_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(q.room_code).toMatch(/^[A-Z2-9]{6}$/);
});

test('GET /api/quiz?token=… requires token', async () => {
  const q = await makeQuiz();
  expect((await request(app).get('/api/quiz')).status).toBe(401);
  expect((await request(app).get(`/api/quiz?token=${q.creator_token}`)).status).toBe(200);
  expect((await request(app).get(`/api/quiz?token=garbage`)).status).toBe(404);
});

test('POST question rejects bad option counts', async () => {
  const q = await makeQuiz();
  const r = await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'Q?', side_tag: 'bride', options: [{ text: 'a', is_correct: true }]
  });
  expect(r.status).toBe(400);
  expect(r.body.error).toBe('options_count_invalid');
});

test('PUT question with options blocked after answers exist', async () => {
  // Setup: create quiz, question, simulate an answer via direct repo access
  const q = await makeQuiz();
  const created = await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'Q?', side_tag: 'bride',
    options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  });
  const games = require('../../src/repos/games');
  const players = require('../../src/repos/players');
  const answers = require('../../src/repos/answers');
  const questions = require('../../src/repos/questions');
  const game = games.create((await request(app).get(`/api/quiz?token=${q.creator_token}`)).body.id);
  const p = players.create({ game_id: game.id, name: 'A', group_value: '1' });
  const opt = questions.byId(created.body.id).options[0].id;
  answers.record({ game_id: game.id, question_id: created.body.id, player_id: p.id, option_id: opt, correct: true });

  const upd = await request(app).put(`/api/question/${created.body.id}?token=${q.creator_token}`).send({
    options: [{ text: 'x', is_correct: true }, { text: 'y' }]
  });
  expect(upd.status).toBe(409);
  expect(upd.body.error).toBe('options_locked_after_play');
});

test('reorder updates positions', async () => {
  const q = await makeQuiz();
  const a = (await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'A?', side_tag: 'bride', options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  })).body.id;
  const b = (await request(app).post(`/api/quiz/${q.creator_token}/question`).send({
    text: 'B?', side_tag: 'groom', options: [{ text: 'a', is_correct: true }, { text: 'b' }]
  })).body.id;
  await request(app).post(`/api/quiz/${q.creator_token}/reorder`).send({ ids: [b, a] });
  const full = await request(app).get(`/api/quiz?token=${q.creator_token}`);
  expect(full.body.questions.map(q => q.id)).toEqual([b, a]);
});
```

- [ ] **Step 4: Run + commit**

```bash
npx jest tests/integration/api.test.js
git add src/routes/api.js src/server.js tests/integration/api.test.js
git commit -m "feat: REST API for quiz/question/option CRUD with snapshot rule"
```

---

## Chunk 3: Realtime auth + state machine + host events

### Task 3.1: Realtime bootstrap + connection auth

**Files:**
- Create: `src/realtime/index.js`, `src/realtime/auth.js`
- Update: `src/server.js` to attach Socket.IO

Spec §6: connection auth payload determines role and joins the corresponding socket room.

- [ ] **Step 1: Implement `src/realtime/auth.js`**

```js
const quizzes = require('../repos/quizzes');
const games = require('../repos/games');
const players = require('../repos/players');

function resolveAuth(handshakeAuth) {
  const a = handshakeAuth || {};
  if (a.role === 'host') {
    if (typeof a.creator_token !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byCreatorToken(a.creator_token);
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id); // may be null pre-start
    return { role: 'host', quiz_id: quiz.id, game_id: game ? game.id : null };
  }
  if (a.role === 'display') {
    if (typeof a.room_code !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byRoomCode(a.room_code.toUpperCase());
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id);
    return { role: 'display', quiz_id: quiz.id, game_id: game ? game.id : null };
  }
  if (a.role === 'player') {
    if (typeof a.room_code !== 'string') throw new Error('auth_invalid');
    const quiz = quizzes.byRoomCode(a.room_code.toUpperCase());
    if (!quiz) throw new Error('quiz_not_found');
    const game = games.activeForQuiz(quiz.id);
    if (!game) throw new Error('no_active_game');
    let existing = null;
    if (typeof a.player_token === 'string') {
      const p = players.byToken(a.player_token);
      if (p && p.game_id === game.id) {
        if (p.kicked) throw new Error('kicked'); // hard-reject per spec §11
        existing = p;
      }
    }
    return { role: 'player', quiz_id: quiz.id, game_id: game.id, existing_player: existing };
  }
  throw new Error('auth_invalid');
}

module.exports = { resolveAuth };
```

- [ ] **Step 2: Implement `src/realtime/index.js`** (auth + dispatch shell, handlers wired in next tasks)

```js
const { Server } = require('socket.io');
const { resolveAuth } = require('./auth');

function attach(httpServer) {
  const io = new Server(httpServer, { cors: { origin: false } });

  io.use((socket, next) => {
    try {
      const ctx = resolveAuth(socket.handshake.auth);
      socket.data.ctx = ctx;
      const room = `${ctx.role}:${ctx.game_id || 'pending'}`;
      socket.join(room);
      next();
    } catch (e) {
      next(new Error(e.message));
    }
  });

  io.on('connection', (socket) => {
    const ctx = socket.data.ctx;
    socket.on('disconnect', () => {
      // player unbind handled in player handlers
      const handlers = require('./handlers/player');
      if (ctx.role === 'player') handlers.handleDisconnect(io, socket);
    });
    require('./handlers/player').register(io, socket);
    require('./handlers/host').register(io, socket);
    // state pushed by handlers as needed
  });

  return io;
}

module.exports = { attach };
```

- [ ] **Step 3: Wire into `src/server.js`**

```js
function start() {
  const app = buildApp();
  const server = http.createServer(app);
  require('./realtime').attach(server);
  server.listen(config.port, () => console.log(`listening on ${config.publicUrl}`));
  return { app, server };
}
```

- [ ] **Step 4: Test helpers — server+client**

```js
// tests/helpers/server.js
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
    app, server, port, url: `http://localhost:${port}`,
    close: () => new Promise(r => server.close(r))
  };
}
module.exports = { startTestServer };
```

```js
// tests/helpers/client.js
const { io } = require('socket.io-client');
function connect(url, auth) {
  return new Promise((resolve, reject) => {
    const s = io(url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', err => reject(err));
  });
}
module.exports = { connect };
```

- [ ] **Step 5: Auth tests**

```js
// tests/integration/socket-auth.test.js
const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const games = require('../../src/repos/games');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

function makeQuiz() {
  return quizzes.create({
    name: 'Q', bride_label: 'B', groom_label: 'G', group_label: 'Table',
    accent_color: '#000', hero_image_path: null,
    creator_token: ids.creatorToken(), room_code: ids.roomCode()
  });
}

test('host connect with bad token rejected', async () => {
  await expect(connect(s.url, { role: 'host', creator_token: 'no' })).rejects.toThrow();
});

test('player connect with no active game rejected', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  await expect(connect(s.url, { role: 'player', room_code: quiz.room_code })).rejects.toThrow(/no_active_game/);
});

test('host connect with valid token succeeds', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  const c = await connect(s.url, { role: 'host', creator_token: quiz.creator_token });
  expect(c.connected).toBe(true);
  c.close();
});

test('display connect with valid room_code succeeds even without game', async () => {
  const q = makeQuiz();
  const quiz = quizzes.byId(q.id);
  const c = await connect(s.url, { role: 'display', room_code: quiz.room_code });
  expect(c.connected).toBe(true);
  c.close();
});
```

- [ ] **Step 6: Run + commit**

```bash
npx jest tests/integration/socket-auth.test.js
git add src/realtime tests/helpers/server.js tests/helpers/client.js tests/integration/socket-auth.test.js src/server.js
git commit -m "feat: Socket.IO bootstrap with role-based connection auth"
```

### Task 3.2: Host event handlers + state machine

**Files:**
- Create: `src/realtime/handlers/host.js`, `src/realtime/state.js`, `src/realtime/reveal.js` (stub for now; full payload in Chunk 5)
- Test: `tests/integration/socket-host.test.js`

- [ ] **Step 1: Implement `src/realtime/state.js`** — in-memory snapshot + builder

```js
const games = require('../repos/games');
const players = require('../repos/players');
const quizzes = require('../repos/quizzes');
const questions = require('../repos/questions');

// Tracks the per-question "total" snapshot for answer:received messages.
const totalsByQuestion = new Map(); // game_id:question_id -> total

function snapshotTotal(game_id, question_id) {
  totalsByQuestion.set(`${game_id}:${question_id}`, players.listByGame(game_id).length);
}
function getTotal(game_id, question_id) {
  return totalsByQuestion.get(`${game_id}:${question_id}`) ?? players.listByGame(game_id).length;
}

function buildStatePayload({ game_id, includeCorrect }) {
  const game = games.byId(game_id);
  if (!game) return null;
  const quiz = quizzes.byId(game.quiz_id);
  const all = questions.listByQuiz(quiz.id);
  let current = null;
  if (game.current_question_id) {
    const q = all.find(x => x.id === game.current_question_id);
    if (q) current = projectQuestion(q, includeCorrect);
  }
  const playerList = players.listByGame(game_id).map(p => ({ id: p.id, name: p.name, group_value: p.group_value }));
  return {
    game_id,
    status: game.status,
    quiz: {
      name: quiz.name, bride_label: quiz.bride_label, groom_label: quiz.groom_label,
      group_label: quiz.group_label, accent_color: quiz.accent_color,
      hero_image_url: quiz.hero_image_path
    },
    current_question: current,
    total_questions: all.length,
    players: playerList
  };
}

function projectQuestion(q, includeCorrect) {
  return {
    question_id: q.id,
    position: q.position,
    text: q.text,
    image_url: q.image_path,
    options: q.options.map(o => ({
      id: o.id, position: o.position, text: o.text,
      ...(includeCorrect ? { is_correct: !!o.is_correct } : {})
    }))
  };
}

module.exports = { buildStatePayload, snapshotTotal, getTotal, projectQuestion };
```

- [ ] **Step 2: Stub `src/realtime/reveal.js`**

```js
// Full payload built in Chunk 5; for now, return placeholder structure.
const answers = require('../repos/answers');
function buildRevealPayload(game_id, question_id) {
  return {
    question_id,
    correct_option_id: null, // filled in chunk 5
    distribution: answers.distribution(game_id, question_id),
    leaderboard: answers.leaderboard(game_id),
    table_leaderboard: answers.tableLeaderboard(game_id),
    side_scores: answers.sideScores(game_id),
    side_states: { bride: 'neutral', groom: 'neutral' }
  };
}
module.exports = { buildRevealPayload };
```

- [ ] **Step 3: Implement `src/realtime/handlers/host.js`**

```js
const games = require('../../repos/games');
const questions = require('../../repos/questions');
const players = require('../../repos/players');
const quizzes = require('../../repos/quizzes');
const { buildStatePayload, snapshotTotal, projectQuestion } = require('../state');
const { buildRevealPayload } = require('../reveal');

function rejectIfNotHost(socket) {
  if (socket.data.ctx.role !== 'host') {
    socket.emit('error', { code: 'forbidden', message: 'host role required' });
    return true;
  }
  return false;
}

function rejectIfStaleGame(socket, game_id) {
  if (socket.data.ctx.game_id && socket.data.ctx.game_id !== game_id) {
    socket.emit('error', { code: 'stale_game', message: 'game_id does not match active game' });
    return true;
  }
  return false;
}

function broadcastState(io, game_id) {
  // Emit a redacted state to display + players, fuller state to host.
  io.to(`host:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: true }));
  io.to(`display:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: false }));
  io.to(`players:${game_id}`).emit('state', buildStatePayload({ game_id, includeCorrect: false }));
}

function register(io, socket) {
  socket.on('host:start', () => {
    if (rejectIfNotHost(socket)) return;
    const ctx = socket.data.ctx;
    const existing = games.activeForQuiz(ctx.quiz_id);
    if (existing) { socket.emit('error', { code: 'game_exists', message: 'finish current game first' }); return; }
    const all = questions.listByQuiz(ctx.quiz_id);
    if (!all.length) { socket.emit('error', { code: 'no_questions' }); return; }
    const { id: gid } = games.create(ctx.quiz_id);
    ctx.game_id = gid;
    socket.join(`host:${gid}`);
    broadcastState(io, gid);
  });

  socket.on('host:next', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game) { socket.emit('error', { code: 'no_game' }); return; }
    // Per spec §6: host:next is valid only from lobby or revealing.
    // Calling it from active (skip-without-reveal) is intentionally not implemented in v1.
    if (!['lobby','revealing'].includes(game.status)) { socket.emit('error', { code: 'bad_state' }); return; }

    const next = questions.nextAfter(game.quiz_id, game.current_question_id);
    if (!next) {
      // No more questions; idempotent — re-emit state.
      broadcastState(io, game_id);
      return;
    }
    games.setStatus(game_id, 'active', next.id);
    snapshotTotal(game_id, next.id);
    // emit question:show
    const projHost = projectQuestion({ ...next, options: questions.byId(next.id).options }, true);
    const projPub  = projectQuestion({ ...next, options: questions.byId(next.id).options }, false);
    io.to(`host:${game_id}`).emit('question:show', projHost);
    io.to(`display:${game_id}`).emit('question:show', projPub);
    io.to(`players:${game_id}`).emit('question:show', projPub);
    broadcastState(io, game_id);
  });

  socket.on('host:reveal', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game || game.status !== 'active') { socket.emit('error', { code: 'bad_state' }); return; }
    games.setStatus(game_id, 'revealing', game.current_question_id);
    const payload = buildRevealPayload(game_id, game.current_question_id);
    io.to(`host:${game_id}`).emit('question:reveal', payload);
    io.to(`display:${game_id}`).emit('question:reveal', payload);
    io.to(`players:${game_id}`).emit('question:reveal', payload);
    broadcastState(io, game_id);
  });

  socket.on('host:finish', ({ game_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const game = games.byId(game_id);
    if (!game || game.status === 'finished') { socket.emit('error', { code: 'bad_state' }); return; }
    games.setStatus(game_id, 'finished', game.current_question_id);
    const final = buildRevealPayload(game_id, game.current_question_id);
    io.to(`host:${game_id}`).emit('game:finished', final);
    io.to(`display:${game_id}`).emit('game:finished', final);
    io.to(`players:${game_id}`).emit('game:finished', final);
    broadcastState(io, game_id);
  });

  socket.on('host:kick', ({ game_id, player_id } = {}) => {
    if (rejectIfNotHost(socket)) return;
    if (rejectIfStaleGame(socket, game_id)) return;
    const p = players.byId(player_id);
    if (!p || p.game_id !== game_id) { socket.emit('error', { code: 'not_found' }); return; }
    players.kick(player_id);
    if (p.socket_id) {
      const sock = io.sockets.sockets.get(p.socket_id);
      if (sock) { sock.emit('player:kicked', {}); sock.disconnect(true); }
    }
    io.to(`host:${game_id}`).emit('player:left', { player_id, reason: 'kicked' });
    io.to(`display:${game_id}`).emit('player:left', { player_id, reason: 'kicked' });
    broadcastState(io, game_id);
  });
}

module.exports = { register, broadcastState };
```

- [ ] **Step 4: Stub `src/realtime/handlers/player.js`** so server doesn't crash at require

```js
function register(_io, _socket) {}
function handleDisconnect(_io, _socket) {}
module.exports = { register, handleDisconnect };
```

- [ ] **Step 5: State-machine integration tests**

```js
// tests/integration/socket-host.test.js
const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

function quiz() {
  const ct = ids.creatorToken();
  const rc = ids.roomCode();
  const q = quizzes.create({
    name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null,
    creator_token: ct, room_code: rc
  });
  return { id: q.id, ct, rc };
}
function addQ(quiz_id, side) {
  return questions.create({ quiz_id, text: side+'?', side_tag: side,
    options: [{ text: 'a', is_correct: 1 }, { text: 'b' }] }).id;
}

test('start with no questions errors', async () => {
  const q = quiz();
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:start');
  expect((await errP).code).toBe('no_questions');
  host.close();
});

test('happy path: start -> next -> reveal -> next -> finish', async () => {
  const q = quiz();
  addQ(q.id, 'bride'); addQ(q.id, 'groom');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });

  // start
  const stateAfterStart = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const s1 = await stateAfterStart;
  expect(s1.status).toBe('lobby');
  const game_id = s1.game_id;

  // next -> active with first question
  const showP = new Promise(r => host.once('question:show', r));
  host.emit('host:next', { game_id });
  const shown = await showP;
  expect(shown.position).toBe(1);

  // reveal
  const revP = new Promise(r => host.once('question:reveal', r));
  host.emit('host:reveal', { game_id });
  const rev = await revP;
  expect(rev.question_id).toBe(shown.question_id);

  // next -> q2
  const show2 = new Promise(r => host.once('question:show', r));
  host.emit('host:next', { game_id });
  expect((await show2).position).toBe(2);

  // finish
  const finP = new Promise(r => host.once('game:finished', r));
  host.emit('host:finish', { game_id });
  const fin = await finP;
  expect(fin).toBeTruthy();
  expect(games.byId(game_id).status).toBe('finished');

  host.close();
});

test('reveal from lobby is rejected', async () => {
  const q = quiz(); addQ(q.id, 'bride');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const stateP = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const game_id = (await stateP).game_id;
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:reveal', { game_id });
  expect((await errP).code).toBe('bad_state');
  host.close();
});

test('stale game_id from host event is rejected', async () => {
  const q = quiz(); addQ(q.id, 'bride');
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const stateP = new Promise(r => host.once('state', r));
  host.emit('host:start');
  await stateP;
  const errP = new Promise(r => host.once('error', r));
  host.emit('host:next', { game_id: 'totally-bogus' });
  expect((await errP).code).toBe('stale_game');
  host.close();
});

test('player socket emitting host:start is rejected', async () => {
  const q = quiz(); addQ(q.id, 'bride');
  // start a game so player can connect
  const host = await connect(s.url, { role: 'host', creator_token: q.ct });
  const stateP = new Promise(r => host.once('state', r));
  host.emit('host:start');
  await stateP;
  // Player can't actually `player:join` yet (Chunk 4) but can connect.
  // For now just verify the auth role gate by directly emitting host:start.
  host.close();
  // (Full role-enforcement test added in Chunk 4 once player:join exists.)
});
```

- [ ] **Step 6: Run + commit**

```bash
npx jest tests/integration/socket-host.test.js
git add src/realtime tests/integration/socket-host.test.js
git commit -m "feat: host event handlers with state machine + stale-game guard"
```

---

## Chunk 4: Realtime player events + reconnect + kick

### Task 4.1: Player join + answer + reconnect

**Files:**
- Update: `src/realtime/handlers/player.js`
- Test: `tests/integration/socket-player.test.js`

- [ ] **Step 1: Implement `src/realtime/handlers/player.js`**

```js
const players = require('../../repos/players');
const games = require('../../repos/games');
const questions = require('../../repos/questions');
const answers = require('../../repos/answers');
const v = require('../../lib/validators');
const { buildStatePayload, getTotal } = require('../state');
const { broadcastState } = require('./host');

function register(io, socket) {
  const ctx = socket.data.ctx;

  // If reconnect with player_token, rebind immediately.
  if (ctx.role === 'player' && ctx.existing_player) {
    const p = ctx.existing_player;
    players.bindSocket(p.id, socket.id);
    ctx.player_id = p.id;
    socket.join(`players:${ctx.game_id}`);
    socket.emit('joined', { player_id: p.id, player_token: p.player_token });
    socket.emit('state', buildStatePayload({ game_id: ctx.game_id, includeCorrect: false }));
    io.to(`host:${ctx.game_id}`).emit('player:joined', { player_id: p.id, name: p.name, group_value: p.group_value });
    io.to(`display:${ctx.game_id}`).emit('player:joined', { player_id: p.id, name: p.name, group_value: p.group_value });
  }

  socket.on('player:join', ({ name, group_value } = {}) => {
    if (ctx.role !== 'player') { socket.emit('error', { code: 'forbidden' }); return; }
    if (ctx.player_id) { socket.emit('error', { code: 'already_joined' }); return; }
    try {
      const cleanName = v.validateName(name);
      const cleanGv = v.validateGroupValue(group_value);
      const { id, player_token } = players.create({ game_id: ctx.game_id, name: cleanName, group_value: cleanGv });
      players.bindSocket(id, socket.id);
      ctx.player_id = id;
      socket.join(`players:${ctx.game_id}`);
      socket.emit('joined', { player_id: id, player_token });
      socket.emit('state', buildStatePayload({ game_id: ctx.game_id, includeCorrect: false }));
      io.to(`host:${ctx.game_id}`).emit('player:joined', { player_id: id, name: cleanName, group_value: cleanGv });
      io.to(`display:${ctx.game_id}`).emit('player:joined', { player_id: id, name: cleanName, group_value: cleanGv });
    } catch (e) {
      socket.emit('error', { code: e.code || e.message });
    }
  });

  socket.on('player:answer', ({ game_id, question_id, option_id } = {}) => {
    if (ctx.role !== 'player') { socket.emit('error', { code: 'forbidden' }); return; }
    if (!ctx.player_id) { socket.emit('error', { code: 'not_joined' }); return; }
    if (game_id !== ctx.game_id) { socket.emit('error', { code: 'stale_game' }); return; }
    const game = games.byId(game_id);
    if (!game || game.status !== 'active' || game.current_question_id !== question_id) {
      socket.emit('error', { code: 'question_not_active' }); return;
    }
    const q = questions.byId(question_id);
    const opt = q.options.find(o => o.id === option_id);
    if (!opt) { socket.emit('error', { code: 'option_not_found' }); return; }
    const result = answers.record({
      game_id, question_id, player_id: ctx.player_id, option_id, correct: !!opt.is_correct
    });
    if (!result.recorded) { /* duplicate; drop silently per spec */ return; }
    const count = answers.countForQuestion(game_id, question_id);
    const total = getTotal(game_id, question_id);
    io.to(`host:${game_id}`).emit('answer:received', { question_id, count, total });
    io.to(`display:${game_id}`).emit('answer:received', { question_id, count, total });
  });
}

function handleDisconnect(io, socket) {
  const ctx = socket.data.ctx;
  if (!ctx || ctx.role !== 'player' || !ctx.player_id) return;
  players.unbindSocket(socket.id);
  io.to(`host:${ctx.game_id}`).emit('player:left', { player_id: ctx.player_id, reason: 'disconnect' });
  io.to(`display:${ctx.game_id}`).emit('player:left', { player_id: ctx.player_id, reason: 'disconnect' });
}

module.exports = { register, handleDisconnect };
```

- [ ] **Step 2: Player flow tests**

```js
// tests/integration/socket-player.test.js
const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const ids = require('../../src/lib/ids');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

async function bootstrap() {
  const ct = ids.creatorToken(), rc = ids.roomCode();
  const q = quizzes.create({ name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null, creator_token: ct, room_code: rc });
  questions.create({ quiz_id: q.id, text:'Q1?', side_tag:'bride',
    options: [{ text:'a', is_correct:1 }, { text:'b' }] });
  const host = await connect(s.url, { role: 'host', creator_token: ct });
  const startState = new Promise(r => host.once('state', r));
  host.emit('host:start');
  const sp = await startState;
  return { host, room_code: rc, game_id: sp.game_id, quiz_id: q.id };
}

test('player joins and host receives player:joined', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  const joinedP = new Promise(r => player.once('joined', r));
  const hostNotice = new Promise(r => host.once('player:joined', r));
  player.emit('player:join', { name: 'Alice', group_value: '7' });
  const joined = await joinedP;
  expect(joined.player_token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  const notice = await hostNotice;
  expect(notice.name).toBe('Alice');
  player.close(); host.close();
});

test('duplicate name rejected with name_taken', async () => {
  const { host, room_code } = await bootstrap();
  const a = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { a.once('joined', r); a.emit('player:join', { name: 'Alice', group_value: '1' }); });
  const b = await connect(s.url, { role: 'player', room_code });
  const errP = new Promise(r => b.once('error', r));
  b.emit('player:join', { name: 'Alice', group_value: '2' });
  expect((await errP).code).toBe('name_taken');
  a.close(); b.close(); host.close();
});

test('reconnect with player_token rebinds without duplicate row', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const a = await connect(s.url, { role: 'player', room_code });
  const j = await new Promise(r => { a.once('joined', r); a.emit('player:join', { name: 'Alice', group_value: '1' }); });
  a.close();
  const players = require('../../src/repos/players');
  expect(players.listByGame(game_id).length).toBe(1);
  const a2 = await connect(s.url, { role: 'player', room_code, player_token: j.player_token });
  // Should receive `joined` event automatically on reconnect
  const j2 = await new Promise(r => a2.once('joined', r));
  expect(j2.player_id).toBe(j.player_id);
  expect(players.listByGame(game_id).length).toBe(1); // still one row
  a2.close(); host.close();
});

test('answer outside active state is rejected', async () => {
  const { host, room_code, game_id, quiz_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  // Game is in lobby; emit a fake answer
  const errP = new Promise(r => player.once('error', r));
  player.emit('player:answer', { game_id, question_id: 'whatever', option_id: 'whatever' });
  expect((await errP).code).toBe('question_not_active');
  player.close(); host.close();
});

test('answer dedupe: second answer silently dropped', async () => {
  const { host, room_code, game_id, quiz_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  // host:next to make question active
  const showP = new Promise(r => player.once('question:show', r));
  host.emit('host:next', { game_id });
  const shown = await showP;
  const optId = shown.options[0].id;
  // Two answers — second is a duplicate; host receives count=1 only once.
  let received = 0;
  host.on('answer:received', () => received++);
  player.emit('player:answer', { game_id, question_id: shown.question_id, option_id: optId });
  player.emit('player:answer', { game_id, question_id: shown.question_id, option_id: optId });
  await new Promise(r => setTimeout(r, 100));
  expect(received).toBe(1);
  player.close(); host.close();
});

test('player socket emitting host:start is silently ignored (forbidden)', async () => {
  const { host, room_code, game_id } = await bootstrap();
  const player = await connect(s.url, { role: 'player', room_code });
  await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'A', group_value:'1' }); });
  const errP = new Promise(r => player.once('error', r));
  player.emit('host:start'); // shouldn't be allowed
  expect((await errP).code).toBe('forbidden');
  player.close(); host.close();
});
```

- [ ] **Step 3: Run + commit**

```bash
npx jest tests/integration/socket-player.test.js
git add src/realtime/handlers/player.js tests/integration/socket-player.test.js
git commit -m "feat: player join, answer, reconnect via player_token, dedupe"
```

### Task 4.2: Kick flow

**Files:**
- Test: `tests/integration/socket-kick.test.js` (handler already implemented in 3.2)

- [ ] **Step 1: Tests**

```js
// tests/integration/socket-kick.test.js
const { freshDb } = require('../helpers/db');
const { startTestServer } = require('../helpers/server');
const { connect } = require('../helpers/client');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const ids = require('../../src/lib/ids');
const playersRepo = require('../../src/repos/players');

let s;
beforeEach(async () => { freshDb(); s = await startTestServer(); });
afterEach(async () => { await s.close(); });

test('kicked player gets player:kicked + disconnected, cannot rejoin', async () => {
  const ct = ids.creatorToken(), rc = ids.roomCode();
  const q = quizzes.create({ name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null, creator_token: ct, room_code: rc });
  questions.create({ quiz_id: q.id, text:'Q?', side_tag:'bride',
    options: [{ text:'a', is_correct:1 }, { text:'b' }] });
  const host = await connect(s.url, { role: 'host', creator_token: ct });
  const sp = await new Promise(r => { host.once('state', r); host.emit('host:start'); });
  const player = await connect(s.url, { role: 'player', room_code: rc });
  const j = await new Promise(r => { player.once('joined', r); player.emit('player:join', { name: 'Alice', group_value:'1' }); });

  const kickedP = new Promise(r => player.once('player:kicked', r));
  const disconnectP = new Promise(r => player.once('disconnect', r));
  host.emit('host:kick', { game_id: sp.game_id, player_id: j.player_id });
  await kickedP;
  await disconnectP;
  expect(playersRepo.byId(j.player_id).kicked).toBe(1);

  // Reconnect with same token -> auth hard-rejects (kicked) per spec §11
  await expect(connect(s.url, { role: 'player', room_code: rc, player_token: j.player_token }))
    .rejects.toThrow(/kicked/);
  host.close();
});
```

> Note: `auth.js` hard-rejects kicked tokens with `Error('kicked')` per spec §11. A kicked player who connects with their stored token gets a `connect_error('kicked')` in the player UI; they must clear localStorage (or use a different device) and rejoin under a different name (the original name remains unique-locked on the kicked row by design).

- [ ] **Step 2: Run + commit**

```bash
npx jest tests/integration/socket-kick.test.js
git add tests/integration/socket-kick.test.js
git commit -m "test: host:kick disconnects player and marks kicked"
```

---

## Chunk 5: Reveal payload — distribution, leaderboards, side states

### Task 5.1: Wire `correct_option_id` and side states into reveal

**Files:**
- Update: `src/realtime/reveal.js`
- Test: `tests/unit/reveal.test.js`

- [ ] **Step 1: Replace `src/realtime/reveal.js`**

```js
const answers = require('../repos/answers');
const questions = require('../repos/questions');
const { computeSideStates } = require('../lib/side-state');

function buildRevealPayload(game_id, question_id) {
  const q = questions.byId(question_id);
  const correct = q.options.find(o => o.is_correct);
  const sideScores = answers.sideScores(game_id);
  return {
    question_id,
    correct_option_id: correct ? correct.id : null,
    distribution: answers.distribution(game_id, question_id),
    leaderboard: answers.leaderboard(game_id),
    table_leaderboard: answers.tableLeaderboard(game_id),
    side_scores: sideScores,
    side_states: computeSideStates(sideScores.bride, sideScores.groom)
  };
}

module.exports = { buildRevealPayload };
```

- [ ] **Step 2: Unit test**

```js
// tests/unit/reveal.test.js
const { freshDb } = require('../helpers/db');
const quizzes = require('../../src/repos/quizzes');
const questions = require('../../src/repos/questions');
const games = require('../../src/repos/games');
const players = require('../../src/repos/players');
const answers = require('../../src/repos/answers');
const { buildRevealPayload } = require('../../src/realtime/reveal');
const ids = require('../../src/lib/ids');

beforeEach(() => freshDb());

test('reveal payload returns correct option, distribution, side scores, side states', () => {
  const q = quizzes.create({ name:'Q', bride_label:'B', groom_label:'G', group_label:'T',
    accent_color:'#000', hero_image_path:null, creator_token: ids.creatorToken(), room_code: ids.roomCode() });
  const qb = questions.create({ quiz_id: q.id, text:'b?', side_tag:'bride',
    options: [{ text:'right', is_correct:1 }, { text:'wrong' }] }).id;
  const game = games.create(q.id);
  games.setStatus(game.id, 'active', qb);
  const p1 = players.create({ game_id: game.id, name:'A', group_value:'1' }).id;
  const p2 = players.create({ game_id: game.id, name:'B', group_value:'1' }).id;
  const opts = questions.byId(qb).options;
  answers.record({ game_id: game.id, question_id: qb, player_id: p1, option_id: opts[0].id, correct: true });
  answers.record({ game_id: game.id, question_id: qb, player_id: p2, option_id: opts[1].id, correct: false });

  const r = buildRevealPayload(game.id, qb);
  expect(r.correct_option_id).toBe(opts[0].id);
  expect(r.distribution).toEqual(expect.arrayContaining([
    { option_id: opts[0].id, n: 1 },
    { option_id: opts[1].id, n: 1 }
  ]));
  expect(r.side_scores).toEqual({ bride: 1, groom: 0 });
  expect(r.side_states).toEqual({ bride: 'winner', groom: 'angry' });
  expect(r.leaderboard.length).toBe(2);
});
```

- [ ] **Step 3: Run + commit**

```bash
npx jest tests/unit/reveal.test.js
git add src/realtime/reveal.js tests/unit/reveal.test.js
git commit -m "feat: reveal payload with correct option and side states"
```

---

## Chunk 6: Frontend — shared assets + creator + host UI

### Task 6.1: Shared CSS, fonts, icons module, socket wrapper

**Files:**
- Create: `public/shared/styles.css`, `public/shared/icons.js`, `public/shared/socket.js`
- Update: `public/index.html` (landing page; minimal)

- [ ] **Step 1: `public/shared/styles.css`** (palette + tokens)

```css
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Infant:wght@400;500;600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap');

:root {
  --bg: #FBF7F2;
  --surface: #FFFFFF;
  --ink: #2A1B12;
  --muted: #8A7A6B;
  --rose: #C8587A;
  --gold: #B8893A;
  --bride: #D88BA8;
  --groom: #3F6B7B;
  --success: #3F8A5C;
  --error: #B5413B;
  --shadow-sm: 0 2px 6px rgba(42,27,18,0.06);
  --shadow-md: 0 4px 20px rgba(42,27,18,0.06);
  --shadow-lg: 0 8px 40px rgba(42,27,18,0.10);
  --radius-sm: 12px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --t: 200ms ease-out;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--ink);
  font-family: 'Cormorant Infant', Georgia, serif;
  font-size: 18px; line-height: 1.5;
  min-height: 100vh; min-height: 100dvh;
}
.font-script { font-family: 'Great Vibes', cursive; }
.font-ui     { font-family: 'Inter', system-ui, sans-serif; }
.tabular     { font-variant-numeric: tabular-nums; }

button, .btn {
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 600; font-size: 16px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  padding: 14px 24px; min-height: 44px;
  cursor: pointer;
  transition: transform var(--t), box-shadow var(--t), background var(--t);
  background: var(--surface); color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.btn-primary { background: var(--rose); color: #fff; }
.btn-primary:hover { box-shadow: var(--shadow-md); }
.btn-primary:active { transform: scale(0.98); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible, .btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

input, textarea, select {
  font-family: inherit; font-size: 16px;
  border: 1px solid #E3D9CC; background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 12px 14px; min-height: 44px;
  color: var(--ink); width: 100%;
}
input:focus, textarea:focus { outline: 2px solid var(--rose); outline-offset: 0; border-color: var(--rose); }

.card {
  background: var(--surface); border-radius: var(--radius-md);
  box-shadow: var(--shadow-md); padding: 24px;
}
.container { max-width: 960px; margin: 0 auto; padding: 24px; }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 2: `public/shared/icons.js`** (Lucide SVG strings)

```js
// Subset of Lucide icons inlined to avoid a bundler.
window.WQ_ICONS = {
  check: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x:     '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  checkCircle: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  xCircle: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  crown: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2 19h20l-2-7-5 3-3-7-3 7-5-3-2 7z"/></svg>',
  users: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  image: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><polyline points="21 15 16 10 5 21"/></svg>',
  chevron: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
};
```

- [ ] **Step 3: `public/shared/socket.js`** (load via `<script src="/socket.io/socket.io.js">` then `<script src="/shared/socket.js">`)

```js
window.WQ_connect = function(auth) {
  const s = io({ auth, transports: ['websocket'] });
  return s;
};
```

- [ ] **Step 4: Replace `public/index.html` with a real landing page**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Wedding Quiz</title>
  <link rel="stylesheet" href="/shared/styles.css">
</head>
<body>
  <main class="container" style="text-align:center; padding-top:80px;">
    <h1 class="font-script" style="font-size:80px; margin:0 0 8px; color: var(--rose);">Wedding Quiz</h1>
    <p style="color: var(--muted); margin-bottom: 40px;">A live, self-hosted quiz for your wedding.</p>
    <div style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap;">
      <a class="btn btn-primary" href="/create">Create a quiz</a>
      <a class="btn" href="/play">Join with a code</a>
    </div>
  </main>
</body>
</html>
```

- [ ] **Step 5: Commit (no tests for static files)**

```bash
git add public
git commit -m "feat: shared CSS, icons, socket helper, landing page"
```

### Task 6.2: `/create` page

**Files:**
- Create: `public/create/index.html`, `public/create/app.js`

This is a single form posting to `/api/quiz`. After success, redirect to `/host/<token>`.

- [ ] **Step 1: `public/create/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Create quiz · Wedding Quiz</title>
  <link rel="stylesheet" href="/shared/styles.css">
</head>
<body>
  <main class="container" style="max-width: 640px;">
    <h1 class="font-script" style="font-size:64px; color: var(--rose); text-align:center; margin: 24px 0 8px;">Create a quiz</h1>
    <p style="text-align:center; color: var(--muted); margin: 0 0 32px;">Anonymous · No account required</p>
    <form id="form" class="card" style="display:grid; gap: 16px;">
      <label>Quiz name <input name="name" required maxlength="30" placeholder="The Smith-Jones Wedding"></label>
      <label>"Bride" label <input name="bride_label" maxlength="30" value="Bride"></label>
      <label>"Groom" label <input name="groom_label" maxlength="30" value="Groom"></label>
      <label>Group label (e.g. Table) <input name="group_label" maxlength="30" value="Table"></label>
      <label>Accent color <input name="accent_color" type="color" value="#C8587A"></label>
      <label>Hero image (optional) <input name="hero_image" type="file" accept="image/*"></label>
      <p style="color: var(--muted); font-size: 14px; margin: 0;">You'll upload couple "mood" face images on the next page.</p>
      <button class="btn btn-primary" type="submit">Create quiz</button>
      <p id="err" style="color: var(--error); margin: 0;"></p>
    </form>
  </main>
  <script src="/create/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/create/app.js`**

```js
document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const heroFile = fd.get('hero_image');
  fd.delete('hero_image');
  const body = Object.fromEntries(fd.entries());

  // Upload hero image first (if provided), then create quiz with the resulting path.
  if (heroFile && heroFile.size > 0) {
    const heroFd = new FormData(); heroFd.append('image', heroFile);
    const up = await fetch('/api/upload', { method: 'POST', body: heroFd });
    if (!up.ok) {
      document.getElementById('err').textContent = 'Hero image upload failed';
      return;
    }
    body.hero_image_path = (await up.json()).path;
  }

  const res = await fetch('/api/quiz', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    document.getElementById('err').textContent = j.error || 'Something went wrong';
    return;
  }
  const j = await res.json();
  // Persist creator URL in localStorage so user has a fallback retrieval mechanism
  const list = JSON.parse(localStorage.getItem('wq_creator_urls') || '[]');
  list.unshift({ name: body.name, host_url: j.host_url, room_code: j.room_code, created_at: Date.now() });
  localStorage.setItem('wq_creator_urls', JSON.stringify(list.slice(0, 20)));
  window.location.href = j.host_url;
});
```

- [ ] **Step 3: Smoke test**

```js
// tests/integration/create-flow.test.js
const request = require('supertest');
const { freshDb } = require('../helpers/db');
const { buildApp } = require('../../src/server');

beforeEach(() => freshDb());

test('GET /create renders 200 with the form', async () => {
  const r = await request(buildApp()).get('/create');
  expect(r.status).toBe(200);
  expect(r.text).toContain('Create a quiz');
});
```

- [ ] **Step 4: Commit**

```bash
git add public/create tests/integration/create-flow.test.js
git commit -m "feat: /create page with quiz creation form"
```

### Task 6.3: `/host` — edit mode + game-mode control deck

**Files:**
- Create: `public/host/index.html`, `public/host/app.js`

This is the most complex page. Two modes: **edit** (when no game active) and **game** (when active). Toggled by reading `state.status`.

- [ ] **Step 1: `public/host/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Host · Wedding Quiz</title>
  <link rel="stylesheet" href="/shared/styles.css">
  <style>
    .topbar { display:flex; justify-content:space-between; align-items:center; gap:16px; padding:16px 24px; background: var(--surface); box-shadow: var(--shadow-sm); position: sticky; top: 0; z-index: 10; }
    .room-code { font-family: 'Inter'; font-weight: 700; letter-spacing: 0.1em; padding: 6px 12px; background: var(--bg); border-radius: var(--radius-sm); }
    .layout { display: grid; grid-template-columns: 3fr 2fr; gap: 24px; padding: 24px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
    .qlist { display:flex; flex-direction:column; gap: 12px; }
    .qrow { background: var(--surface); border-radius: var(--radius-sm); padding: 16px; box-shadow: var(--shadow-sm); display:flex; align-items: center; gap: 12px; cursor: grab; }
    .qrow.selected { outline: 2px solid var(--rose); }
    .editor { position: sticky; top: 80px; }
    .control-deck { padding: 48px; text-align: center; }
    .big-btn { font-size: 24px; padding: 24px 48px; }
    .player-pill { display:inline-block; background: var(--bg); border-radius: 999px; padding: 4px 12px; margin: 2px; font-family: 'Inter'; font-size: 14px; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="font-script" style="font-size:32px; color: var(--rose);" id="quizName">Quiz</div>
    <div style="display:flex; align-items:center; gap: 16px;">
      <span style="color: var(--muted); font-family: 'Inter';">Code</span>
      <span class="room-code tabular" id="roomCode">------</span>
      <button class="btn btn-primary" id="primaryBtn">Start game</button>
    </div>
  </div>
  <div id="root" aria-live="polite">
    <p style="text-align:center; padding: 80px;">Loading…</p>
  </div>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/shared/icons.js"></script>
  <script src="/shared/socket.js"></script>
  <script src="/host/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/host/app.js`** (large — single file, no framework)

```js
(function () {
  const token = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let socket = null;
  const root = document.getElementById('root');
  const quizName = document.getElementById('quizName');
  const roomCode = document.getElementById('roomCode');
  const primaryBtn = document.getElementById('primaryBtn');

  async function loadQuiz() {
    const r = await fetch(`/api/quiz?token=${encodeURIComponent(token)}`);
    if (!r.ok) { root.innerHTML = '<p style="text-align:center;color:var(--error);padding:80px;">Quiz not found.</p>'; return; }
    quiz = await r.json();
    quizName.textContent = quiz.name;
    roomCode.textContent = quiz.room_code;
    connect();
  }

  function connect() {
    socket = WQ_connect({ role: 'host', creator_token: token });
    socket.on('state', (s) => { state = s; render(); });
    socket.on('player:joined', () => { /* state will follow */ });
    socket.on('player:left', () => { /* state will follow */ });
    socket.on('answer:received', ({ count, total }) => {
      const el = document.getElementById('answeredCounter');
      if (el) el.textContent = `${count} / ${total} answered`;
    });
    socket.on('error', (e) => alert(e.message || e.code));
  }

  function render() {
    if (!state) return renderEdit();
    if (state.status === 'lobby' || state.status === 'active' || state.status === 'revealing') {
      renderControlDeck();
    } else {
      renderEdit();
    }
    primaryBtn.onclick = onPrimary;
    primaryBtn.textContent = primaryButtonLabel();
  }

  function primaryButtonLabel() {
    if (!state || state.status === 'finished' || !state.game_id) return 'Start game';
    if (state.status === 'lobby') return 'Show first question';
    if (state.status === 'active') return 'Reveal answer';
    if (state.status === 'revealing') {
      // Has next?
      return 'Next question';
    }
    return 'Start game';
  }

  function onPrimary() {
    if (!state || !state.game_id) { socket.emit('host:start'); return; }
    if (state.status === 'lobby') { socket.emit('host:next', { game_id: state.game_id }); return; }
    if (state.status === 'active') { socket.emit('host:reveal', { game_id: state.game_id }); return; }
    if (state.status === 'revealing') { socket.emit('host:next', { game_id: state.game_id }); return; }
  }

  function renderEdit() {
    root.innerHTML = `
      <div class="layout">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h2 style="margin:0;">Questions</h2>
            <button class="btn btn-primary" id="addQ">${WQ_ICONS.plus} Add</button>
          </div>
          <div class="qlist" id="qlist"></div>
        </div>
        <div class="editor card">
          <h3 style="margin:0 0 16px;">Editor</h3>
          <p style="color: var(--muted);">Select a question on the left or add a new one.</p>
        </div>
      </div>
    `;
    const list = document.getElementById('qlist');
    quiz.questions.forEach(q => {
      const div = document.createElement('div');
      div.className = 'qrow';
      div.draggable = true;
      div.dataset.id = q.id;
      div.innerHTML = `
        <strong style="font-family:'Inter';color:var(--muted);">${q.position}.</strong>
        <span style="flex:1;">${escapeHtml(q.text || '(untitled)')}</span>
        <span class="player-pill">${q.side_tag}</span>
      `;
      div.addEventListener('click', () => openEditor(q.id));
      addDragHandlers(div, list);
      list.appendChild(div);
    });
    document.getElementById('addQ').onclick = () => openEditor(null);
  }

  function openEditor(qid) {
    const editor = document.querySelector('.editor');
    const q = qid ? quiz.questions.find(x => x.id === qid) : null;
    const opts = q ? q.options : [{ text: '' }, { text: '' }];
    editor.innerHTML = `
      <h3 style="margin:0 0 16px;">${q ? 'Edit question' : 'New question'}</h3>
      <label>Question text<textarea id="qtext" maxlength="300" rows="3">${q ? escapeHtml(q.text) : ''}</textarea></label>
      <label>Side tag
        <select id="qside">
          <option value="bride" ${q?.side_tag==='bride'?'selected':''}>${quiz.bride_label}</option>
          <option value="groom" ${q?.side_tag==='groom'?'selected':''}>${quiz.groom_label}</option>
          <option value="neutral" ${q?.side_tag==='neutral'?'selected':''}>Neutral</option>
        </select>
      </label>
      <label>Image (optional)<input type="file" id="qimg" accept="image/*"></label>
      <div style="margin-top:8px;">${q?.image_path ? `<img src="${q.image_path}" style="max-width:100%;border-radius:8px;">` : ''}</div>
      <h4 style="margin:16px 0 8px;">Options (one correct)</h4>
      <div id="opts"></div>
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button class="btn btn-primary" id="saveQ">${q ? 'Save' : 'Add'}</button>
        ${q ? `<button class="btn" id="delQ" style="color:var(--error);">${WQ_ICONS.trash} Delete</button>` : ''}
      </div>
    `;
    const optsDiv = document.getElementById('opts');
    function renderOpts(arr) {
      optsDiv.innerHTML = arr.map((o, i) => `
        <div style="display:flex; gap:8px; margin-bottom:8px;">
          <input value="${escapeHtml(o.text || '')}" data-i="${i}" maxlength="120" placeholder="Option ${i+1}">
          <label style="display:flex; align-items:center; gap:4px; font-family:'Inter'; font-size:14px;">
            <input type="radio" name="correct" data-i="${i}" ${o.is_correct?'checked':''}> correct
          </label>
        </div>
      `).join('') + (arr.length < 4 ? '<button class="btn" id="addOpt">+ Add option</button>' : '');
      const addBtn = document.getElementById('addOpt');
      if (addBtn) addBtn.onclick = () => { arr.push({ text: '' }); renderOpts(arr); };
    }
    let optsState = opts.map(o => ({ text: o.text || '', is_correct: !!o.is_correct }));
    renderOpts(optsState);
    document.getElementById('saveQ').onclick = async () => {
      // Read options state from DOM
      const inputs = optsDiv.querySelectorAll('input[type="text"], input:not([type])');
      const radios = optsDiv.querySelectorAll('input[type="radio"]');
      optsState = Array.from(inputs).map((el, i) => ({
        text: el.value, is_correct: !!radios[i] && radios[i].checked
      })).filter(o => o.text.trim());
      if (optsState.filter(o => o.is_correct).length !== 1) {
        alert('Mark exactly one option correct.'); return;
      }
      let image_path = q?.image_path || null;
      const file = document.getElementById('qimg').files[0];
      if (file) {
        const fd = new FormData(); fd.append('image', file);
        const up = await fetch('/api/upload', { method: 'POST', body: fd });
        if (up.ok) image_path = (await up.json()).path;
      }
      const body = {
        text: document.getElementById('qtext').value,
        side_tag: document.getElementById('qside').value,
        image_path,
        options: optsState
      };
      const url = q ? `/api/question/${q.id}?token=${token}` : `/api/quiz/${token}/question`;
      const method = q ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error || 'Save failed'); return; }
      await loadQuiz();
    };
    if (q) {
      document.getElementById('delQ').onclick = async () => {
        if (!confirm('Delete this question?')) return;
        await fetch(`/api/question/${q.id}?token=${token}`, { method: 'DELETE' });
        await loadQuiz();
      };
    }
  }

  // Drag-to-reorder
  let dragSrc = null;
  function addDragHandlers(el, listEl) {
    el.addEventListener('dragstart', () => { dragSrc = el; el.style.opacity = '0.5'; });
    el.addEventListener('dragend', () => { el.style.opacity = ''; });
    el.addEventListener('dragover', (e) => { e.preventDefault(); });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === el) return;
      const items = Array.from(listEl.children);
      const fromIdx = items.indexOf(dragSrc);
      const toIdx = items.indexOf(el);
      if (fromIdx < toIdx) listEl.insertBefore(dragSrc, el.nextSibling); else listEl.insertBefore(dragSrc, el);
      const ids = Array.from(listEl.children).map(c => c.dataset.id);
      await fetch(`/api/quiz/${token}/reorder`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      await loadQuiz();
    });
  }

  function renderControlDeck() {
    const cur = state.current_question;
    const playersList = state.players.map(p => `<span class="player-pill">${escapeHtml(p.name)} · ${escapeHtml(p.group_value)}</span>`).join('');
    root.innerHTML = `
      <div class="control-deck">
        <p style="font-family:'Inter'; color:var(--muted);">Status: <strong>${state.status}</strong> · Q ${cur?.position || 0} / ${state.total_questions}</p>
        ${cur ? `
          <div class="card" style="text-align:left; max-width:680px; margin:24px auto;">
            <h2 style="margin:0 0 16px;">${escapeHtml(cur.text)}</h2>
            ${cur.image_url ? `<img src="${cur.image_url}" style="max-width:100%; border-radius:12px; margin-bottom:12px;">` : ''}
            <ol style="padding-left: 20px;">
              ${cur.options.map(o => `<li><strong>${o.text}</strong>${o.is_correct ? ' ✓' : ''}</li>`).join('')}
            </ol>
            <p id="answeredCounter" class="tabular" style="font-family:'Inter'; color: var(--muted);">0 / ${state.players.length} answered</p>
          </div>
        ` : `<p>Lobby — ${state.players.length} players joined</p>`}
        <div class="card" style="max-width:680px; margin: 24px auto; text-align:left;">
          <strong>Players</strong>
          <div style="margin-top:8px;">${playersList || '<em>None yet</em>'}</div>
        </div>
        ${state.status === 'lobby' || state.status === 'revealing' ? `<button class="btn" id="finishBtn" style="margin-top:24px;color:var(--error);">Finish game</button>` : ''}
      </div>
    `;
    const fb = document.getElementById('finishBtn');
    if (fb) fb.onclick = () => { if (confirm('Finish game?')) socket.emit('host:finish', { game_id: state.game_id }); };
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadQuiz();
})();
```

- [ ] **Step 3: Manual smoke test**

Run `npm start`, hit `http://localhost:3000/create`, fill form, get redirected to host page, add 2 questions, drag to reorder, start game.

- [ ] **Step 4: Commit**

```bash
git add public/host
git commit -m "feat: host page with edit mode and game-mode control deck"
```

### Task 6.4: Face-image manager + hero image edit on `/host`

The display page renders the Bride-vs-Groom panel by reading `quiz.faces` (5 mood states × 2 sides = 10 images per quiz, per spec §3 + §7). `/create` does not collect these because users don't have URLs at creation time; the host page is the right place. This task adds a "Couple faces" panel to the host edit mode.

**Files:**
- Update: `public/host/index.html` (small additions), `public/host/app.js` (new `renderFacesPanel` + branding form)

- [ ] **Step 1: Extend `renderEdit` in `public/host/app.js`** to include a Branding section above Questions:

```js
function renderEdit() {
  root.innerHTML = `
    <div class="layout">
      <div>
        <details class="card" style="margin-bottom: 16px;" id="brandingDetails">
          <summary style="cursor:pointer; font-family:'Inter'; font-weight:600;">Branding & couple faces</summary>
          <div id="brandingPanel" style="margin-top: 16px;"></div>
        </details>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 style="margin:0;">Questions</h2>
          <button class="btn btn-primary" id="addQ">${WQ_ICONS.plus} Add</button>
        </div>
        <div class="qlist" id="qlist"></div>
      </div>
      <div class="editor card">
        <h3 style="margin:0 0 16px;">Editor</h3>
        <p style="color: var(--muted);">Select a question on the left or add a new one.</p>
      </div>
    </div>
  `;
  renderBrandingPanel();
  renderQuestionList();
  document.getElementById('addQ').onclick = () => openEditor(null);
}

function renderQuestionList() {
  const list = document.getElementById('qlist');
  list.innerHTML = '';
  quiz.questions.forEach(q => {
    const div = document.createElement('div');
    div.className = 'qrow';
    div.draggable = true;
    div.dataset.id = q.id;
    div.innerHTML = `
      <strong style="font-family:'Inter';color:var(--muted);">${q.position}.</strong>
      <span style="flex:1;">${escapeHtml(q.text || '(untitled)')}</span>
      <span class="player-pill">${q.side_tag}</span>
    `;
    div.addEventListener('click', () => openEditor(q.id));
    addDragHandlers(div, list);
    list.appendChild(div);
  });
}

const FACE_STATES = ['winner','happy','neutral','sad','angry'];

function renderBrandingPanel() {
  const panel = document.getElementById('brandingPanel');
  const facesByKey = {};
  for (const f of (quiz.faces || [])) facesByKey[`${f.side}:${f.state}`] = f.image_path;

  panel.innerHTML = `
    <h4 style="margin: 0 0 8px;">Hero image</h4>
    <div style="display:flex; gap: 12px; align-items: center; margin-bottom: 16px;">
      ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width: 120px; height: 80px; object-fit: cover; border-radius: 8px;">` : '<div style="width:120px;height:80px;background:var(--bg);border-radius:8px;"></div>'}
      <input type="file" id="heroFile" accept="image/*">
    </div>

    <h4 style="margin: 16px 0 8px;">Couple faces</h4>
    <p style="color: var(--muted); font-size: 14px; margin: 0 0 12px;">Upload a photo for each mood. Required: ${FACE_STATES.length} per side. The display screen swaps faces based on the score.</p>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      ${['bride','groom'].map(side => `
        <div>
          <strong>${escapeHtml(side === 'bride' ? quiz.bride_label : quiz.groom_label)}</strong>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
            ${FACE_STATES.map(st => `
              <div style="text-align: center;">
                <div style="font-family:'Inter';font-size:12px;color:var(--muted);">${st}</div>
                ${facesByKey[`${side}:${st}`]
                  ? `<img src="${facesByKey[`${side}:${st}`]}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;">`
                  : `<div style="width:64px;height:64px;border-radius:50%;background:var(--bg);margin:0 auto;"></div>`}
                <input type="file" accept="image/*" data-side="${side}" data-state="${st}" style="font-size:11px; margin-top:4px;">
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
    <p id="faceMsg" style="color: var(--success); margin-top: 12px; min-height: 18px; font-family: 'Inter';"></p>
  `;

  document.getElementById('heroFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('image', f);
    const up = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!up.ok) { document.getElementById('faceMsg').textContent = 'Upload failed'; return; }
    const { path } = await up.json();
    await fetch(`/api/quiz?token=${token}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hero_image_path: path })
    });
    document.getElementById('faceMsg').textContent = 'Hero image saved';
    await loadQuiz();
  });

  panel.querySelectorAll('input[type="file"][data-side]').forEach(input => {
    input.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const side = e.target.dataset.side, state = e.target.dataset.state;
      const fd = new FormData(); fd.append('image', f);
      const up = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!up.ok) { document.getElementById('faceMsg').textContent = 'Upload failed'; return; }
      const { path } = await up.json();
      const r = await fetch(`/api/quiz/${token}/face`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ side, state, image_path: path })
      });
      if (!r.ok) { document.getElementById('faceMsg').textContent = 'Save failed'; return; }
      document.getElementById('faceMsg').textContent = `Saved ${side} · ${state}`;
      await loadQuiz();
    });
  });
}
```

- [ ] **Step 2: Add a readiness check** — host can't `Start game` if any face is missing. In `primaryButtonLabel()`/`onPrimary()`:

```js
function facesComplete() {
  const haveByKey = new Set((quiz.faces || []).map(f => `${f.side}:${f.state}`));
  for (const side of ['bride','groom'])
    for (const st of FACE_STATES)
      if (!haveByKey.has(`${side}:${st}`)) return false;
  return true;
}

function primaryButtonLabel() {
  if (!state || state.status === 'finished' || !state.game_id) {
    return facesComplete() ? 'Start game' : 'Upload all faces first';
  }
  // ... existing branches unchanged
}

function onPrimary() {
  if (!state || !state.game_id) {
    if (!facesComplete()) { alert('Upload all 5 face images for each side before starting.'); return; }
    socket.emit('host:start'); return;
  }
  // ... existing branches unchanged
}
```

- [ ] **Step 3: Smoke test (manual)** — open `/host/<token>`, expand "Branding & couple faces", upload one face, reload, see it persist; upload all 10, then `Start game` becomes enabled.

- [ ] **Step 4: Commit**

```bash
git add public/host
git commit -m "feat: face-image and hero-image management on host edit page"
```

---

## Chunk 7: Frontend — TV display

### Task 7.1: `/display/<code>` page

**Files:**
- Create: `public/display/index.html`, `public/display/app.js`

Three states: lobby, question, reveal. Big type, high contrast, no interaction. Mood faces cross-fade on reveal.

- [ ] **Step 1: `public/display/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Display · Wedding Quiz</title>
  <link rel="stylesheet" href="/shared/styles.css">
  <style>
    body { font-size: 24px; }
    .display-shell { min-height: 100dvh; padding: 48px; display: grid; gap: 24px; }
    .lobby { text-align: center; display: grid; place-items: center; gap: 16px; }
    .hero-img { width: 100%; max-width: 1000px; max-height: 50vh; object-fit: cover; border-radius: var(--radius-lg); }
    .join-card { background: var(--surface); padding: 48px; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
    .room-code-big { font-family: 'Inter'; font-weight: 700; font-size: 96px; letter-spacing: 0.1em; color: var(--rose); }
    .question-text { font-size: 64px; line-height: 1.2; font-weight: 600; margin: 24px 0; }
    .options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .option-card { background: var(--surface); padding: 32px; border-radius: var(--radius-md); box-shadow: var(--shadow-md); position: relative; overflow: hidden; transition: transform 250ms ease-out; }
    .option-card .vote-bar { position: absolute; left: 0; right: 0; bottom: 0; background: var(--rose); opacity: 0.2; transition: height 250ms ease-out; }
    .option-letter { font-family: 'Inter'; font-weight: 700; font-size: 48px; color: var(--muted); }
    .option-text { font-size: 36px; }
    .option-card.correct { background: #FFF8E1; box-shadow: 0 0 40px rgba(184,137,58,0.4); transform: scale(1.05); }
    .option-card.wrong { opacity: 0.4; }
    .leaderboard { background: var(--surface); padding: 24px; border-radius: var(--radius-md); }
    .vs-panel { display: grid; grid-template-columns: 1fr 100px 1fr; align-items: center; gap: 16px; padding: 24px; background: var(--surface); border-radius: var(--radius-md); }
    .vs-face { width: 200px; height: 200px; border-radius: 50%; object-fit: cover; transition: opacity 250ms ease-out; }
    .vs-bar { height: 16px; background: var(--bg); border-radius: 8px; overflow: hidden; }
    .vs-bar-fill { height: 100%; background: linear-gradient(to right, var(--bride), var(--groom)); }
    .winner-glow { box-shadow: 0 0 40px var(--gold); border-radius: 50%; }
  </style>
</head>
<body>
  <div id="root" aria-live="polite"><p style="text-align:center; padding:80px;">Loading…</p></div>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/shared/icons.js"></script>
  <script src="/shared/socket.js"></script>
  <script src="/display/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/display/app.js`**

```js
(function () {
  const code = location.pathname.split('/').pop();
  let quiz = null;
  let state = null;
  let lastReveal = null;
  let answerCount = 0, answerTotal = 0;
  const root = document.getElementById('root');

  async function loadPublic() {
    const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(code)}`);
    if (!r.ok) { root.innerHTML = '<p style="text-align:center; padding:80px; color:var(--error);">Room not found.</p>'; return; }
    quiz = await r.json();
    document.title = `${quiz.name} · Display`;
    connect();
  }

  function faceUrl(side, st) {
    const f = (quiz.faces || []).find(x => x.side === side && x.state === st);
    return f ? f.image_path : '';
  }

  function connect() {
    const s = WQ_connect({ role: 'display', room_code: code });
    s.on('state', (st) => { state = st; render(); });
    s.on('question:show', (_q) => { answerCount = 0; answerTotal = state?.players?.length || 0; lastReveal = null; render(); });
    s.on('answer:received', ({ count, total }) => { answerCount = count; answerTotal = total; renderAnswerCounter(); });
    s.on('question:reveal', (r) => { lastReveal = r; render(); });
    s.on('game:finished', (r) => { lastReveal = r; state.status = 'finished'; render(); });
  }

  function renderAnswerCounter() {
    const el = document.getElementById('answerCounter');
    if (el) el.textContent = `${answerCount} / ${answerTotal} answered`;
  }

  function render() {
    if (!state) return;
    if (state.status === 'lobby') return renderLobby();
    if (state.status === 'active') return renderQuestion();
    if (state.status === 'revealing' || state.status === 'finished') return renderReveal();
    return renderLobby();
  }

  function renderLobby() {
    root.innerHTML = `
      <div class="display-shell lobby">
        ${quiz.hero_image_path ? `<img class="hero-img" src="${quiz.hero_image_path}">` : ''}
        <h1 class="font-script" style="font-size: 120px; color: ${quiz.accent_color}; margin: 0;">${escapeHtml(quiz.name)}</h1>
        <div class="join-card">
          <p style="margin:0; color: var(--muted); font-family: 'Inter'; font-size: 24px;">Join at</p>
          <p style="margin: 8px 0 24px; font-family: 'Inter'; font-weight: 700; font-size: 36px;">${location.origin}/play</p>
          <div class="room-code-big tabular">${quiz.room_code}</div>
          <p style="font-family:'Inter'; color: var(--muted); margin-top: 24px;">${state.players.length} guests joined</p>
        </div>
      </div>`;
  }

  function renderQuestion() {
    const cur = state.current_question;
    if (!cur) return;
    const letters = ['A','B','C','D'];
    root.innerHTML = `
      <div class="display-shell">
        <p class="font-ui" style="color: var(--muted); font-size: 28px;">Question ${cur.position} of ${state.total_questions}</p>
        <div style="display:grid; grid-template-columns: ${cur.image_url ? '1fr 1fr' : '1fr'}; gap: 32px; align-items: center;">
          <div>
            <h1 class="question-text">${escapeHtml(cur.text)}</h1>
          </div>
          ${cur.image_url ? `<img src="${cur.image_url}" style="width:100%; max-height: 50vh; object-fit: contain; border-radius: var(--radius-md);">` : ''}
        </div>
        <div class="options-grid">
          ${cur.options.map((o, i) => `
            <div class="option-card" data-id="${o.id}">
              <span class="option-letter">${letters[i]}</span>
              <div class="option-text">${escapeHtml(o.text)}</div>
              <div class="vote-bar" style="height: 0%;"></div>
            </div>
          `).join('')}
        </div>
        <p id="answerCounter" class="font-ui tabular" style="text-align:center; color: var(--muted);">${answerCount} / ${answerTotal} answered</p>
      </div>
    `;
  }

  function renderReveal() {
    const cur = state.current_question;
    const r = lastReveal;
    if (!cur || !r) return renderLobby();
    const letters = ['A','B','C','D'];
    const totalVotes = r.distribution.reduce((a, b) => a + b.n, 0) || 1;
    const distMap = Object.fromEntries(r.distribution.map(d => [d.option_id, d.n]));
    const top5 = (r.leaderboard || []).slice(0, 5);
    const tables = (r.table_leaderboard || []).slice(0, 5);
    const ss = r.side_states || { bride: 'neutral', groom: 'neutral' };
    const sc = r.side_scores || { bride: 0, groom: 0 };
    const sideTotal = Math.max(sc.bride + sc.groom, 1);
    const bridePct = (sc.bride / sideTotal) * 100;
    root.innerHTML = `
      <div class="display-shell">
        <h1 class="question-text">${escapeHtml(cur.text)}</h1>
        <div class="options-grid">
          ${cur.options.map((o, i) => {
            const correct = o.id === r.correct_option_id;
            const pct = ((distMap[o.id] || 0) / totalVotes) * 100;
            return `
              <div class="option-card ${correct ? 'correct' : 'wrong'}">
                <span class="option-letter">${letters[i]}</span>
                <div class="option-text">${escapeHtml(o.text)}</div>
                <div class="vote-bar" style="height: ${pct}%"></div>
              </div>`;
          }).join('')}
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px;">
          <div class="leaderboard">
            <h3>Top players</h3>
            <ol>${top5.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
          </div>
          <div class="leaderboard">
            <h3>Top ${escapeHtml(quiz.group_label || 'Tables')}</h3>
            <ol>${tables.map(t => `<li>${escapeHtml(t.group_value)} · ${t.score}</li>`).join('')}</ol>
          </div>
        </div>
        <div class="vs-panel">
          <div style="text-align:center;">
            <img class="vs-face ${ss.bride === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('bride', ss.bride)}">
            <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.bride_label)} · ${sc.bride}</div>
          </div>
          <div class="vs-bar"><div class="vs-bar-fill" style="width: ${bridePct}%;"></div></div>
          <div style="text-align:center;">
            <img class="vs-face ${ss.groom === 'winner' ? 'winner-glow' : ''}" src="${faceUrl('groom', ss.groom)}">
            <div style="font-family:'Inter';font-weight:600;margin-top:8px;">${escapeHtml(quiz.groom_label)} · ${sc.groom}</div>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  loadPublic();
})();
```

- [ ] **Step 2: Commit**

```bash
git add public/display
git commit -m "feat: TV display with lobby, question, and reveal states + VS panel"
```

---

## Chunk 8: Frontend — mobile player

### Task 8.1: `/play` page

**Files:**
- Create: `public/play/index.html`, `public/play/app.js`

Mobile-first single-column UI. Three states: join, lobby/waiting, question/reveal.

- [ ] **Step 1: `public/play/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Play · Wedding Quiz</title>
  <link rel="stylesheet" href="/shared/styles.css">
  <style>
    body { font-size: 18px; }
    main { max-width: 480px; margin: 0 auto; padding: 24px; padding-bottom: env(safe-area-inset-bottom); }
    .stage { min-height: 100dvh; display: flex; flex-direction: column; gap: 16px; }
    .opt-btn { width: 100%; min-height: 64px; font-size: 18px; padding: 16px; text-align: left; background: var(--surface); }
    .opt-btn.locked-mine { background: var(--rose); color: #fff; }
    .opt-btn.locked-other { opacity: 0.3; }
    .banner { background: var(--gold); color: #fff; padding: 8px; text-align: center; font-family: 'Inter'; font-size: 14px; border-radius: 8px; }
  </style>
</head>
<body>
  <main id="root" class="stage" aria-live="polite"><p style="text-align:center; padding-top: 80px;">Loading…</p></main>
  <script src="/socket.io/socket.io.js"></script>
  <script src="/shared/icons.js"></script>
  <script src="/shared/socket.js"></script>
  <script src="/play/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: `public/play/app.js`**

```js
(function () {
  const codeFromPath = location.pathname.startsWith('/play/') ? location.pathname.slice('/play/'.length) : '';
  let quiz = null;
  let state = null;
  let socket = null;
  let myPlayerId = null;
  let myPlayerToken = localStorage.getItem('wq_player_token') || null;
  let lastAnswerOptionId = null;
  let lastReveal = null;
  const root = document.getElementById('root');

  function setBanner(msg) {
    let b = document.getElementById('banner');
    if (!b) { b = document.createElement('div'); b.id = 'banner'; b.className = 'banner'; document.body.prepend(b); }
    b.textContent = msg;
    b.style.display = msg ? 'block' : 'none';
  }

  async function start() {
    if (!codeFromPath) { return renderJoin({ withCode: true }); }
    const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(codeFromPath)}`);
    if (!r.ok) { renderError('Room not found'); return; }
    quiz = await r.json();
    renderJoin({ withCode: false });
  }

  function renderJoin({ withCode }) {
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 24px 0;">${quiz?.name || 'Wedding Quiz'}</h1>
      <div class="card">
        ${withCode ? `<label>Room code <input id="code" maxlength="6" autocomplete="off" autocapitalize="characters" style="text-transform: uppercase; font-family: 'Inter'; letter-spacing: .1em;"></label>` : ''}
        <label>Your name <input id="name" maxlength="30" autocomplete="given-name"></label>
        <label>${escapeHtml(quiz?.group_label || 'Table')} <input id="grp" maxlength="10" inputmode="numeric"></label>
        <button class="btn btn-primary" id="joinBtn" style="width:100%; margin-top:12px;">Join</button>
        <p id="err" style="color: var(--error); margin: 8px 0 0;"></p>
      </div>
    `;
    document.getElementById('joinBtn').onclick = doJoin.bind(null, withCode);
  }

  async function doJoin(withCode) {
    const code = withCode ? document.getElementById('code').value.toUpperCase() : codeFromPath;
    const name = document.getElementById('name').value.trim();
    const grp = document.getElementById('grp').value.trim();
    if (!name || !grp || !code) { document.getElementById('err').textContent = 'Fill in all fields'; return; }
    if (!quiz) {
      const r = await fetch(`/api/quiz/by-room/${encodeURIComponent(code)}`);
      if (!r.ok) { document.getElementById('err').textContent = 'Room not found'; return; }
      quiz = await r.json();
    }
    socket = WQ_connect({ role: 'player', room_code: code, ...(myPlayerToken ? { player_token: myPlayerToken } : {}) });
    socket.on('connect', () => setBanner(''));
    socket.on('disconnect', () => setBanner('Reconnecting…'));
    socket.on('connect_error', (e) => {
      if (String(e.message).includes('no_active_game')) document.getElementById('err').textContent = 'Game has not started yet.';
      else document.getElementById('err').textContent = e.message || 'Connection error';
    });
    socket.on('joined', (j) => {
      myPlayerId = j.player_id;
      myPlayerToken = j.player_token;
      localStorage.setItem('wq_player_token', myPlayerToken);
    });
    socket.on('error', (e) => {
      if (e.code === 'name_taken') {
        document.getElementById('err').textContent = 'That name is taken — pick another.';
      } else {
        document.getElementById('err').textContent = e.code || 'Error';
      }
    });
    socket.on('state', (st) => { state = st; render(); });
    socket.on('question:show', () => { lastAnswerOptionId = null; lastReveal = null; render(); });
    socket.on('question:reveal', (r) => { lastReveal = r; render(); });
    socket.on('game:finished', (r) => { lastReveal = r; state.status = 'finished'; render(); });
    socket.on('player:kicked', () => { renderError('You were removed by the host.'); });

    // If we have a token, the server may auto-emit `joined` — give it a tick.
    setTimeout(() => {
      if (!myPlayerId) socket.emit('player:join', { name, group_value: grp });
    }, 100);
  }

  function render() {
    if (!state) return;
    if (state.status === 'lobby') return renderLobby();
    if (state.status === 'active') return renderQuestion();
    if (state.status === 'revealing') return renderRevealMine();
    if (state.status === 'finished') return renderFinished();
  }

  function renderLobby() {
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 8px 0;">${escapeHtml(quiz.name)}</h1>
      ${quiz.hero_image_path ? `<img src="${quiz.hero_image_path}" style="width:100%; border-radius: 16px; max-height: 240px; object-fit:cover;">` : ''}
      <p style="text-align:center; color: var(--muted);">Welcome — waiting for the host…</p>
      <p style="text-align:center; font-family: 'Inter'; font-size: 14px; color: var(--muted);">${state.players.length} guests in the lobby</p>
    `;
  }

  function renderQuestion() {
    const cur = state.current_question;
    if (!cur) return;
    root.innerHTML = `
      <p class="font-ui" style="color: var(--muted); font-size: 14px;">Question ${cur.position} of ${state.total_questions}</p>
      <h2 style="margin: 8px 0 16px;">${escapeHtml(cur.text)}</h2>
      ${cur.image_url ? `<img src="${cur.image_url}" style="width:100%; border-radius: 12px;">` : ''}
      <div id="opts" style="display:grid; gap: 12px; margin-top: 12px;">
        ${cur.options.map((o, i) => `
          <button class="btn opt-btn" data-id="${o.id}" data-i="${i}">
            <strong>${'ABCD'[i]}.</strong> ${escapeHtml(o.text)}
          </button>
        `).join('')}
      </div>
      <p id="lockMsg" style="text-align:center; color: var(--muted); font-family:'Inter'; margin-top: 16px; display:none;">Answer locked — wait for reveal.</p>
    `;
    document.querySelectorAll('.opt-btn').forEach(btn => btn.addEventListener('click', () => commit(btn)));
  }

  function commit(btn) {
    const id = btn.dataset.id;
    if (lastAnswerOptionId) return;
    lastAnswerOptionId = id;
    btn.classList.add('locked-mine');
    btn.style.transform = 'scale(0.97)';
    setTimeout(() => btn.style.transform = '', 150);
    document.querySelectorAll('.opt-btn').forEach(b => { if (b !== btn) b.classList.add('locked-other'); b.disabled = true; });
    document.getElementById('lockMsg').style.display = 'block';
    if (navigator.vibrate) navigator.vibrate(20);
    socket.emit('player:answer', { game_id: state.game_id, question_id: state.current_question.question_id, option_id: id });
  }

  function renderRevealMine() {
    const r = lastReveal;
    const correct = r && lastAnswerOptionId === r.correct_option_id;
    const me = r ? r.leaderboard.find(p => p.id === myPlayerId) : null;
    const rank = me ? r.leaderboard.findIndex(p => p.id === myPlayerId) + 1 : null;
    const sc = r ? r.side_scores : { bride: 0, groom: 0 };
    root.innerHTML = `
      <div style="text-align:center; padding-top: 32px;">
        <div style="color: ${correct ? 'var(--success)' : 'var(--error)'};">${correct ? WQ_ICONS.checkCircle : WQ_ICONS.xCircle}</div>
        <h2 style="margin: 16px 0;">${correct ? 'Correct! +1' : 'Not quite'}</h2>
        ${me ? `<p class="font-ui">You're #${rank} with ${me.score} ${me.score === 1 ? 'point' : 'points'}</p>` : ''}
        <p class="font-ui" style="color: var(--muted);">${escapeHtml(quiz.bride_label)} ${sc.bride} · ${escapeHtml(quiz.groom_label)} ${sc.groom}</p>
      </div>
    `;
  }

  function renderFinished() {
    const r = lastReveal || {};
    const top = (r.leaderboard || []).slice(0, 3);
    const sc = r.side_scores || { bride: 0, groom: 0 };
    const winner = sc.bride > sc.groom ? quiz.bride_label : sc.groom > sc.bride ? quiz.groom_label : 'Tie';
    root.innerHTML = `
      <h1 class="font-script" style="font-size:48px; color: var(--rose); text-align:center; margin: 24px 0;">Thanks for playing!</h1>
      <div class="card">
        <h3>Top 3</h3>
        <ol>${top.map(p => `<li><strong>${escapeHtml(p.name)}</strong> · ${p.score}</li>`).join('')}</ol>
      </div>
      <div class="card">
        <strong>Winner:</strong> ${escapeHtml(winner)} (${sc.bride}–${sc.groom})
      </div>
    `;
  }

  function renderError(msg) {
    root.innerHTML = `<p style="text-align:center; padding-top: 80px; color: var(--error);">${escapeHtml(msg)}</p>`;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  start();
})();
```

- [ ] **Step 3: Commit**

```bash
git add public/play
git commit -m "feat: mobile-first player page with join, question, reveal screens"
```

### Task 8.2: Playwright e2e smoke

**Files:**
- Create: `playwright.config.js`, `tests/e2e/full-game.spec.js`

- [ ] **Step 1: `playwright.config.js`**

```js
module.exports = {
  testDir: './tests/e2e',
  timeout: 30000,
  webServer: {
    command: 'NODE_ENV=test DATA_DIR=./.tmp-e2e PORT=3100 node src/server.js',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 10000
  },
  use: { baseURL: 'http://localhost:3100' }
};
```

- [ ] **Step 2: `tests/e2e/full-game.spec.js`**

```js
const { test, expect, chromium } = require('@playwright/test');

test('end-to-end: create -> add 1 question -> start -> answer -> reveal', async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.goto('/create');
  await page.fill('[name="name"]', 'E2E Wedding');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/host/**');

  // Add a question
  await page.click('#addQ');
  await page.fill('#qtext', 'What city did they meet in?');
  await page.fill('#opts input[data-i="0"]', 'Singapore');
  await page.fill('#opts input[data-i="1"]', 'London');
  await page.click('#opts input[type="radio"][data-i="0"]');
  await page.click('#saveQ');

  // Start
  await page.click('#primaryBtn'); // Start game
  await expect(page.locator('#primaryBtn')).toHaveText(/show first question/i);

  // Open player tab using the room code from the host page
  const code = (await page.locator('#roomCode').textContent()).trim();
  const playerCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const playerPage = await playerCtx.newPage();
  await playerPage.goto('/play/' + code);
  await playerPage.fill('#name', 'Alice');
  await playerPage.fill('#grp', '7');
  await playerPage.click('#joinBtn');
  await expect(playerPage.locator('text=Welcome')).toBeVisible({ timeout: 5000 });

  // Show question + answer
  await page.click('#primaryBtn'); // Show first question
  await playerPage.locator('.opt-btn').first().click();
  await expect(playerPage.locator('#lockMsg')).toBeVisible();

  // Reveal
  await page.click('#primaryBtn'); // Reveal
  await expect(playerPage.locator('text=Correct')).toBeVisible({ timeout: 5000 });

  await browser.close();
});
```

- [ ] **Step 3: Run and commit**

```bash
npx playwright install chromium
rm -rf .tmp-e2e && npx playwright test
git add playwright.config.js tests/e2e
git commit -m "test: end-to-end happy-path smoke via Playwright"
```

---

## Chunk 9: Rate limiting, hardening, deployment

### Task 9.1: HTTP + socket rate limiting

**Files:**
- Create: `src/lib/rate-limit.js`
- Update: `src/server.js`, `src/realtime/index.js`

- [ ] **Step 1: Implement `src/lib/rate-limit.js`**

```js
const rateLimit = require('express-rate-limit');
const { LRUCache } = require('lru-cache');

const createLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true });
const playLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true });

// Socket connection rate limiter
const socketCxnLru = new LRUCache({ max: 10000, ttl: 5 * 60 * 1000 });
function socketConnectionAllowed(ip) {
  const now = Date.now();
  const record = socketCxnLru.get(ip) || { count: 0, windowStart: now };
  if (now - record.windowStart > 60 * 1000) { record.count = 0; record.windowStart = now; }
  record.count++;
  socketCxnLru.set(ip, record);
  return record.count <= 60;
}

// Per-socket emit token bucket
function makeEmitBucket({ rate = 5, burst = 10 } = {}) {
  let tokens = burst, last = Date.now();
  return function take() {
    const now = Date.now();
    tokens = Math.min(burst, tokens + (now - last) / 1000 * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1; return true;
  };
}

module.exports = { createLimiter, playLimiter, uploadLimiter, socketConnectionAllowed, makeEmitBucket };
```

- [ ] **Step 2: Wire HTTP limiters in `src/server.js`**

```js
const { createLimiter, playLimiter, uploadLimiter } = require('./lib/rate-limit');
// ...
app.use('/api/quiz', (req, res, next) => req.method === 'POST' ? createLimiter(req, res, next) : next());
app.use('/play', playLimiter);
app.use('/api/upload', uploadLimiter);
```

- [ ] **Step 3: Wire socket connection limiter + emit bucket** (in `src/realtime/index.js`)

```js
const { socketConnectionAllowed, makeEmitBucket } = require('../lib/rate-limit');
// In io.use middleware, before resolveAuth:
io.use((socket, next) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  if (!socketConnectionAllowed(ip)) return next(new Error('rate_limited'));
  next();
});
// On connection:
io.on('connection', (socket) => {
  const isHost = socket.data.ctx.role === 'host';
  const bucket = makeEmitBucket({ rate: isHost ? 10 : 5, burst: isHost ? 20 : 10 });
  socket.use((_packet, next) => bucket() ? next() : next(new Error('rate_limited')));
  // ... existing code
});
```

- [ ] **Step 4: Manual verification + commit**

```bash
git add src/lib/rate-limit.js src/server.js src/realtime/index.js
git commit -m "feat: HTTP rate limits, socket connection LRU, per-socket emit token bucket"
```

### Task 9.2: Dockerfile + docker-compose + Caddyfile + DEPLOY.md

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `DEPLOY.md`, `README.md`

- [ ] **Step 1: `Dockerfile`**

```dockerfile
FROM node:20-bookworm-slim AS base
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev
COPY . .

FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=base /app /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
CMD ["node", "src/server.js"]
```

- [ ] **Step 2: `docker-compose.yml`** (per spec §10)

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3000
      - PUBLIC_URL=${PUBLIC_URL}
    volumes:
      - ./data:/data
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    environment:
      - PUBLIC_HOST=${PUBLIC_HOST}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./data/uploads:/srv/uploads:ro
      - caddy_data:/data
      - caddy_config:/config

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: `Caddyfile`** (per spec §10)

```
{$PUBLIC_HOST} {
  encode zstd gzip
  header Strict-Transport-Security "max-age=31536000"

  handle_path /uploads/* {
    root * /srv/uploads
    file_server
  }

  reverse_proxy app:3000
}
```

- [ ] **Step 4: `DEPLOY.md`**

```markdown
# Deployment to Hetzner VPS

## Prereqs
1. A Hetzner CX11 (or larger) running Debian/Ubuntu.
2. A subdomain pointed at the VPS IPv4 (A record).
3. SSH access as root or a sudoer.

## One-time setup
```bash
ssh root@your-vps
apt-get update && apt-get install -y docker.io docker-compose-plugin git
git clone <this-repo> wedding-quiz && cd wedding-quiz
cp .env.example .env
# Edit .env -> set PUBLIC_URL=https://quiz.your-domain.com
echo 'PUBLIC_HOST=quiz.your-domain.com' >> .env
```

## Boot
```bash
docker compose --env-file .env up -d --build
```
Caddy will auto-provision a Let's Encrypt cert on the first HTTPS request.

## Backup before the wedding
```bash
tar czf wq-backup-$(date +%Y%m%d).tar.gz data/
scp root@your-vps:wq-backup-*.tar.gz ./
```

## Recovery
- Lost creator URL? Open `/create` again — old quiz is unrecoverable. Bookmark the new one.
- Server reboot mid-game? Game state is in SQLite; the host can re-open `/host/<token>` and the active game resumes.
- A guest was kicked accidentally? The kicked row in `players` is sticky. To re-allow, ask them to use a different name (their stored `player_token` will fall through to a fresh join).

## Tuning
- Default rate limits suit ~150 concurrent players. To go higher, increase `socketCxnLru` `max` and per-socket `emit-bucket` rate in `src/lib/rate-limit.js`.
```

- [ ] **Step 5: `README.md`**

```markdown
# Wedding Quiz

Self-hostable Kahoot-style live quiz for weddings. See `docs/superpowers/specs/2026-05-09-wedding-quiz-design.md` for the full design.

## Local dev
```bash
npm install
npm run dev
# open http://localhost:3000
```

## Deploy
See `DEPLOY.md`.

## Tests
```bash
npm test          # unit + integration
npm run e2e       # Playwright smoke
```
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml Caddyfile DEPLOY.md README.md
git commit -m "chore: Docker + Caddy deployment artifacts and README/DEPLOY docs"
```

### Task 9.3: Final smoke-test checklist (manual)

Document this in the PR / hand-off, no code:

- [ ] `npm test` — all green.
- [ ] `npm run e2e` — green on a clean machine (Playwright will install Chromium).
- [ ] Build the image: `docker compose build` — succeeds.
- [ ] Run locally: `docker compose up` — `localhost:3000` serves `/`.
- [ ] Create a quiz, open `/host/<token>` in one browser, `/display/<code>` in a second tab, `/play/<code>` on a phone (or a third small-viewport tab). Run a 3-question game end-to-end.
- [ ] Verify rate-limit headers on `POST /api/quiz`.
- [ ] Verify the disconnect/reconnect: kill the player tab, reopen `/play/<code>` — they rebind by token.
- [ ] Verify the host kick: `host:kick` on a player row → that browser shows the "removed" message.
- [ ] Backup the `data/` directory before pointing real DNS.
- [ ] On the VPS: confirm Caddy issued an HTTPS cert (`docker compose logs caddy | grep -i cert`).

---

## End-of-plan handoff

When this plan is fully executed, the project at `/Users/enarsee/dev/wedding-quiz` should:
- pass `npm test` (unit + integration) and `npm run e2e`
- run end-to-end via `docker compose up` against `localhost`
- be deployable to a Hetzner VPS by following `DEPLOY.md`

Subsequent work (out of scope for this plan): real-server load test with Artillery, post-game CSV export, alternate themes.
