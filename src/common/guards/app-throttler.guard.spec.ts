import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

describe('AppThrottlerGuard', () => {
  const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
  const contextFor = (ip: string | undefined) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    }) as unknown as ExecutionContext;
  const shouldSkip = (ip: string | undefined) =>
    (guard as any).shouldSkip(contextFor(ip)) as Promise<boolean>;

  beforeEach(() => {
    jest
      .spyOn(ThrottlerGuard.prototype as any, 'shouldSkip')
      .mockResolvedValue(false);
  });

  it.each(['172.18.0.3', '::ffff:172.18.0.3', '127.0.0.1', '::1', '10.0.0.5'])(
    '내부 주소(%s)는 제한하지 않음',
    async (ip) => {
      await expect(shouldSkip(ip)).resolves.toBe(true);
    },
  );

  it.each(['203.0.113.7', '::ffff:203.0.113.7', '2001:db8::1', undefined])(
    '외부 주소(%s)는 기본 동작을 따름',
    async (ip) => {
      await expect(shouldSkip(ip)).resolves.toBe(false);
    },
  );
});
