BEGIN;

ALTER TABLE subject_material_containers
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS subject_material_containers_subject_pinned_order_idx
  ON subject_material_containers (subject_id, is_pinned DESC, order_index, id);

COMMIT;
