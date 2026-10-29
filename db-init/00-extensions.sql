-- Supabase에서 이관한 데이터가 extensions.uuid_generate_v4() 등을 기본값으로 쓰므로
-- 컨테이너 최초 생성 시 자동으로 준비해둠 (postgres 이미지가 최초 1회만 실행).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
