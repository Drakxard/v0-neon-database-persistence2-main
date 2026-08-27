BEGIN;

ALTER TABLE subject_shortcut_buttons
  ADD COLUMN IF NOT EXISTS integration_role TEXT NULL CHECK (integration_role IN ('notebooklm')),
  ADD COLUMN IF NOT EXISTS active_section_key TEXT NULL;

UPDATE subject_shortcut_buttons
SET integration_role = 'notebooklm'
WHERE integration_role IS NULL AND LOWER(BTRIM(label)) = 'nlm';

CREATE UNIQUE INDEX IF NOT EXISTS subject_shortcut_buttons_notebooklm_unique
  ON subject_shortcut_buttons (subject_id)
  WHERE integration_role = 'notebooklm';

COMMIT;
