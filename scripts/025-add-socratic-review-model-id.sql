ALTER TABLE socratic_review_turns
ADD COLUMN IF NOT EXISTS model_id TEXT;

CREATE INDEX IF NOT EXISTS idx_socratic_review_turns_model_created
  ON socratic_review_turns (model_id, created_at DESC)
  WHERE model_id IS NOT NULL;
