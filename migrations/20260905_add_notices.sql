-- 업데이트 알림: 발행용 공지(update_notices) + 내부 누적 내역(update_entries)
CREATE TABLE IF NOT EXISTS update_notices (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expose_start_at TIMESTAMPTZ NOT NULL,
  expose_end_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS update_entries (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  notice_id INTEGER REFERENCES update_notices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS IDX_update_entries_notice_id ON update_entries(notice_id);
CREATE INDEX IF NOT EXISTS IDX_update_notices_expose_window
  ON update_notices(expose_start_at, expose_end_at);
