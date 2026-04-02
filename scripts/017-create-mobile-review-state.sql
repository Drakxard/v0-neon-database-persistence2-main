CREATE TABLE IF NOT EXISTS mobile_review_state (
  device_id TEXT PRIMARY KEY,
  current_pair_id TEXT,
  current_subject_id VARCHAR(50),
  current_week_number INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_review_state_updated_at
  ON mobile_review_state (updated_at DESC);
