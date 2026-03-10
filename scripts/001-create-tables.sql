-- Create daily_sessions table to track each day's overall state
CREATE TABLE IF NOT EXISTS daily_sessions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  active_subject_ids JSONB NOT NULL DEFAULT '[]',
  completed_subjects JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create subject_completions table to track completed subjects with panorama
CREATE TABLE IF NOT EXISTS subject_completions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  subject_id VARCHAR(50) NOT NULL,
  panorama TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(date, subject_id)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_daily_sessions_date ON daily_sessions(date);
CREATE INDEX IF NOT EXISTS idx_subject_completions_date ON subject_completions(date);
CREATE INDEX IF NOT EXISTS idx_subject_completions_subject_id ON subject_completions(subject_id);
