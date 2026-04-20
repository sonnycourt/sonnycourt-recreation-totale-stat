CREATE TABLE IF NOT EXISTS es2_feedback (
  id serial PRIMARY KEY,
  token text NOT NULL,
  email text NOT NULL,
  prenom text,
  module_reached text NOT NULL,
  what_changed text NOT NULL,
  what_blocks text NOT NULL,
  help_needed text NOT NULL,
  score integer NOT NULL CHECK (score >= 1 AND score <= 10),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_es2_feedback_token ON es2_feedback(token);
CREATE INDEX IF NOT EXISTS idx_es2_feedback_email ON es2_feedback(email);
