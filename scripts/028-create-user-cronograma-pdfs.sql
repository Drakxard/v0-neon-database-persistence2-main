CREATE TABLE IF NOT EXISTS user_cronograma_pdfs (
  email TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_cronograma_pdfs_updated_at
  ON user_cronograma_pdfs (updated_at DESC);
