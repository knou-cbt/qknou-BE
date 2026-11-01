import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, OPENROUTER_APP_HEADERS } from './ai-providers';

/**
 * - valid: 제공사가 키를 받아줌
 * - invalid: 제공사가 무효 키라고 응답 (→ 400)
 * - unavailable: 제공사 장애·타임아웃·요청 제한 등 판단 불가 (→ 502, 무효로 단정하지 않음)
 */
export type KeyCheckResult = 'valid' | 'invalid' | 'unavailable';

const VERIFY_TIMEOUT_MS = 5_000;

// 토큰을 쓰는 생성 요청 대신 목록/정보 조회로 확인 → 사용자에게 요금이 나가지 않음
// invalid는 튜터 호출 오류 판단(AI_KEY_INVALID)에도 같이 씀
export const FETCH_CHECKS: Record<
  Exclude<AiProvider, 'anthropic'>,
  {
    url: string;
    headers: (key: string) => Record<string, string>;
    invalid: number[];
  }
> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    invalid: [401, 403],
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (key) => ({ 'x-goog-api-key': key }),
    // 잘못된 키는 400(API_KEY_INVALID), 권한 없는 키는 403
    invalid: [400, 401, 403],
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/key',
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      ...OPENROUTER_APP_HEADERS,
    }),
    invalid: [401, 403],
  },
};

@Injectable()
export class AiKeyVerifier {
  private readonly logger = new Logger(AiKeyVerifier.name);

  async verify(provider: AiProvider, apiKey: string): Promise<KeyCheckResult> {
    const result =
      provider === 'anthropic'
        ? await this.verifyAnthropic(apiKey)
        : await this.verifyByFetch(provider, apiKey);
    if (result === 'unavailable') {
      this.logger.warn(`${provider} 키 확인 실패 (제공사 응답 이상)`);
    }
    return result;
  }

  private async verifyByFetch(
    provider: Exclude<AiProvider, 'anthropic'>,
    apiKey: string,
  ): Promise<KeyCheckResult> {
    const check = FETCH_CHECKS[provider];
    try {
      const response = await fetch(check.url, {
        headers: check.headers(apiKey),
        redirect: 'error',
        signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      });
      if (response.ok) return 'valid';
      return check.invalid.includes(response.status)
        ? 'invalid'
        : 'unavailable';
    } catch {
      // 네트워크 오류·타임아웃. 에러 객체에 요청 헤더가 들어 있을 수 있어 로그에 남기지 않음
      return 'unavailable';
    }
  }

  private async verifyAnthropic(apiKey: string): Promise<KeyCheckResult> {
    const client = new Anthropic({
      apiKey,
      timeout: VERIFY_TIMEOUT_MS,
      maxRetries: 0,
    });
    try {
      await client.models.list({ limit: 1 });
      return 'valid';
    } catch (error) {
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      ) {
        return 'invalid';
      }
      return 'unavailable';
    }
  }
}
