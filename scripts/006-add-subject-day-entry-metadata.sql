ALTER TABLE subject_day_entries
ADD COLUMN IF NOT EXISTS custom_title TEXT,
ADD COLUMN IF NOT EXISTS practice_state TEXT CHECK (practice_state IN ('erre') OR practice_state IS NULL);

CREATE TABLE IF NOT EXISTS subject_day_entry_links (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES subject_day_entries(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_day_entry_links_entry
  ON subject_day_entry_links (entry_id, order_index, id);
