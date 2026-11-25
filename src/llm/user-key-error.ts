import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 사용자 키로 제공사를 호출하다 실패했을 때의 응답. FE가 code로 안내 문구를 고른다.
 * 운영자 키로 몰래 대체하지 않는다 — 사용자는 자기 AI로 답한다고 알고 있음.
 */
export type UserKeyErrorCode =
  | 'AI_KEY_INVALID'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_BILLING_REQUIRED'
  | 'AI_PROVIDER_ERROR';

const ERRORS: Record<UserKeyErrorCode, { status: number; message: string }> = {
  AI_KEY_INVALID: {
    status: HttpStatus.CONFLICT,
    message:
      '연결한 AI 키가 더 이상 유효하지 않습니다. 마이페이지에서 다시 연결해주세요.',
  },
  AI_QUOTA_EXCEEDED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: '연결한 AI의 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.',
  },
  AI_BILLING_REQUIRED: {
    status: HttpStatus.PAYMENT_REQUIRED,
    message: '연결한 AI 계정의 크레딧 충전 또는 결제 설정이 필요합니다.',
  },
  AI_PROVIDER_ERROR: {
    status: HttpStatus.BAD_GATEWAY,
    message: '연결한 AI 제공사가 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
  },
};

export function userKeyError(code: UserKeyErrorCode): HttpException {
  const { status, message } = ERRORS[code];
  return new HttpException({ statusCode: status, code, message }, status);
}

/**
 * OpenAI SDK·Anthropic SDK 오류 모두 status/code/message를 가진다.
 * 제공사마다 크레딧 부족을 다르게 알려서(OpenAI 429 insufficient_quota,
 * Anthropic 400 "credit balance", OpenRouter 402) status만으로는 구분이 안 됨.
 */
export function toUserKeyError(
  error: unknown,
  invalidKeyStatuses: number[] = [401, 403],
): HttpException {
  const { status, code, message } = (error ?? {}) as {
    status?: number;
    code?: string;
    message?: string;
  };
  const text = message ?? '';

  if (
    status === 402 ||
    code === 'insufficient_quota' ||
    /credit balance|insufficient credits|billing/i.test(text)
  ) {
    return userKeyError('AI_BILLING_REQUIRED');
  }
  if (status !== undefined && invalidKeyStatuses.includes(status)) {
    return userKeyError('AI_KEY_INVALID');
  }
  if (status === 429) return userKeyError('AI_QUOTA_EXCEEDED');
  return userKeyError('AI_PROVIDER_ERROR');
}
