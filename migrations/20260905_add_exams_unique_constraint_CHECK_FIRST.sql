-- ⚠️ 실행 전 필수 확인: 기존 exams 데이터에 (subject_id, year, exam_type) 중복이
-- 있으면 이 마이그레이션은 실패합니다. 먼저 아래 쿼리로 중복 여부를 확인하세요.
--
--   SELECT subject_id, year, exam_type, COUNT(*)
--   FROM exams
--   GROUP BY subject_id, year, exam_type
--   HAVING COUNT(*) > 1;
--
-- 결과가 있다면 먼저 중복 데이터를 정리(또는 정책 결정)한 뒤에 이 마이그레이션을
-- 실행하세요. 결과가 없으면 안전하게 적용 가능합니다.
--
-- 이 제약이 필요한 이유: 시험지 등록(exam_submissions) 게시 시 같은 시험이
-- 중복 게시되는 걸 애플리케이션 코드(advisory lock)로 막고 있지만, DB
-- 레벨 제약까지 있어야 최종적으로 무결성이 보장됩니다.

CREATE UNIQUE INDEX IF NOT EXISTS UQ_exams_subject_year_type
  ON exams(subject_id, year, exam_type);
