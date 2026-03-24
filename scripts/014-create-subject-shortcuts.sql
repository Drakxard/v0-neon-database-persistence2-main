CREATE TABLE IF NOT EXISTS subject_shortcuts (
  id SERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL,
  shortcut_key TEXT NOT NULL CHECK (shortcut_key IN ('e_fich', 'figma')),
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (subject_id, shortcut_key)
);

CREATE INDEX IF NOT EXISTS idx_subject_shortcuts_subject
  ON subject_shortcuts (subject_id);
