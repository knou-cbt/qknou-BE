#!/usr/bin/env bash
# /opt/qknou/qknou-BE 안에서 실행: bash scripts/deploy/apply-nginx.sh
# scripts/deploy/nginx/* 를 실제 nginx 설정 자리로 복사하고 reload.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/nginx"

cp "$SRC/default" /etc/nginx/sites-available/default
cp "$SRC/www.qknou.kr" /etc/nginx/sites-available/www.qknou.kr
cp "$SRC/api.qknou.kr" /etc/nginx/sites-available/api.qknou.kr

ln -sf /etc/nginx/sites-available/www.qknou.kr /etc/nginx/sites-enabled/www.qknou.kr
ln -sf /etc/nginx/sites-available/api.qknou.kr /etc/nginx/sites-enabled/api.qknou.kr

nginx -t
systemctl reload nginx

echo "=== 확인 ==="
curl -skI https://www.qknou.kr/ | head -5
echo "---"
curl -sk https://api.qknou.kr/api/health && echo
