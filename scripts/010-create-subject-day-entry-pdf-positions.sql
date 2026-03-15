CREATE TABLE IF NOT EXISTS subject_day_entry_pdf_positions (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES subject_day_entries(id) ON DELETE CASCADE,
  subject_day_material_id INTEGER NOT NULL REFERENCES subject_day_materials(id) ON DELETE CASCADE,
  page_num INTEGER NOT NULL CHECK (page_num >= 1),
  xp DOUBLE PRECISION NOT NULL CHECK (xp >= 0 AND xp <= 1),
  yp DOUBLE PRECISION NOT NULL CHECK (yp >= 0 AND yp <= 1),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT subject_day_entry_pdf_positions_entry_unique UNIQUE (entry_id)
);

CREATE INDEX IF NOT EXISTS idx_subject_day_entry_pdf_positions_material
  ON subject_day_entry_pdf_positions (subject_day_material_id, page_num, entry_id);
