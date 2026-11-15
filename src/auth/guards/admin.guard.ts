import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 관리자 전용 로그인(아이디/비밀번호)으로 발급된 토큰만 관리자로 인정.
    // (이메일을 수집하지 않으므로 예전 ADMIN_EMAIL 방식은 제거)
    if (user?.role !== 'admin') {
      throw new ForbiddenException('관리자 권한이 필요합니다.');
    }
    return true;
  }
}
