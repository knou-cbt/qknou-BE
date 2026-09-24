#!/usr/bin/env bash
# /opt/qknou/qknou-BE 안에서 실행: bash scripts/deploy/setup-compose.sh
# 부모 폴더(/opt/qknou)에 db-init/과 최종 docker-compose.yml을 만든다.
# 시크릿이 들어가는 .env.db, qknou-BE/.env.production은 여기서 안 건드림 — 별도로 생성.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
echo "deploy dir: $DEPLOY_DIR"
cd "$DEPLOY_DIR"

mkdir -p db-init

cat > db-init/00-extensions.sql <<'EOF'
-- Supabase에서 이관한 데이터가 extensions.uuid_generate_v4() 등을 기본값으로 쓰므로
-- 컨테이너 최초 생성 시 자동으로 준비해둠 (postgres 이미지가 최초 1회만 실행).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
EOF

if [ -f docker-compose.yml ] && [ ! -f docker-compose.yml.frontend-draft.bak ]; then
  mv docker-compose.yml docker-compose.yml.frontend-draft.bak
  echo "기존 docker-compose.yml -> docker-compose.yml.frontend-draft.bak 으로 백업"
fi

cat > docker-compose.yml <<'EOF'
services:
  web:
    build:
      context: ./qknou-FE
      args:
        NEXT_PUBLIC_API_URL: https://api.qknou.kr
        NEXT_PUBLIC_SITE_URL: https://www.qknou.kr
        # Next.js의 rewrites()는 next build 시점에 routes-manifest.json에 고정됨
        # — 런타임 environment: 값만으로는 안 먹고, 빌드 타임 ARG로도 넣어줘야 함.
        # (프론트 Dockerfile도 이 ARG를 받아서 ENV로 넘기도록 되어있어야 함)
        API_PROXY_TARGET: http://app:9000
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: '3000'
      API_PROXY_TARGET: http://app:9000
    ports:
      - '127.0.0.1:3000:3000'
    depends_on:
      - app

  app:
    build:
      context: ./qknou-BE
    env_file:
      - ./qknou-BE/.env.production
    restart: unless-stopped
    ports:
      - '127.0.0.1:9000:9000'
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:17-alpine
    restart: unless-stopped
    env_file:
      - ./.env.db
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 10s
      timeout: 5s
      retries: 5
    ports:
      - '127.0.0.1:5432:5432'

volumes:
  pgdata:
EOF

echo "=== 생성된 파일 ==="
ls -la db-init/ docker-compose.yml

echo ""
echo "다음 단계:"
echo "1) $DEPLOY_DIR/.env.db 생성 (POSTGRES_DB/USER/PASSWORD)"
echo "2) $DEPLOY_DIR/qknou-BE/.env.production 존재 확인"
echo "3) cd $DEPLOY_DIR && docker compose up -d --build"
