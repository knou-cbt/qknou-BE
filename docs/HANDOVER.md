# 백엔드 인수인계 현황

> 2026-10-28 기준. 인수 일정(10/27~11/2) 동안 계속 갱신하고, 11/2에 최종 인수인계 문서로 정리한다.

## 1. 시스템 구성

| 항목 | 내용 |
| --- | --- |
| 프레임워크 | NestJS 10 + TypeORM 0.3 (PostgreSQL) |
| 런타임 | Node 20 (CI·Dockerfile 기준). 로컬 Node 22에서도 빌드·테스트 통과 |
| 패키지 매니저 | **Yarn 1 (classic)** — `yarn.lock` v1 |
| 인증 | 구글/카카오 OAuth → 자체 JWT 발급(기본 7일). 관리자는 `ADMIN_EMAIL` 일치 또는 아이디/비밀번호 로그인(`role: admin` 토큰) |
| LLM | `openai` SDK. 기본 OpenAI(`gpt-4o-mini`), `VLLM_URL` 설정 시 자체 호스팅 vLLM(OpenAI 호환)로 전환. 코드 위치: `src/tutor/tutor.service.ts` |
| 파일 저장소 | Cloudflare R2 (`R2_*` 환경변수, `src/storage`) |
| 모니터링 | Sentry(`SENTRY_DSN`), New Relic(`NEW_RELIC_LICENSE_KEY`) — 둘 다 값이 있을 때만 활성화 |
| 기타 연동 | 피드백 → GitHub Issue(`GITHUB_*`), Discord Webhook(`DISCORD_WEBHOOK_URL`) |

### 브랜치

- `main`: 운영 브랜치. push 시 `.github/workflows/deploy.yml`이 EC2에 SSH로 접속해 `~/qknou-BE`에서 `git pull` → `yarn install` → `bash ./deploy.sh` → `pm2 save` 실행.
- `develop`: `main`과 동일 커밋(0c81f98).
- `docker`: **`main`에 머지되지 않은** Docker Compose 배포 구성(7커밋). Dockerfile, compose(base/dev/prod), Nginx 사이트 설정 3개(`default`, `www.qknou.kr`, `api.qknou.kr`), `setup-compose.sh`(`/opt/qknou`에 최종 compose 생성), `apply-nginx.sh` 포함.
- 기타: `feature/auth`, `feature/bookmark-notes`, `fix/question-detail-exam-year`, `docs/api-v2-draft` — 정리 필요 여부 확인 필요.

### 배포 구조 (docker 브랜치 기준)

```
인터넷 ─ Nginx(호스트, Let's Encrypt)
          ├─ www.qknou.kr / qknou.kr → 127.0.0.1:3000 (web: Next.js 컨테이너)
          └─ api.qknou.kr            → 127.0.0.1:9000 (app: 이 저장소 컨테이너)
                                          └─ db: postgres:17 컨테이너 (127.0.0.1:5432)
```

⚠️ **확인 필요**: 운영 서버가 지금 어느 방식으로 돌고 있는지 불명확하다. GitHub Actions는 `main`을 PM2(`~/qknou-BE`)로 배포하지만, `docker` 브랜치는 `/opt/qknou`에서 Docker Compose로 돌리는 구성이다. `deploy.sh`는 저장소에 없고 서버에만 있다. 서버 접속 후 `pm2 list`, `docker ps`, `/etc/nginx/sites-enabled/`로 실제 상태를 확인해야 한다.

## 2. 로컬 개발 환경

```bash
# 1) 의존성 (Yarn 1)
yarn install --frozen-lockfile

# 2) 로컬 DB (운영/공유 DB와 완전 분리된 컨테이너)
docker run -d --name qknou-db-local \
  -e POSTGRES_DB=qknou_dev -e POSTGRES_USER=qknou -e POSTGRES_PASSWORD=devlocal1234 \
  -p 127.0.0.1:5432:5432 -v qknou_db_local:/var/lib/postgresql/data postgres:17-alpine
docker exec qknou-db-local psql -U qknou -d qknou_dev \
  -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'

# 3) .env.development 작성 (.env.example 참고)
#    DATABASE_URL=postgresql://qknou:devlocal1234@localhost:5432/qknou_dev
#    DB_SSL=false, DB_SYNCHRONIZE=true (로컬 DB 전용!), JWT_SECRET=<아무 랜덤값>
#    GOOGLE_/KAKAO_CLIENT_ID 등은 비어 있으면 서버가 안 뜨므로 실제 값이 없으면 더미값 입력

# 4) 실행 / 검증
yarn start:dev            # http://localhost:3001 (PORT), Swagger: /api-docs
yarn lint && yarn test && yarn build
```

- 스키마: 운영/공유 DB는 `migrations/*.sql`로만 반영. `DB_SYNCHRONIZE=true`는 로컬 컨테이너 DB에서만 사용.
- 로컬 DB에는 데이터가 없다. 실데이터 테스트가 필요하면 운영 DB 덤프를 받아 복원해야 한다(접근 권한 확보 후).
- 이 머신 한정: 홈 디렉터리의 `~/.yarnrc.yml`(`yarnPath`: Yarn 4)과 `~/package.json`(`packageManager: yarn@4.6.0`) 때문에 `yarn`이 Yarn 4로 실행되어 lockfile을 바꾸려 한다. 아래처럼 Yarn 1로 실행:
  `SKIP_YARN_COREPACK_CHECK=1 YARN_IGNORE_PATH=1 npx yarn@1.22.22 install --frozen-lockfile`

