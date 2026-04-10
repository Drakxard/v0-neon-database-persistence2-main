-- One-time repair for rows left behind by the legacy audio-pair swap bug.
-- It restores temporary pair ids like:
--   originalPairId::swap::entryId::timestamp
-- back into their original pair_id. If the sibling was left with the same
-- role, the sibling is moved to the opposite role first so the unique index
-- on (pair_id, pair_role) remains satisfied.

DO $$
DECLARE
  broken_row RECORD;
  original_pair_id TEXT;
  sibling_row RECORD;
  repaired_sibling_role TEXT;
BEGIN
  FOR broken_row IN
    SELECT id, pair_id, pair_role
    FROM subject_day_entries
    WHERE pair_id LIKE '%::swap::%'
    ORDER BY updated_at ASC, id ASC
  LOOP
    original_pair_id := split_part(broken_row.pair_id, '::swap::', 1);

    IF original_pair_id IS NULL OR original_pair_id = '' THEN
      CONTINUE;
    END IF;

    SELECT id, pair_role
    INTO sibling_row
    FROM subject_day_entries
    WHERE pair_id = original_pair_id
      AND id <> broken_row.id
    ORDER BY id ASC
    LIMIT 1;

    IF sibling_row.id IS NOT NULL
      AND sibling_row.pair_role IS NOT NULL
      AND sibling_row.pair_role = broken_row.pair_role THEN
      repaired_sibling_role :=
        CASE broken_row.pair_role
          WHEN 'question' THEN 'answer'
          WHEN 'answer' THEN 'question'
          ELSE sibling_row.pair_role
        END;

      UPDATE subject_day_entries
      SET
        pair_role = repaired_sibling_role,
        updated_at = NOW()
      WHERE id = sibling_row.id;
    END IF;

    UPDATE subject_day_entries
    SET
      pair_id = original_pair_id,
      updated_at = NOW()
    WHERE id = broken_row.id;
  END LOOP;
END $$;
