-- questions 테이블에 공통보기 이미지 URL 컬럼 추가
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS shared_example_image_urls jsonb NULL;
