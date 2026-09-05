import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authorization 헤더가 아예 없으면 익명으로 통과시키지만,
 * 헤더가 있는데 토큰이 유효하지 않으면(만료/위조) 401로 막는다.
 * "로그인 안 한 사람도 쓸 수 있지만, 로그인한 사람이 토큰 문제로
 * 자기도 모르게 비로그인 취급받는" 상황을 막기 위함.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const hasAuthHeader = Boolean(request.headers?.authorization);

    if (!hasAuthHeader) {
      return null;
    }

    if (err || !user) {
      throw err instanceof Error
        ? err
        : new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    return user;
  }
}
