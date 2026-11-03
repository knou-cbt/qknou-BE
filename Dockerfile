# ---- deps: 전체 의존성 설치 (빌드용) ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- build: TS 컴파일 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

# ---- prod-deps: 프로덕션 의존성만 별도 설치 (devDependencies 제외) ----
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production

# ---- runtime: 최종 실행 이미지 ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=9000

# root 대신 node 사용자로 실행. New Relic 에이전트 로그·크롤러 로그가 /app 아래에 쓰이므로 소유권도 넘김
RUN mkdir -p logs && chown node:node /app logs

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

USER node

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1

CMD ["node", "dist/main"]
