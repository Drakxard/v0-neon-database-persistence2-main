BEGIN;

ALTER TABLE subject_shortcuts
  DROP CONSTRAINT IF EXISTS subject_shortcuts_shortcut_key_check;
ALTER TABLE subject_shortcuts
  ADD CONSTRAINT subject_shortcuts_shortcut_key_check
  CHECK (shortcut_key IN ('e_fich', 'figma', 'nlm'));

CREATE TABLE IF NOT EXISTS subject_material_containers (
  id BIGSERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('theory', 'practice', 'custom')),
  order_index INTEGER NOT NULL DEFAULT 0 CHECK (order_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subject_material_containers_name_not_blank CHECK (BTRIM(name) <> ''),
  UNIQUE (subject_id, normalized_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS subject_material_containers_fixed_kind_unique
  ON subject_material_containers (subject_id, kind)
  WHERE kind IN ('theory', 'practice');

CREATE INDEX IF NOT EXISTS subject_material_containers_subject_order_idx
  ON subject_material_containers (subject_id, order_index, id);

INSERT INTO subject_material_containers (subject_id, name, normalized_name, kind, order_index)
SELECT DISTINCT subject_id, 'Teoría', 'teoría', 'theory', 0
FROM subject_day_materials
ON CONFLICT (subject_id, normalized_name) DO NOTHING;

INSERT INTO subject_material_containers (subject_id, name, normalized_name, kind, order_index)
SELECT DISTINCT subject_id, 'Práctica', 'práctica', 'practice', 1
FROM subject_day_materials
ON CONFLICT (subject_id, normalized_name) DO NOTHING;

ALTER TABLE subject_day_materials
  ADD COLUMN IF NOT EXISTS container_id BIGINT REFERENCES subject_material_containers(id) ON DELETE RESTRICT;

UPDATE subject_day_materials AS material
SET container_id = container.id
FROM subject_material_containers AS container
WHERE material.container_id IS NULL
  AND container.subject_id = material.subject_id
  AND container.kind = material.material_type;

CREATE INDEX IF NOT EXISTS subject_day_materials_container_idx
  ON subject_day_materials (container_id, week_number, session_date, order_index);

CREATE TABLE IF NOT EXISTS material_tag_regions (
  id BIGSERIAL PRIMARY KEY,
  material_id INTEGER NOT NULL,
  tag_id BIGINT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  page_rotation INTEGER NOT NULL DEFAULT 0 CHECK (page_rotation IN (0, 90, 180, 270)),
  x1 DOUBLE PRECISION NOT NULL CHECK (x1 >= 0 AND x1 <= 1),
  y1 DOUBLE PRECISION NOT NULL CHECK (y1 >= 0 AND y1 <= 1),
  x2 DOUBLE PRECISION NOT NULL CHECK (x2 >= 0 AND x2 <= 1),
  y2 DOUBLE PRECISION NOT NULL CHECK (y2 >= 0 AND y2 <= 1),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT material_tag_regions_nonzero CHECK (ABS(x2 - x1) >= 0.005 AND ABS(y2 - y1) >= 0.005),
  CONSTRAINT material_tag_regions_assignment_fk
    FOREIGN KEY (material_id, tag_id)
    REFERENCES subject_day_material_tags(material_id, tag_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS material_tag_regions_lookup_idx
  ON material_tag_regions (material_id, tag_id, order_index, id);

COMMIT;
