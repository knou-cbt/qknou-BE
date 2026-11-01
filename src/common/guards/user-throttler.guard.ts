import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 로그인 사용자 기준 요청 제한. JwtAuthGuard 뒤에 붙여서 쓴다.
 * 전역 AppThrottlerGuard는 IP 기준이고 내부망 요청을 제외하므로, 외부 API를 호출하는
 * 엔드포인트처럼 사용자별로 꼭 막아야 하는 곳에 같이 건다.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ? `user:${req.user.id}` : req.ip;
  }
}
