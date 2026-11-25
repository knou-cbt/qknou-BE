-- 사용자 AI 연결(BYOK): 사용자가 등록한 AI 제공사 API Key + 튜터가 쓸 제공사 선택
-- encrypted_key는 AES-256-GCM 암호문(AI_KEY_ENCRYPTION_KEY, AAD = "user_id:provider"). 평문 저장 금지.
-- users.id가 UUID라 user_id도 UUID.
BEGIN;

CREATE TABLE IF NOT EXISTS user_ai_connections (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      VARCHAR(20)  NOT NULL,
  encrypted_key BYTEA        NOT NULL,
  iv            BYTEA        NOT NULL,
  auth_tag      BYTEA        NOT NULL,
  key_version   SMALLINT     NOT NULL DEFAULT 1,
  masked_key    VARCHAR(32)  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_ai_connections UNIQUE (user_id, provider),
  CONSTRAINT ck_user_ai_connections_provider
    CHECK (provider IN ('openrouter', 'gemini', 'openai', 'anthropic'))
);

-- NULL이면 큐노 기본 AI. 값이 있으면 user_ai_connections에 같은 provider 행이 있어야 함(앱에서 보장)
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_ai_provider VARCHAR(20) NULL;

COMMIT;

-- 10/29 개인 LLM(user_llm_settings, 20261029 마이그레이션)은 이 기능으로 대체됨.
-- 운영에 그 테이블을 만들었고 행이 0개인 것을 확인했다면 정리:
--   SELECT count(*) FROM user_llm_settings;
--   DROP TABLE IF EXISTS user_llm_settings;
