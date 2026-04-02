CREATE TABLE IF NOT EXISTS mobile_review_events (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  material_id INTEGER,
  pair_id TEXT,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('material_pair', 'subject_anchor', 'coverage_gap')),
  event_type TEXT NOT NULL CHECK (event_type IN ('shown', 'revealed', 'rated', 'skipped')),
  rating TEXT CHECK (rating IN ('ok', 'doubt', 'fail') OR rating IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_review_events_subject_week_created
  ON mobile_review_events (subject_id, week_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mobile_review_events_device_created
  ON mobile_review_events (device_id, created_at DESC);
