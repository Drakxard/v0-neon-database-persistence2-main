BEGIN;

CREATE TABLE IF NOT EXISTS subject_shortcut_button_sets (
  subject_id VARCHAR(50) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subject_shortcut_buttons (
  id BIGSERIAL PRIMARY KEY,
  subject_id VARCHAR(50) NOT NULL REFERENCES subject_shortcut_button_sets(subject_id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (BTRIM(label) <> ''),
  url TEXT,
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subject_shortcut_buttons_subject_order_idx ON subject_shortcut_buttons (subject_id, order_index, id);

INSERT INTO subject_shortcut_button_sets (subject_id)
SELECT DISTINCT subject_id FROM subject_shortcuts
ON CONFLICT (subject_id) DO NOTHING;

INSERT INTO subject_shortcut_buttons (subject_id, label, url, order_index)
SELECT subject_id,
  CASE shortcut_key WHEN 'e_fich' THEN 'E-Fich' WHEN 'figma' THEN 'Figma' ELSE 'nlm' END,
  url,
  CASE shortcut_key WHEN 'e_fich' THEN 0 WHEN 'figma' THEN 1 ELSE 2 END
FROM subject_shortcuts
WHERE NOT EXISTS (
  SELECT 1 FROM subject_shortcut_buttons button
  WHERE button.subject_id = subject_shortcuts.subject_id
    AND button.order_index = CASE shortcut_key WHEN 'e_fich' THEN 0 WHEN 'figma' THEN 1 ELSE 2 END
)
ON CONFLICT DO NOTHING;

INSERT INTO subject_shortcut_buttons (subject_id, label, url, order_index)
SELECT subject_id, label, NULL, order_index
FROM subject_shortcut_button_sets
CROSS JOIN (VALUES ('E-Fich', 0), ('Figma', 1), ('nlm', 2)) AS defaults(label, order_index)
WHERE NOT EXISTS (
  SELECT 1 FROM subject_shortcut_buttons button
  WHERE button.subject_id = subject_shortcut_button_sets.subject_id AND button.order_index = defaults.order_index
);

COMMIT;
