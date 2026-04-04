CREATE TABLE IF NOT EXISTS subject_synthesis_weeks (
  subject_id TEXT NOT NULL,
  week_number INTEGER NOT NULL CHECK (week_number >= 0),
  exercise_solved_count INTEGER NOT NULL DEFAULT 0 CHECK (exercise_solved_count >= 0),
  exercise_total_count INTEGER NOT NULL DEFAULT 0 CHECK (exercise_total_count >= 0),
  exercise_skipped_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_subject_synthesis_weeks_updated_at
  ON subject_synthesis_weeks (updated_at DESC);
