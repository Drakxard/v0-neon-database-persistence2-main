WITH candidate_groups AS (
  SELECT
    subject_id,
    week_number,
    session_date
  FROM subject_day_entries
  WHERE subject_day_material_id IS NULL
  GROUP BY subject_id, week_number, session_date
  HAVING COUNT(*) > 0 AND BOOL_OR(is_featured) = FALSE
),
first_entries AS (
  SELECT DISTINCT ON (entries.subject_id, entries.week_number, entries.session_date)
    entries.id
  FROM subject_day_entries AS entries
  INNER JOIN candidate_groups AS groups
    ON groups.subject_id = entries.subject_id
   AND groups.week_number = entries.week_number
   AND groups.session_date = entries.session_date
  WHERE entries.subject_day_material_id IS NULL
  ORDER BY
    entries.subject_id,
    entries.week_number,
    entries.session_date,
    entries.order_index ASC,
    entries.id ASC
)
UPDATE subject_day_entries AS entries
SET
  is_featured = TRUE,
  updated_at = NOW()
FROM first_entries
WHERE entries.id = first_entries.id
  AND entries.is_featured = FALSE;
