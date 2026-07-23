BEGIN;

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#10b981',
  parent_id BIGINT REFERENCES tags(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tags_name_not_blank CHECK (BTRIM(name) <> ''),
  CONSTRAINT tags_normalized_name_not_blank CHECK (BTRIM(normalized_name) <> ''),
  CONSTRAINT tags_color_hex CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT tags_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS tags_normalized_name_unique
  ON tags (normalized_name);

CREATE INDEX IF NOT EXISTS tags_parent_id_idx
  ON tags (parent_id);

CREATE TABLE IF NOT EXISTS subject_day_material_tags (
  material_id INTEGER NOT NULL REFERENCES subject_day_materials(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (material_id, tag_id)
);

CREATE INDEX IF NOT EXISTS subject_day_material_tags_tag_id_idx
  ON subject_day_material_tags (tag_id, material_id);

COMMIT;

-- Verification (read-only):
-- SELECT COUNT(*) AS tag_count FROM tags;
-- SELECT COUNT(*) AS assignment_count FROM subject_day_material_tags;
-- SELECT material_id, tag_id, COUNT(*)
-- FROM subject_day_material_tags
-- GROUP BY material_id, tag_id
-- HAVING COUNT(*) > 1;
--
-- Rollback, only before the feature stores production data:
-- BEGIN;
-- DROP TABLE IF EXISTS subject_day_material_tags;
-- DROP TABLE IF EXISTS tags;
-- COMMIT;
