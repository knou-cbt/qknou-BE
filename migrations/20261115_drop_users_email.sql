-- 사용자 이메일 수집 중단 (2026-11-15)
-- 코드에서는 더 이상 email을 읽거나 쓰지 않는다. 이미 저장된 이메일을 지우기 위해 컬럼을 삭제한다.
-- 되돌릴 수 없음: 실행 전에 필요하면 백업할 것.
ALTER TABLE users DROP COLUMN IF EXISTS email;
