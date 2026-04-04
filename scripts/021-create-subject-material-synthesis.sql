CREATE TABLE IF NOT EXISTS subject_material_synthesis (
  subject_day_material_id INTEGER PRIMARY KEY REFERENCES subject_day_materials(id) ON DELETE CASCADE,
  exercise_scope_text TEXT,
  exercise_solved_count INTEGER NOT NULL DEFAULT 0 CHECK (exercise_solved_count >= 0),
  exercise_total_count INTEGER NOT NULL DEFAULT 0 CHECK (exercise_total_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_material_synthesis_updated_at
  ON subject_material_synthesis (updated_at DESC);
