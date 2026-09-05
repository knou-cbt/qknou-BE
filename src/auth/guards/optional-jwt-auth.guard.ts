import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Authorization 헤더가 있으면 로그인 사용자로 인식하고,
 * 없거나 유효하지 않아도 막지 않고 그냥 통과시키는 가드.
 * (예: 비로그인도 쓸 수 있지만 로그인 시엔 부가 기능이 붙는 API)
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    return user || null;
  }
}
