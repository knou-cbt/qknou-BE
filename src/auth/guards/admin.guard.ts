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

    if (!adminEmail || !user || user.email !== adminEmail) {
      throw new ForbiddenException('관리자 권한이 필요합니다.');
    }
    return true;
  }
}
