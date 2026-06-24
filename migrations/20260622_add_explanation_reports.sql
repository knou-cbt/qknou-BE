CREATE TABLE IF NOT EXISTS explanation_reports (
  id SERIAL PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  previous_explanation TEXT,
  regenerated_explanation TEXT,
  correct_answers JSONB NOT NULL,
  model VARCHAR(100) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT UQ_explanation_reports_question_user UNIQUE (question_id, user_id)
);

CREATE INDEX IF NOT EXISTS IDX_explanation_reports_question_id
  ON explanation_reports(question_id);

CREATE INDEX IF NOT EXISTS IDX_explanation_reports_user_id
  ON explanation_reports(user_id);

CREATE INDEX IF NOT EXISTS IDX_explanation_reports_status
  ON explanation_reports(status);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_explanation_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_explanation_reports_updated_at
  BEFORE UPDATE ON explanation_reports
  FOR EACH ROW EXECUTE FUNCTION update_explanation_reports_updated_at();
