-- 마이페이지: 사용자별 최근 시험 풀이 기록 (user_id당 1건만 유지)
CREATE TABLE IF NOT EXISTS user_exam_attempts (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  total_questions INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT UQ_user_exam_attempts_user UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS user_exam_answers (
  id SERIAL PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES user_exam_attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  selected_answer INTEGER,
  correct_answers JSONB NOT NULL,
  is_correct BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_user_exam_answers_attempt_id ON user_exam_answers(attempt_id);
