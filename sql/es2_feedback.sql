CREATE TABLE IF NOT EXISTS es2_feedback (
  id serial PRIMARY KEY,
  token text NOT NULL,
  email text NOT NULL,
  prenom text,
  module_reached text NOT NULL,
  daily_practice text NOT NULL,
  what_changed text NOT NULL,
  biggest_win text,
  what_blocks text NOT NULL,
  help_needed text NOT NULL,
  score integer NOT NULL CHECK (score >= 1 AND score <= 10),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE IF EXISTS es2_feedback
  ADD COLUMN IF NOT EXISTS daily_practice text;

ALTER TABLE IF EXISTS es2_feedback
  ADD COLUMN IF NOT EXISTS biggest_win text;

CREATE INDEX IF NOT EXISTS idx_es2_feedback_token ON es2_feedback(token);
CREATE INDEX IF NOT EXISTS idx_es2_feedback_email ON es2_feedback(email);
