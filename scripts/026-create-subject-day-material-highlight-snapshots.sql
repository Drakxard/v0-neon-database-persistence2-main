CREATE TABLE IF NOT EXISTS subject_day_material_highlight_snapshots (
  material_id INTEGER PRIMARY KEY REFERENCES subject_day_materials(id) ON DELETE CASCADE,
  source_pdf_fingerprint TEXT NOT NULL,
  highlights_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
