ALTER TABLE subject_day_entries
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_subject_day_entries_featured
  ON subject_day_entries (subject_id, week_number, session_date, is_featured);
