CREATE TABLE IF NOT EXISTS exam_submissions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  exam_type SMALLINT NOT NULL,
  file_url TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  parsed_result JSONB,
  error_message TEXT,
  reject_reason TEXT,
  published_exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IDX_exam_submissions_status ON exam_submissions(status);
CREATE INDEX IF NOT EXISTS IDX_exam_submissions_user_id ON exam_submissions(user_id);

-- 검수 진행 중(pending/processing/parsed)인 제출은 같은 (subject_id, year, exam_type)
-- 조합으로 동시에 여러 건 존재할 수 없음. failed/rejected는 재업로드를 허용해야
-- 하므로 이 제약에서 제외 (부분 유니크 인덱스).
CREATE UNIQUE INDEX IF NOT EXISTS UQ_exam_submissions_active
  ON exam_submissions(subject_id, year, exam_type)
  WHERE status IN ('pending', 'processing', 'parsed');

-- updated_at 자동 갱신 트리거 (explanation_reports 마이그레이션과 동일 패턴)
CREATE OR REPLACE FUNCTION update_exam_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_exam_submissions_updated_at
  BEFORE UPDATE ON exam_submissions
  FOR EACH ROW EXECUTE FUNCTION update_exam_submissions_updated_at();
