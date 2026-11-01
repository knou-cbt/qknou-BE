import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

// 사용자 AI 키·토큰이 에러 이벤트로 나가지 않도록 가리는 헤더/본문 필드
const SECRET_HEADERS = [
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'cookie',
];
const SECRET_BODY_FIELDS = ['apiKey'];

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 1.0,
  enabled: !!process.env.SENTRY_DSN,
  beforeSend(event) {
    const request = event.request;
    if (request?.headers) {
      for (const name of Object.keys(request.headers)) {
        if (SECRET_HEADERS.includes(name.toLowerCase())) {
          request.headers[name] = '[Filtered]';
        }
      }
    }
    const data = request?.data;
    if (data && typeof data === 'object') {
      for (const field of SECRET_BODY_FIELDS) {
        if (field in data) {
          (data as Record<string, unknown>)[field] = '[Filtered]';
        }
      }
    } else if (
      typeof data === 'string' &&
      SECRET_BODY_FIELDS.some((f) => data.includes(`"${f}"`))
    ) {
      request!.data = '[Filtered]';
    }
    return event;
  },
});
