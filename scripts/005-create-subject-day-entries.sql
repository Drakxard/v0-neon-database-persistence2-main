CREATE TABLE IF NOT EXISTS subject_day_entries (
  id SERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL,
  week_number INTEGER NOT NULL CHECK (week_number >= 0),
  session_date DATE NOT NULL,
  weekday_index INTEGER NOT NULL CHECK (weekday_index >= 0 AND weekday_index <= 6),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  transcript_text TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_file_name TEXT NOT NULL,
  drive_mime_type TEXT NOT NULL,
  drive_web_view_link TEXT NOT NULL DEFAULT '',
  answer_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_day_entries_lookup
  ON subject_day_entries (subject_id, week_number, session_date, order_index);

CREATE INDEX IF NOT EXISTS idx_subject_day_entries_session_date
  ON subject_day_entries (session_date);
