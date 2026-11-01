import { BadRequestException } from '@nestjs/common';

/** FE(qknou-FE `TAiProvider`)와 문자열이 정확히 같아야 함 */
export const AI_PROVIDERS = [
  'openrouter',
  'gemini',
  'openai',
  'anthropic',
] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** 튜터 호출 모델. 이름이 자주 바뀌어 코드에 두지 않고 환경변수로 받음 */
export const DEFAULT_MODEL_ENV: Record<AiProvider, string> = {
  openai: 'AI_DEFAULT_MODEL_OPENAI',
  anthropic: 'AI_DEFAULT_MODEL_ANTHROPIC',
  gemini: 'AI_DEFAULT_MODEL_GEMINI',
  openrouter: 'AI_DEFAULT_MODEL_OPENROUTER',
};

// openai/gemini/openrouter는 OpenAI 호환 API로 호출. anthropic은 Anthropic SDK 사용
export const OPENAI_COMPATIBLE_BASE_URLS: Record<
  Exclude<AiProvider, 'anthropic'>,
  string
> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1',
};

// OpenRouter 대시보드에 앱 이름이 표시되도록 붙이는 헤더 (선택)
export const OPENROUTER_APP_HEADERS = {
  'HTTP-Referer': 'https://www.qknou.kr',
  'X-Title': 'QKNOU',
};

export const API_KEY_MIN_LENGTH = 10;
export const API_KEY_MAX_LENGTH = 512;

export function isAiProvider(value: unknown): value is AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider);
}

/** 경로 파라미터 검증. 지원하지 않는 provider면 400 */
export function parseProvider(value: string): AiProvider {
  if (!isAiProvider(value)) {
    throw new BadRequestException(
      `지원하지 않는 AI 제공사입니다. (${AI_PROVIDERS.join(', ')})`,
    );
  }
  return value;
}

/** 앞 4자 + "..." + 뒤 4자. 12자 이하 키는 앞부분을 보이지 않음 */
export function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return apiKey.length <= 12 ? `...${tail}` : `${apiKey.slice(0, 4)}...${tail}`;
}
