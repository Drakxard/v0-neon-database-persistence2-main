DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'subject_day_entries'
      AND column_name = 'subject_day_material_id'
  ) THEN
    WITH ranked AS (
      SELECT
        id,
        drive_file_id,
        FIRST_VALUE(id) OVER (
          PARTITION BY drive_file_id
          ORDER BY id ASC
        ) AS canonical_id,
        ROW_NUMBER() OVER (
          PARTITION BY drive_file_id
          ORDER BY id ASC
        ) AS duplicate_rank
      FROM subject_day_materials
    )
    UPDATE subject_day_entries AS entry
    SET subject_day_material_id = ranked.canonical_id
    FROM ranked
    WHERE entry.subject_day_material_id = ranked.id
      AND ranked.duplicate_rank > 1;
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY drive_file_id
      ORDER BY id ASC
    ) AS duplicate_rank
  FROM subject_day_materials
),
deleted AS (
  DELETE FROM subject_day_materials AS material
  USING ranked
  WHERE material.id = ranked.id
    AND ranked.duplicate_rank > 1
  RETURNING material.id
),
renumbered AS (
  UPDATE subject_day_materials AS material
  SET
    order_index = numbered.new_order_index,
    updated_at = NOW()
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY subject_id, week_number, session_date, material_type
        ORDER BY order_index ASC, id ASC
      ) AS new_order_index
    FROM subject_day_materials
  ) AS numbered
  WHERE material.id = numbered.id
    AND material.order_index <> numbered.new_order_index
  RETURNING material.id
)
SELECT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_day_materials_drive_file_id_unique
  ON subject_day_materials (drive_file_id);