## 3. API 접근 제어 현황

| 구분 | 엔드포인트 |
| --- | --- |
| 공개 | 과목·학과·시험 조회, 시험 제출(비로그인 허용), 문항 단건, 활성 공지, 해설 조회(없으면 LLM 생성), `GET /api/health`, OAuth 시작/콜백, 관리자 로그인 |
| 로그인 | 북마크, 마이페이지 풀이 기록, 피드백, 시험지 업로드, 챗봇(일 5회), 남은 횟수, `/auth/me` |
| 관리자 | 시험지 검수/게시/반려, 공지 발행, 챗봇 데이터 정리, **해설 재생성**, **health/performance·db** |

## 4. 10/28 적용 사항 (브랜치 `feature/handover-security`)

| 항목 | 변경 전 | 변경 후 |
| --- | --- | --- |
| 해설 재생성 `POST /api/tutor/questions/:id/explanation/regenerate` | **인증 없음** — 누구나 LLM 호출 + 해설 덮어쓰기 가능 | 관리자 전용 |
| `POST /users` | 인증 없이 열린 미사용 엔드포인트 | 제거 |
| `GET /api/health/db`, `/performance` | 공개 (DB 정보 노출, 실쿼리 반복 실행) | 관리자 전용 |
| 요청 제한 | 없음 | IP당 분당 120회(전역), 관리자 로그인 5회, 해설 조회 30회, 챗봇 10회. `GET /api/health` 제외 |
| 프록시 뒤 IP | 미설정 | `trust proxy`를 사설/루프백 대역으로 설정 → X-Forwarded-For에서 실제 IP 추출 |
| 챗봇 입력 | `role`에 `system` 허용(시스템 프롬프트 주입 가능), 길이 무제한 | `user`/`assistant`만, 질문 1000자·히스토리 20개×4000자 상한 |
| LLM 타임아웃 | SDK 기본값(10분, 재시도 2회) | 30초, 재시도 1회 |
| LLM 동시 호출 | 무제한 | 동시 5건 + 대기열 20건, 초과 시 503 |
| 해설 중복 생성 | 같은 문제를 동시에 열면 N번 생성 | 진행 중인 생성 1건으로 합침 |
| DB SSL | `main`은 항상 SSL → SSL 없는 DB(Docker Postgres)에 연결 불가 | `DB_SSL=false`로 끌 수 있음. 미설정 시 기존 동작(SSL) 유지 |
| CI | 테스트 비활성화 | `yarn test` 실행 |

모든 값은 환경변수로 조정 가능(`.env.example`의 `RATE_LIMIT_*`, `LLM_*`, `DB_SSL`).

## 5. 남은 이슈 / 후속 작업

### 보안
- [ ] **OAuth 콜백이 JWT를 URL 쿼리(`/auth/success?token=...`)로 전달** → 브라우저 기록·서버 로그·Referer로 노출 가능. 일회용 코드 교환이나 HttpOnly 쿠키 방식으로 변경 필요(프론트 수정 동반).
- [ ] JWT 7일 만료, 강제 만료(로그아웃/탈퇴 시 무효화) 수단 없음.
- [ ] 해설 조회 API는 비로그인도 LLM 생성을 유발할 수 있음. IP당 제한은 걸었지만, 생성은 로그인 사용자만 하도록 바꿀지 결정 필요.
- [ ] Swagger(`/api-docs`)가 운영에서도 공개. 운영에서 끌지 결정 필요.
- [ ] CORS가 운영에서도 모든 `localhost` origin 허용.
- [ ] 운영 서버에서 app 포트(9000)가 외부에 직접 열려 있지 않은지 확인(열려 있으면 X-Forwarded-For 위조로 요청 제한 우회 가능).
- [ ] 운영 시크릿 보관 위치·접근자 확인 및 인수 후 키 교체(JWT_SECRET, OPENAI_API_KEY, R2, GitHub PAT, 관리자 비밀번호).

### 버그 / 품질
- [ ] `ChatLimitGuard`: 날짜를 `toISOString()`(UTC)로 계산해서 일일 횟수가 **한국시간 오전 9시**에 초기화됨. 조회→증가가 원자적이지 않아 동시 요청 시 5회를 넘길 수 있고, LLM 호출이 실패해도 횟수가 차감됨.
- [ ] 요청 제한 카운터가 메모리 저장이라 인스턴스가 늘면 인스턴스별로 따로 셈(현재 단일 인스턴스면 문제없음). 확장 시 Redis 저장소로 교체.
- [ ] `README.md`가 Nest 기본 템플릿 위주 — 2절 내용으로 교체.

### 인프라 (10/28 미완료 — 서버 접근 필요)
- [ ] 운영 배포 방식 확정(PM2 vs Docker Compose) 후 `docker` 브랜치 머지 여부 결정.
- [ ] Docker 컨테이너 CPU·메모리 제한: 서버 사양 확인 후 compose에 `cpus`/`mem_limit` 추가.
- [ ] DB 백업·복구 절차 확인(Docker 볼륨 `pgdata` 기준이면 `pg_dump` cron 필요).
- [ ] Nginx: 위 2개 사이트 설정 + `default`. HTTPS 인증서는 `www.qknou.kr` 하나로 `api.qknou.kr`까지 사용 중 — 인증서에 api 도메인이 포함돼 있는지 확인.

### LLM (10/29)
- [ ] 신규 LLM 제공자·모델·API 문서·키 (장대표님 요청 중).
- [ ] 개인 LLM 등록 CRUD + API Key 암호화 저장.
