CREATE TABLE IF NOT EXISTS mobile_review_slots (
  id SERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL,
  weekday_index INTEGER NOT NULL CHECK (weekday_index >= 0 AND weekday_index <= 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_review_slots_lookup
  ON mobile_review_slots (weekday_index, enabled, priority DESC, start_time ASC, end_time ASC);
