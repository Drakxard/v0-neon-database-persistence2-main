CREATE TABLE IF NOT EXISTS ai_prompt (
  id SERIAL PRIMARY KEY,
  prompt TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed one row so GET always returns something
INSERT INTO ai_prompt (id, prompt)
VALUES (1, '')
ON CONFLICT (id) DO NOTHING;
