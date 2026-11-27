# 백엔드 인수인계 현황

> 2026-10-29 기준. 인수 일정(10/27~11/2) 동안 계속 갱신하고, 11/2에 최종 인수인계 문서로 정리한다.

## 1. 시스템 구성

| 항목 | 내용 |
| --- | --- |
| 프레임워크 | NestJS 10 + TypeORM 0.3 (PostgreSQL) |
| 런타임 | Node 20 (CI·Dockerfile 기준). 로컬 Node 22에서도 빌드·테스트 통과 |
| 패키지 매니저 | **Yarn 1 (classic)** — `yarn.lock` v1 |
| 인증 | 구글/카카오 OAuth → 자체 JWT 발급(기본 7일). 관리자는 아이디/비밀번호 로그인(`role: admin` 토큰)만. 사용자 이메일은 수집하지 않음(11/15) |
| LLM | `openai` SDK로 OpenAI 호환 API 호출. 기본 LLM은 `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`(없으면 기존 `VLLM_*`/`OPENAI_*`). 모든 호출은 `src/llm/llm.service.ts` 경유. 사용자 AI 연결(BYOK)은 `src/ai-connections/` (10/31, `src/llm-settings/` 대체) |
| 파일 저장소 | Cloudflare R2 (`R2_*` 환경변수, `src/storage`) |
| 모니터링 | Sentry(`SENTRY_DSN`), New Relic(`NEW_RELIC_LICENSE_KEY`) — 둘 다 값이 있을 때만 활성화 |
| 기타 연동 | 피드백 → GitHub 저장소 md 파일(`GITHUB_*`), Discord Webhook(`DISCORD_WEBHOOK_URL`) |

### 브랜치

- `main`: 운영 브랜치. push 시 `.github/workflows/deploy.yml`이 EC2에 SSH로 접속해 `~/qknou-BE`에서 `git pull` → `yarn install` → `bash ./deploy.sh` → `pm2 save` 실행.
- `develop`: `main`과 동일 커밋(0c81f98).
- `docker`: **`main`에 머지되지 않은** Docker Compose 배포 구성(7커밋). Dockerfile, compose(base/dev/prod), Nginx 사이트 설정 3개(`default`, `www.qknou.kr`, `api.qknou.kr`), `setup-compose.sh`(`/opt/qknou`에 최종 compose 생성), `apply-nginx.sh` 포함.
- 인수 후 작업 브랜치 (아직 push 안 함):
  - `feature/handover-security` (main 기준): 10/28 API 보안·요청 제한·LLM 보호
  - `feature/llm-settings` (위 브랜치 기준): 10/29 LLM 공통화·개인 LLM·챗봇 횟수 버그 수정
  - `chore/docker-resource-limits` (docker 기준): 컨테이너 자원 제한·로그 순환
- 기타: `feature/auth`, `feature/bookmark-notes`, `fix/question-detail-exam-year`, `docs/api-v2-draft` — 정리 필요 여부 확인 필요.

### 배포 구조 (docker 브랜치 기준)

```
인터넷 ─ Nginx(호스트, Let's Encrypt)
          ├─ www.qknou.kr / qknou.kr → 127.0.0.1:3000 (web: Next.js 컨테이너)
          └─ api.qknou.kr            → 127.0.0.1:9000 (app: 이 저장소 컨테이너)
                                          └─ db: postgres:17 컨테이너 (127.0.0.1:5432)
```

~~⚠️ 확인 필요: 운영 서버가 PM2인지 Docker Compose인지 불명확~~ → 11/01 확인: Docker Compose, 서버 관리자(wyjang)가 운영. 아래 "운영 배포 / 환경변수 변경" 참고.

### 운영 배포 / 환경변수 변경 (11/01부터)

서버 관리자 운영 전달문(2026-11-01) 기준. jes는 개발과 업로드까지, 서버 반영은 자동 승격 스크립트(`bin/promote`, 관리자 영역)가 한다.

