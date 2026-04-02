ALTER TABLE subject_day_entries
ADD COLUMN IF NOT EXISTS pair_id TEXT,
ADD COLUMN IF NOT EXISTS pair_role TEXT CHECK (pair_role IN ('question', 'answer') OR pair_role IS NULL);

ALTER TABLE subject_day_entries
DROP CONSTRAINT IF EXISTS subject_day_entries_pair_presence_check;

ALTER TABLE subject_day_entries
ADD CONSTRAINT subject_day_entries_pair_presence_check
CHECK (
  (pair_id IS NULL AND pair_role IS NULL)
  OR (pair_id IS NOT NULL AND pair_role IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_day_entries_pair_role_unique
  ON subject_day_entries (pair_id, pair_role)
  WHERE pair_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subject_day_entries_pair_lookup
  ON subject_day_entries (pair_id, subject_day_material_id, order_index, id)
  WHERE pair_id IS NOT NULL;
