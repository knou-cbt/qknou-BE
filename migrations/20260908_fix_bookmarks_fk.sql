-- bookmarks 테이블이 (개발 DB 분리 전) TypeORM synchronize로 운영에 먼저
-- 생성됐을 때 FK 제약조건이 누락된 채로 만들어진 걸 보정한다.
-- ADD CONSTRAINT는 IF NOT EXISTS를 지원하지 않아 DO 블록으로 존재 여부를 확인한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_bookmarks_user_id' AND conrelid = 'bookmarks'::regclass
  ) THEN
    ALTER TABLE bookmarks
      ADD CONSTRAINT FK_bookmarks_user_id
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_bookmarks_question_id' AND conrelid = 'bookmarks'::regclass
  ) THEN
    ALTER TABLE bookmarks
      ADD CONSTRAINT FK_bookmarks_question_id
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
  END IF;
END $$;