- 접속: `ssh jes@<서버 주소>` (호스트명 `r640`). 11/01부터 **키 인증만** 됨 — 새 PC는 공개키(`~/.ssh/id_ed25519.pub`)를 관리자에게 전달.
- 운영 서버의 프론트에서 백엔드로 가는 경로는 `https://www.qknou.kr/api-proxy/*`. `api.qknou.kr`은 외부에서 차단(444)되어 있으므로 OAuth 콜백 등 외부에서 들어오는 주소는 모두 `www.qknou.kr/api-proxy/...`로 등록.
- jes 계정은 `/opt/qknou/dev/`에만 쓸 수 있음. `staging/`, `prod/`(운영 env 포함), `archive/`, 서버의 소스 디렉터리는 볼 수 없음 → 운영 env 값은 직접 읽어서 확인할 수 없고, 동작으로 확인해야 함.
- 이미지 재빌드가 필요한 배포(`qknou-app.tar.gz`, `SHA256SUMS`, `*.sql`)도 같은 폴더 방식. 빌드 명령은 운영 전달문 3절 참고(`--platform linux/amd64` 필수).

**환경변수만 바꾸는 절차** (예: 11/01 Google OAuth 클라이언트 교체, 릴리스 `20261101-4`)

1. 안 쓴 릴리스 이름 고르기. 형식 `YYYYMMDD-<순번>`, 한 번 쓴 이름은 재사용 불가(실패한 것 포함).
   ```bash
   ssh jes@<서버 주소> 'grep -oE "20261101-[0-9]+" /opt/qknou/promote.log | sort -uV'
   ```
2. 로컬에 폴더를 만들고 `env.changes`(바꿀 변수만, 한 줄에 `KEY=VALUE`)와 `RELEASE.md`(항상 필수)를 작성. 저장소 밖(임시 폴더)에서 만들 것.
   ```bash
   mkdir 20261101-4 && cd 20261101-4
   umask 077
   cat > env.changes <<'EOF'
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   EOF
   chmod 600 env.changes   # 600이 아니면 검증 실패
   ```
   `RELEASE.md`에는 변경 내용, 이미지 변경 여부, DB 마이그레이션 여부, 환경변수 변경 여부를 적는다. 비밀값 자체는 적지 않는다.
3. 업로드(`-p`로 권한 유지) 후 권한 확인.
   ```bash
   cd .. && scp -rp 20261101-4 jes@<서버 주소>:/opt/qknou/dev/
   ssh jes@<서버 주소> 'ls -l /opt/qknou/dev/20261101-4/'   # env.changes가 -rw------- 인지
   ```
4. 업로드가 끝난 뒤 `READY` 생성 → 자동 반영 시작(검증 → staging → env 백업 → `app.env` 적용 → 재기동 → 헬스체크, 실패 시 자동 롤백).
   ```bash
   ssh jes@<서버 주소> 'touch /opt/qknou/dev/20261101-4/READY'
   ```
5. 결과 확인. 성공하면 로그에 `prod 반영 완료 (www 200, api health 200, app healthy)`가 남고 dev에서 폴더가 사라진다(env만 바꿀 때 약 30초).
   ```bash
   ssh jes@<서버 주소> 'grep 20261101-4 /opt/qknou/promote.log | tail'   # 요약은 cat /opt/qknou/status.txt
   ```
   검증 실패 시 폴더 안에 `FAILED`(원인 포함)와 `READY.failed`가 생긴다. 고친 뒤 두 파일을 지우고 `READY`를 다시 만들면 재시도.
6. 실제 동작으로 확인. 예: Google 키는 아래 응답의 `client_id`가 새 값인지 확인.
   ```bash
   curl -s -o /dev/null -w "%{redirect_url}\n" https://www.qknou.kr/api-proxy/auth/google
   ```
7. 관리자에게 업로드한 폴더 이름을 알린다.

