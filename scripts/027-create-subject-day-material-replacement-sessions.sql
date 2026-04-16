CREATE TABLE IF NOT EXISTS subject_day_material_replacement_sessions (
  token UUID PRIMARY KEY,
  material_id INTEGER NOT NULL REFERENCES subject_day_materials(id) ON DELETE CASCADE,
  candidate_drive_file_id TEXT NOT NULL,
  candidate_file_name TEXT NOT NULL,
  source_pdf_fingerprint TEXT NOT NULL,
  candidate_pdf_fingerprint TEXT NOT NULL,
  preview_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_day_material_replacement_sessions_material
  ON subject_day_material_replacement_sessions (material_id);

CREATE INDEX IF NOT EXISTS idx_subject_day_material_replacement_sessions_expires
  ON subject_day_material_replacement_sessions (expires_at);
