ALTER TABLE subject_day_entries
ADD COLUMN IF NOT EXISTS subject_day_material_id INTEGER REFERENCES subject_day_materials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subject_day_entries_material
  ON subject_day_entries (subject_day_material_id, order_index, id);