비밀값은 메신저·메일·이미지로 보내지 말고 `env.changes`로만 전달한다. 업로드가 끝나면 로컬 사본은 지운다.

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
| 프록시 뒤 IP | 미설정 | `trust proxy`를 사설/루프백 대역으로 설정 → X-Forwarded-For에서 실제 IP 추출. 내부망(web 컨테이너 SSR·API 라우트) 요청은 제한 제외 |
| 챗봇 입력 | `role`에 `system` 허용(시스템 프롬프트 주입 가능), 길이 무제한 | `user`/`assistant`만, 질문 1000자·히스토리 20개×4000자 상한 |
| LLM 타임아웃 | SDK 기본값(10분, 재시도 2회) | 30초, 재시도 1회 |
| LLM 동시 호출 | 무제한 | 동시 5건 + 대기열 20건, 초과 시 503 |
| 해설 중복 생성 | 같은 문제를 동시에 열면 N번 생성 | 진행 중인 생성 1건으로 합침 |
| DB SSL | `main`은 항상 SSL → SSL 없는 DB(Docker Postgres)에 연결 불가 | `docker` 브랜치와 같이 미설정=SSL 끔(운영 Docker Postgres 기준). 관리형 DB는 `DB_SSL=true` |
| CI | 테스트 비활성화 | `yarn test` 실행 |

모든 값은 환경변수로 조정 가능(`.env.example`의 `RATE_LIMIT_*`, `LLM_*`, `DB_SSL`).

## 5. 10/29 적용 사항 (브랜치 `feature/llm-settings`, `chore/docker-resource-limits`)

