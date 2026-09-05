-- 문항 북마크 테이블 (마이페이지 북마크 + 암기모드 북마크 공용)
CREATE TABLE IF NOT EXISTS bookmarks (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT UQ_bookmarks_user_question UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS IDX_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX IF NOT EXISTS IDX_bookmarks_question_id ON bookmarks(question_id);
