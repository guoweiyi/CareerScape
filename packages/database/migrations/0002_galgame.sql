ALTER TABLE packs ADD COLUMN mode TEXT NOT NULL DEFAULT 'story' CHECK(mode IN ('story','galgame'));
ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'story' CHECK(mode IN ('story','galgame'));
CREATE TABLE galgame_instances (
  branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seed TEXT NOT NULL, player TEXT NOT NULL, begin_action_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL
);
CREATE TABLE galgame_quotas (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,day)
);
CREATE TABLE galgame_model_attempts (
  id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  model TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
  input_tokens INTEGER, output_tokens INTEGER, latency_ms INTEGER NOT NULL,
  failure_code TEXT, created_at TEXT NOT NULL
);
