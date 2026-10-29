import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * - openai: OpenAI 공식 API
 * - vllm: 자체 호스팅 vLLM. reasoning 모델의 thinking을 끄는 전용 옵션을 같이 보냄
 * - openai-compatible: 그 외 OpenAI 호환 API (Gemini 등). 전용 옵션 없이 표준 필드만 보냄
 */
export type LlmProvider = 'openai' | 'vllm' | 'openai-compatible';

export interface LlmConnection {
  provider: LlmProvider;
  baseURL?: string;
  apiKey: string;
  model: string;
}

/** 실제 호출에 쓰는 클라이언트 + 모델. 기본 LLM과 사용자 개인 LLM 모두 이 형태 */
export interface LlmTarget {
  client: OpenAI;
  model: string;
  provider: LlmProvider;
  /** 사용자가 등록한 개인 LLM 여부 (공용 캐시 저장 여부 등 판단에 사용) */
  isPersonal: boolean;
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
// LLM 호출 1건 타임아웃/재시도. SDK 기본값(10분, 2회 재시도)이면 응답 없는 LLM
// 서버에 요청이 수십 분씩 매달려 커넥션·메모리를 잡아먹는다.
const DEFAULT_LLM_TIMEOUT_MS = 30_000;
const DEFAULT_LLM_MAX_RETRIES = 1;

/**
 * 서비스 기본 LLM 연결 정보.
 * LLM_BASE_URL/LLM_API_KEY/LLM_MODEL(+LLM_PROVIDER)이 우선이고, 없으면 기존
 * 변수(VLLM_URL → vLLM, 그 외 OPENAI_*)로 판단한다 — 기존 운영 .env를 바꾸지
 * 않아도 동작이 그대로 유지되도록.
 */
export function resolveDefaultLlmConnection(
  configService: ConfigService,
): LlmConnection {
  const get = (key: string) => configService.get<string>(key) || undefined;
  const legacyVllmUrl = get('VLLM_URL');
  const baseURL = get('LLM_BASE_URL') ?? legacyVllmUrl;

  const provider: LlmProvider =
    (get('LLM_PROVIDER') as LlmProvider | undefined) ??
    (legacyVllmUrl && !get('LLM_BASE_URL')
      ? 'vllm'
      : baseURL
        ? 'openai-compatible'
        : 'openai');

  const apiKey =
    get('LLM_API_KEY') ??
    (provider === 'vllm' ? get('VLLM_API_KEY') : get('OPENAI_API_KEY')) ??
    // vLLM 등 인증 없는 서버도 SDK는 빈 키를 거부하므로 자리표시자를 넣음
    'not-needed';

  const model =
    get('LLM_MODEL') ??
    (provider === 'vllm' ? get('VLLM_MODEL') : undefined) ??
    get('OPENAI_MODEL') ??
    DEFAULT_OPENAI_MODEL;

  return { provider, baseURL, apiKey, model };
}

export function createLlmClient(
  connection: LlmConnection,
  configService: ConfigService,
  options: {
    maxRetries?: number;
    fetchOptions?: { redirect: RequestRedirect };
  } = {},
): OpenAI {
  return new OpenAI({
    apiKey: connection.apiKey,
    ...(connection.baseURL ? { baseURL: connection.baseURL } : {}),
    timeout: Number(
      configService.get('LLM_TIMEOUT_MS') ?? DEFAULT_LLM_TIMEOUT_MS,
    ),
    maxRetries:
      options.maxRetries ??
      Number(configService.get('LLM_MAX_RETRIES') ?? DEFAULT_LLM_MAX_RETRIES),
    ...(options.fetchOptions ? { fetchOptions: options.fetchOptions } : {}),
  });
}

/** provider별로 필요한 요청 필드를 덧붙임 */
export function withProviderParams(
  provider: LlmProvider,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  // vLLM(Qwen 등 reasoning 모델)은 기본적으로 답변 전에 긴 thinking을
  // reasoning 필드에 먼저 생성한다. 튜터 응답엔 필요 없고 지연/토큰만
  // 늘리므로, vLLM일 때만 thinking을 꺼서 호출한다. 다른 업체는 모르는
  // 필드를 거부할 수 있어 보내지 않음.
  if (provider !== 'vllm') return params;
  return {
    ...params,
    ...({ chat_template_kwargs: { enable_thinking: false } } as any),
  };
}
