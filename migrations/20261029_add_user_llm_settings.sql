-- 사용자 개인 LLM 설정 (사용자당 1개, AI 튜터 챗봇에서만 사용)
-- api_key_encrypted는 AES-256-GCM 암호문(LLM_KEY_ENCRYPTION_KEY). 평문 저장 금지.
CREATE TABLE IF NOT EXISTS user_llm_settings (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(20) NOT NULL,
  base_url VARCHAR(500),
  model VARCHAR(200) NOT NULL,
  api_key_encrypted TEXT,
  api_key_last4 VARCHAR(4),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "UQ_user_llm_settings_user_id" UNIQUE (user_id)
);