| 항목 | 내용 |
| --- | --- |
| LLM 공통화 | 업체와 관계없이 `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`(+`LLM_PROVIDER`)로 전환. 기존 운영 `.env`(OPENAI_*/VLLM_*)는 수정 없이 그대로 동작. vLLM 전용 옵션은 vLLM일 때만 전송 |
| 개인 LLM | `GET/POST/PATCH/DELETE /api/users/me/llm-setting` (docs/API.md #38~41). openai/gemini/custom(OpenAI 호환). 챗봇에서만 사용 |
| 키 보관 | AES-256-GCM 암호화(`LLM_KEY_ENCRYPTION_KEY`). 응답엔 끝 4자리만, 로그에도 미기록 |
| SSRF 방지 | custom 주소는 https + 공인 IP만, 호출 때마다 재검사, 리다이렉트 미추종 |
| 정책 | 해설은 항상 기본 LLM(공용 데이터). 개인 LLM 사용 중엔 일일 횟수 미차감. 개인 LLM 실패 시 502 (기본 LLM으로 자동 전환 안 함) |
| 챗봇 횟수 버그 | 한국시간 자정 초기화, 조건부 UPDATE로 동시 요청 한도 초과 방지, 실패한 요청은 환불 |
| Docker | app/web 512MB·db 768MB·각 1 CPU 상한(서버 `.env`로 조정), V8 힙 384MB, 로그 10MB×3 순환, app `DB_SSL=false` 명시 |
| 테스트 | 119개 통과 (10/28 57개 → 62개 추가) |

### 배포 전 필수 작업
1. 운영 DB에 `migrations/20261029_add_user_llm_settings.sql` 실행.
2. 운영 `.env.production`에 `LLM_KEY_ENCRYPTION_KEY` 추가 (`openssl rand -base64 32`). 다른 시크릿과 같이 백업 — 잃어버리면 사용자들이 등록한 키를 복호화할 수 없음. 없으면 개인 LLM만 비활성화되고 나머지는 정상 동작.
3. 신규 LLM으로 바꿀 때: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` 추가 후 재시작. 롤백은 세 줄 삭제 후 재시작.
4. 운영은 Docker Compose(`/opt/qknou`, `scripts/deploy/setup-compose.sh`로 생성). 10/30에 `docker` 브랜치를 `develop`에 머지했고 `DB_SSL`은 `docker` 쪽 해석(미설정=끔)을 택함 — 현재 운영 `.env.production`을 그대로 써도 DB 연결이 유지됨.
5. `.github/workflows/deploy.yml`은 PM2 기준(`~/qknou-BE`, `deploy.sh`, `pm2 save`)이라 Docker 운영과 맞지 않음. `main` push 때 실행되므로 서버에 옛 PM2 프로세스가 남아 있지 않은지 확인 후 Docker 배포 방식으로 교체 필요.
6. 프론트 `/api/tutor/*` 라우트가 백엔드 호출 시 `X-Forwarded-For`를 전달하지 않음 → 지금은 내부 요청으로 간주돼 IP당 분당 제한이 빠짐(일일 5회 제한은 사용자 기준이라 그대로). 프론트에서 헤더를 넘기면 IP당 제한이 다시 적용됨.

## 5-1. 10/31 적용 사항 (브랜치 `feature/ai-connections`, 11/25 main 머지)

FE 마이페이지 **AI 연결** 탭(`/mypage?tab=ai`) 명세에 맞춰 10/29 개인 LLM(`/api/users/me/llm-setting`)을 **사용자 AI 연결(BYOK)** 로 교체했다. FE가 새 API만 호출하므로 옛 API·코드는 삭제.

| 항목 | 내용 |
| --- | --- |
| API | `GET/PATCH /api/users/me/ai-connections`, `PUT/DELETE /api/users/me/ai-connections/:provider` (docs/API.md #38~41) |
| 제공사 | `openrouter`·`gemini`·`openai`·`anthropic` 고정 주소만. 사용자 입력 주소(custom)·모델 선택 없음 → SSRF 표면 제거 |
| 모델 | 제공사별 `AI_DEFAULT_MODEL_*` 환경변수 |
| 키 확인 | 저장 전에 제공사 목록 조회 API로 확인(요금 없음, 5초). 무효 400 / 장애 502 |
| 키 보관 | `user_ai_connections`, AES-256-GCM, 저장마다 새 iv, AAD=`user_id:provider`(다른 행으로 옮기면 복호화 실패). 응답엔 `maskedKey`만. 해제는 물리 삭제, 탈퇴 시 CASCADE |
| 선택 | `users.active_ai_provider` (NULL=큐노 기본 AI). 처음 연결한 키는 자동 선택, 해제 시 같은 트랜잭션에서 NULL |
| 튜터 | 사용자 키 사용 중엔 일일 횟수 미차감. 실패 시 기본 AI로 대체하지 않고 `409 AI_KEY_INVALID` / `429 AI_QUOTA_EXCEEDED` / `402 AI_BILLING_REQUIRED` / `502 AI_PROVIDER_ERROR`. 응답에 `aiProvider` 추가 |
| Anthropic | `@anthropic-ai/sdk` 추가. 튜터의 Chat Completions 형식 요청을 Messages API로 변환(`src/llm/anthropic-chat.ts`) |
| 요청 제한 | PUT 사용자당 분당 5회(`UserThrottlerGuard`) |
| 로그 | Sentry `beforeSend`에서 `apiKey`, `Authorization`·`x-api-key`·`x-goog-api-key` 가림. New Relic은 기존 설정이 `authorization`·`x*` 헤더 제외 |
| 검증 | 테스트 134개 통과. 로컬 DB에 마이그레이션 적용 후(`DB_SYNCHRONIZE=false`) 실서버 호출 확인: 가짜 키 4개 제공사 모두 400, 6번째 PUT 429, 지원 안 하는 provider 400, upsert 시 connectedAt 유지, AAD 위반 409, 가짜 Gemini 키로 튜터 호출 시 409 + 횟수 미차감, 사용자 삭제 시 CASCADE |

### 배포 전 필수 작업 (10/31)
1. 운영 DB에 `migrations/20261031_add_user_ai_connections.sql` 실행. (10/29 `20261029_add_user_llm_settings.sql`은 더 이상 필요 없음. 이미 실행했다면 파일 끝 주석대로 행 0개 확인 후 DROP)
2. `.env.production`에 `AI_KEY_ENCRYPTION_KEY`(`openssl rand -base64 32`) 추가 — 10/29에 `LLM_KEY_ENCRYPTION_KEY`를 이미 넣었다면 그 값을 그대로 읽으므로 생략 가능. 백업 필수.
3. `.env.production`에 `AI_DEFAULT_MODEL_OPENAI/ANTHROPIC/GEMINI/OPENROUTER` 추가(`.env.example` 예시값을 각 제공사 문서로 확인). 빠진 제공사는 키 연결은 되지만 튜터 답변이 502.
4. 롤백: 이전 이미지로 되돌리면 새 테이블·컬럼은 무시됨(삭제 불필요).

## 6. 11/01 운영 반영

| 릴리스 | 내용 |
| --- | --- |
| `20261101-4` | Google OAuth 클라이언트를 jes 소유 GCP 프로젝트(`qknou-513408`)의 새 클라이언트(`444580444352-m0ru…`)로 교체. 기존 클라이언트(`1008059963091-j46a…`)에 www 콜백이 없어 `redirect_uri_mismatch` 발생하던 문제. 새 클라이언트의 승인된 리디렉션 URI: `http://localhost:3001/auth/google/callback`(로컬, PORT=3001), `https://api.qknou.kr/auth/google/callback`, `https://www.qknou.kr/api-proxy/auth/google/callback`(운영). 반영 후 `client_id` 교체 확인. |

- Google 클라이언트 보안 비밀번호는 콘솔에서 다시 볼 수 없음 → 분실 시 콘솔의 "Add secret"으로 새로 발급해 위 절차로 교체.
- 운영 전달문의 남은 요청: Kakao Redirect URI(`https://www.qknou.kr/api-proxy/auth/kakao/callback`) 등록, OpenAI 키 교체(401), 피드백용 GitHub 토큰을 조직·봇 계정 토큰으로 교체.

## 6-1. 11/15 해설 정책 변경

- 사용자 요청 시 해설 실시간 생성은 꺼져 있음(해설 없는 문제는 503). 다시 켜려면 env `EXPLANATION_ON_DEMAND=true`.
- 11/15 기준 문제 107,690개 중 85,449개(79%)가 해설 없음. 시험지를 더 추가하지 않으므로 아래 방식으로 한 번에 채운다.
- **일괄 입력 도구** `tools/explanation-batch.mjs` (운영 DB 권한 불필요). 산출물은 저장소 밖 `~/qknou-release/explanations/`.
  1. `extract`: 공개 API(study 모드)로 해설 없는 문제 수집
  2. `build --days 7`: 같은 문제를 묶어 한 번만 생성, `pilot.jsonl`(20개)과 `day-1..7.jsonl` 생성. 프롬프트는 서버와 동일하고 공통 지문(sharedExample)만 추가
  3. `OPENAI_API_KEY=... submit <name>` → `status` → `download <name>`: OpenAI Batch API(24시간 안에 완료)
  4. `to-sql <name> --release YYYYMMDD-n`: `~/qknou-release/<릴리스>/`에 SQL·SHA256SUMS·RELEASE.md 생성. 해설이 빈 문제만 채우고 기존 해설은 덮어쓰지 않음. 실패분은 `retry <name>`으로 다시 배치 파일 생성
  5. SQL 릴리스로 업로드 → 자동 반영(DB 백업 후 적용)
- 몇 개씩 빠진 문제는 관리자 API `POST /api/tutor/explanations/backfill`로도 채울 수 있음(서버가 기본 LLM으로 생성).

## 6-2. 11/25 R2 교체, 시험지(PDF) 추가 절차

| 릴리스 | 내용 |
| --- | --- |
| `20261125-2` | R2를 새 버킷 `qknou-images`(공개 주소 `pub-03a2….r2.dev`)로 교체. 예전 공개 주소 `pub-74cc….r2.dev`는 401 — 그 주소를 가리키는 기존 문항 그림은 깨져 있음 |
| `20261125-3` | 자료구조 2015·2016, 컴퓨터구조 2015~2019, 컴파일러구성 2017~2019 (2학기 기말) 시험 10개·330문항 추가 |
| `20261125-4` | 위 10개 시험 208문항의 그림·텍스트 정리 (아래 2번 문제) |
| `20261125-5` | 자료구조 2017~2019 시험 3개·75문항 추가 (11/16에 만든 `20261116-1`은 운영에 반영된 적 없음 → 그림을 새 버킷에 다시 올려 재작성) |
| `20261126-1` | 위 13개 시험 405문항 해설 입력 (Gemini `gemini-3.8-flash`, 그림 문항은 그림 첨부해 생성). 해설이 비어 있는 문항만 채움 |
| `20261127-1` | 자료구조 2017~2019 14문항: 보기 지문의 ```` ```c ```` 코드블록·HTML 표를 원본 PDF에서 자른 그림(`v2/q###_example.png`)으로 교체 |
| `20261127-2` | 컴퓨터과학개론 2013~2019(크롤링 시험) 그림 32개 복구 — 아래 "크롤링 그림 복구" 방식 |

**크롤링 그림 복구** (예전 버킷 `pub-74cc…`는 계정 접근 불가, 401)
- 크롤링 시험 그림은 `crawled-images/exam_{연도}_sub_{과목}_q_{문항}_img{0부터}` (`_shared_img{n}`, `_c_{선택지}_img{n}`)로 저장됨(`src/crawlers/crawler.service.ts`). 원본은 `allaclass.tistory.com` 글의 그림.
- 복구: 과목 태그 페이지(`/tag/<과목> 기말시험`)에서 글 번호를 찾아 로컬에서 `NODE_ENV=development yarn crawl https://allaclass.tistory.com/<글번호> --retry` → 새 버킷에 **같은 경로**로 다시 올라감(로컬 DB에도 시험이 생김). 올라간 URL 목록으로 운영 SQL에서 해당 주소만 `replace(…, 예전 도메인, 새 도메인)`.
- 이름에 학기가 없어 같은 연도·과목의 1·2학기 시험은 그림 파일을 공유함(기존 구조 문제). 블로그 원본이 없어진 그림은 `refs/`의 PDF에서 잘라야 함.

**스캔 PDF → 운영 추가 절차** (로컬 DB에서 작업 후 SQL 릴리스로 반영. 결과물은 git 제외 폴더 `tmp/`, `~/qknou-release/`)
1. `validate-pdf-parse.py` → `seed-exam-from-pdf.py`로 로컬 DB에 저장. boto3나 `R2_*` 환경변수가 없으면 그림이 로컬 경로(`tmp/...`)로 저장되니 `upload-local-images-r2.py --apply`로 R2에 올리고 URL로 교체.
2. 스캔 PDF는 OCR이 그림을 영어 설명문(`![..](..) The diagram…`)·마크다운 표·`[그림]`으로 바꿔 넣거나 그림을 엉뚱한 문항에 붙인다(프론트는 마크다운을 렌더링하지 않아 그대로 보임). 정리:
   - `ocr-page-layout.py "<시험 폴더>" … --jobs 6` → `tmp/pdf-layout/` (Datalab 레이아웃, 페이지당 1~3분)
   - `rebuild-exam-figures.py <exam_id>…` → `tmp/figure-fix/<시험>/{crops, plan.json}`. 그림 블록을 PDF에서 잘라 다시 연결하고, 잔해가 있는 문항만 텍스트를 레이아웃 기준으로 다시 만든다. "확인필요" 출력과 crops 이미지를 눈으로 확인
   - `apply-exam-figures.py --release <이름> [--apply]` → R2 업로드 + 로컬 DB 반영 + 운영 UPDATE SQL
3. `exam-release-sql.py --release <이름> --exam-ids … --note "…"` → 시험 추가 SQL (과목·시험·문항 없을 때만 INSERT).
4. 운영에 올리기 전: 로컬 `questions` 백업, 운영과 비슷한 DB 사본에서 SQL을 두 번 실행해 중복 없음·내용 일치 확인 → 1절 절차로 업로드.

5. 해설: `generate-exam-explanations.py generate --run <이름> --exam-ids …` → `tmp/explanations/<이름>/results.jsonl` (다시 실행하면 성공분은 건너뜀), `to-sql --run <이름> --release <릴리스> [--apply-local]` → 해설이 빈 문항만 채우는 SQL. 공개 API를 쓰지 않으므로 봇 차단과 무관.
   - 기본은 Gemini(`GEMINI_API_KEY`), `--provider openai`면 `OPENAI_API_KEY`. Gemini API는 앱 구독(Google AI Pro 등)과 별개 — 무료 등급은 모델당 하루 20회라 AI Studio 프로젝트에 결제 연결 필요(405문항 ≈ 입력 44만·출력 12만 토큰).
   - r2.dev는 Python 기본 User-Agent를 403으로 막음(스크립트에서 지정함). 모델이 LaTeX 역슬래시를 JSON 이스케이프하지 않는 경우가 있어 `fix_latex_escapes`로 보정.

필요 패키지: `pymupdf boto3 psycopg2-binary`. R2·DB·LLM 키는 `.env.development`에서 읽음.

## 7. 남은 이슈 / 후속 작업

### 보안
- [ ] **OAuth 콜백이 JWT를 URL 쿼리(`/auth/success?token=...`)로 전달** → 브라우저 기록·서버 로그·Referer로 노출 가능. 일회용 코드 교환이나 HttpOnly 쿠키 방식으로 변경 필요(프론트 수정 동반).
- [ ] JWT 7일 만료, 강제 만료(로그아웃/탈퇴 시 무효화) 수단 없음.
- [ ] 해설 조회 API는 비로그인도 LLM 생성을 유발할 수 있음. IP당 제한은 걸었지만, 생성은 로그인 사용자만 하도록 바꿀지 결정 필요.
- [ ] Swagger(`/api-docs`)가 운영에서도 공개. 운영에서 끌지 결정 필요.
- [ ] CORS가 운영에서도 모든 `localhost` origin 허용.
- [ ] 운영 서버에서 app 포트(9000)가 외부에 직접 열려 있지 않은지 확인(열려 있으면 X-Forwarded-For 위조로 요청 제한 우회 가능).
- [ ] 운영 시크릿 보관 위치·접근자 확인 및 인수 후 키 교체(JWT_SECRET, OPENAI_API_KEY, R2, GitHub PAT, 관리자 비밀번호).

### 버그 / 품질
- [x] ~~`ChatLimitGuard` UTC 날짜·동시 요청·실패 시 차감 문제~~ → 10/29 수정.
- [ ] 요청 제한 카운터가 메모리 저장이라 인스턴스가 늘면 인스턴스별로 따로 셈(현재 단일 인스턴스면 문제없음). 확장 시 Redis 저장소로 교체.
- [ ] `README.md`가 Nest 기본 템플릿 위주 — 2절 내용으로 교체.
- [ ] 11/25 이전에 들어간 문항 그림은 예전 R2 공개 주소(`pub-74cc….r2.dev`, 401)를 가리켜 깨져 있음(예전 계정 접근 불가). 컴퓨터과학개론 2013~2019만 복구됨(`20261127-2`). 나머지 크롤링 과목도 6-2절 "크롤링 그림 복구" 방식으로 과목별 진행 필요.
- [x] ~~자료구조 2017~2019 지문의 코드블록·HTML 표~~ → `20261127-1`에서 그림으로 교체.

### 인프라 (10/28 미완료 — 서버 접근 필요)
- [x] ~~운영 배포 방식 확정(PM2 vs Docker Compose)~~ → 11/01: Docker Compose + 관리자 자동 승격. 1절 "운영 배포 / 환경변수 변경" 참고.
- [x] Docker 컨테이너 CPU·메모리 제한 → `chore/docker-resource-limits`. 서버 사양(`free -h`, `nproc`) 확인 후 기본값(2GB 기준) 조정 필요.
- [ ] DB 백업·복구 절차 확인(Docker 볼륨 `pgdata` 기준이면 `pg_dump` cron 필요).
- [ ] Nginx: 위 2개 사이트 설정 + `default`. HTTPS 인증서는 `www.qknou.kr` 하나로 `api.qknou.kr`까지 사용 중 — 인증서에 api 도메인이 포함돼 있는지 확인.

### LLM
- [ ] 신규 LLM 정보 (보류). 받으면 환경변수 3개만 바꾸면 됨 — OpenAI 호환 API가 아니면 별도 작업 필요.
- [x] 개인 LLM 등록 CRUD + API Key 암호화 저장 → 10/29.
- [ ] 프론트(후속): 챗봇에서 `AI_KEY_INVALID` 등 code 처리, 사용자 키 사용 중엔 `/api/chatbot`(운영자 키) 대체 호출 막기.
- [ ] 실제 키로 4개 제공사 연결·튜터 답변 성공 경로 확인 (로컬은 가짜 키로 실패 경로까지만 검증함). 특히 OpenRouter 무료 모델은 `response_format`(JSON) 미지원일 수 있음 → intent 분류가 `general`로 떨어지는지 확인.
- [ ] `src/llm/safe-url.ts`의 `assertSafeLlmBaseUrl`은 custom 주소가 없어져 미사용(`isPrivateAddress`만 요청 제한에서 사용). 정리 여부 결정.
