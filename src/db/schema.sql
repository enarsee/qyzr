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
  side_tag TEXT NOT NULL CHECK (side_tag IN ('bride','groom','neutral')),
  is_trivia INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_quiz_position ON questions(quiz_id, position);

-- migrate existing dbs (idempotent best-effort: SQLite doesn't support IF NOT EXISTS on ADD COLUMN)
-- The host code defensively reads the column with COALESCE so missing column on older dbs degrades to is_trivia=0.

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

-- Admin-managed app-wide secrets (e.g. GEMINI_API_KEY). Edited only via
-- /admin/secrets behind ADMIN_PASSWORD. Values are stored as plain text;
-- access is gated by admin auth + the SQLite file lives only in the
-- server's data volume.
CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
