import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const adminEmail = this.configService.get<string>('ADMIN_EMAIL');

    // 관리자 전용 로그인(아이디/비밀번호)으로 발급된 토큰
    const isRoleAdmin = user?.role === 'admin';
    // 기존 방식: 구글/카카오 로그인 이메일이 ADMIN_EMAIL과 일치
    const isEmailAdmin = Boolean(adminEmail) && user?.email === adminEmail;

    if (!isRoleAdmin && !isEmailAdmin) {
      throw new ForbiddenException('관리자 권한이 필요합니다.');
    }
    return true;
  }
}
