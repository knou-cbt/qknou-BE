import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

function createContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('OptionalJwtAuthGuard', () => {
  let guard: OptionalJwtAuthGuard;

  beforeEach(() => {
    guard = new OptionalJwtAuthGuard();
  });

  it('Authorization 헤더가 없으면 익명(null)으로 통과시킨다', () => {
    const context = createContext({});
    const result = guard.handleRequest(null, false, null, context);
    expect(result).toBeNull();
  });

  it('헤더가 있고 유효하면 user를 그대로 반환한다', () => {
    const context = createContext({ authorization: 'Bearer valid-token' });
    const user = { id: 'u1', email: 'a@test.com' };
    const result = guard.handleRequest(null, user, null, context);
    expect(result).toBe(user);
  });

  it('헤더가 있는데 토큰이 무효하면(user=false) 401을 던진다', () => {
    const context = createContext({ authorization: 'Bearer bad-token' });
    expect(() => guard.handleRequest(null, false, null, context)).toThrow(
      UnauthorizedException,
    );
  });

  it('헤더가 있는데 err가 있으면(예: 만료) 그 에러를 그대로 던진다', () => {
    const context = createContext({ authorization: 'Bearer expired-token' });
    const originalError = new Error('jwt expired');
    expect(() =>
      guard.handleRequest(originalError, false, null, context),
    ).toThrow(originalError);
  });
});
