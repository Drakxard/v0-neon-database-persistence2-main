CREATE TABLE IF NOT EXISTS subject_day_materials (
  id SERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL,
  week_number INTEGER NOT NULL CHECK (week_number >= 0),
  session_date DATE NOT NULL,
  weekday_index INTEGER NOT NULL CHECK (weekday_index >= 0 AND weekday_index <= 6),
  material_type TEXT NOT NULL CHECK (material_type IN ('theory', 'practice')),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  file_name TEXT NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_mime_type TEXT NOT NULL,
  drive_web_view_link TEXT NOT NULL DEFAULT '',
  is_checkup_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subject_day_materials_lookup
  ON subject_day_materials (subject_id, week_number, session_date, material_type, order_index);

CREATE INDEX IF NOT EXISTS idx_subject_day_materials_next_practice
  ON subject_day_materials (subject_id, session_date, material_type, is_checkup_done, order_index);
