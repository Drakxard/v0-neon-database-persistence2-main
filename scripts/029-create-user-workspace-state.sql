CREATE TABLE IF NOT EXISTS user_workspace_state (
  email TEXT PRIMARY KEY,
  active_workspace_tab_id TEXT NOT NULL DEFAULT 'main',
  workspace_tabs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_subjects_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
