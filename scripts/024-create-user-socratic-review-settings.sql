CREATE TABLE IF NOT EXISTS user_socratic_review_settings (
  email TEXT PRIMARY KEY,
  selected_model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_socratic_review_settings_updated_at
  ON user_socratic_review_settings (updated_at DESC);
