import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isPrivateAddress } from 'src/llm/safe-url';

/**
 * 전역 요청 제한. 내부망에서 온 요청은 제외한다.
 *
 * 프론트(Next.js) 서버의 SSR·API 라우트는 사용자 IP 없이 도커 내부망에서 직접
 * 호출하므로, 그대로 두면 모든 사용자 요청이 web 컨테이너 IP 하나로 묶여 한도를
 * 같이 쓰게 된다(챗봇 분당 10회가 서비스 전체 한도가 됨). 외부 요청은 항상 Nginx를
 * 거쳐 X-Forwarded-For에 실제 IP가 붙으므로(trust proxy) req.ip가 내부 주소일 수 없다.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request?.ip && isPrivateAddress(request.ip)) return true;
    return super.shouldSkip(context);
  }
}
