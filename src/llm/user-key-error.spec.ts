import { toUserKeyError } from './user-key-error';

describe('toUserKeyError', () => {
  const map = (error: unknown) => {
    const e = toUserKeyError(error);
    return [e.getStatus(), (e.getResponse() as any).code];
  };

  it('제공사 응답을 튜터 응답 코드로 바꾼다', () => {
    expect(map({ status: 401 })).toEqual([409, 'AI_KEY_INVALID']);
    expect(map({ status: 403 })).toEqual([409, 'AI_KEY_INVALID']);
    expect(map({ status: 429 })).toEqual([429, 'AI_QUOTA_EXCEEDED']);
    expect(map({ status: 402 })).toEqual([402, 'AI_BILLING_REQUIRED']);
    expect(map({ status: 500 })).toEqual([502, 'AI_PROVIDER_ERROR']);
    expect(map(new Error('timeout'))).toEqual([502, 'AI_PROVIDER_ERROR']);
  });

  it('제공사별 무효 키 응답 코드를 받으면 그 코드로 판단한다 (Gemini는 400)', () => {
    const e = toUserKeyError({ status: 400 }, [400, 401, 403]);
    expect([e.getStatus(), (e.getResponse() as any).code]).toEqual([
      409,
      'AI_KEY_INVALID',
    ]);
    expect(map({ status: 400 })).toEqual([502, 'AI_PROVIDER_ERROR']);
  });

  it('제공사별 크레딧 부족 표현도 결제 필요로 본다', () => {
    expect(map({ status: 429, code: 'insufficient_quota' })).toEqual([
      402,
      'AI_BILLING_REQUIRED',
    ]);
    expect(
      map({ status: 400, message: 'Your credit balance is too low' }),
    ).toEqual([402, 'AI_BILLING_REQUIRED']);
  });
});
