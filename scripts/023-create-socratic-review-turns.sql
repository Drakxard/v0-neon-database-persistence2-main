CREATE TABLE IF NOT EXISTS socratic_review_turns (
  id BIGSERIAL PRIMARY KEY,
  pair_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  week_number INTEGER NOT NULL,
  question_entry_id INTEGER NOT NULL,
  answer_entry_id INTEGER NOT NULL,
  generated_questions_json JSONB NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  revealed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_socratic_review_turns_pair_created
  ON socratic_review_turns (pair_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_socratic_review_turns_subject_week_created
  ON socratic_review_turns (subject_id, week_number, created_at DESC);
