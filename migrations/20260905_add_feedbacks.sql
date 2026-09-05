CREATE TABLE IF NOT EXISTS feedbacks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  content TEXT NOT NULL,
  question_id INTEGER REFERENCES questions(id) ON DELETE SET NULL,
  page_url TEXT,
  github_issue_number INTEGER,
  github_issue_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IDX_feedbacks_question_id ON feedbacks(question_id);

CREATE TABLE IF NOT EXISTS user_feedback_limits (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT UQ_user_feedback_limits_user_date UNIQUE (user_id, date)
);
