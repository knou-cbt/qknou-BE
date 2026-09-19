import {
  Controller,
  ExecutionContext,
  Get,
  Injectable,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

/** OAuth 로그인 성공 후 리다이렉트할 프론트엔드 기본 URL (환경 변수 또는 NODE_ENV 기반) */
function getFrontendUrl(): string {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  return process.env.NODE_ENV === 'production'
    ? 'https://qknou-fe.onrender.com'
    : 'http://localhost:3001';
}

/**
 * /auth/google, /auth/kakao 의 redirect_uri로 허용할 프론트엔드 origin 목록.
 * ALLOWED_REDIRECT_ORIGINS 환경변수(콤마 구분)로 오버라이드 가능.
 */
function getAllowedRedirectOrigins(): string[] {
  const fromEnv = process.env.ALLOWED_REDIRECT_ORIGINS;
  if (fromEnv) {
    return fromEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://qknou-fe.onrender.com',
  ];
}

/**
 * redirect_uri로 들어온 값이 허용된 프론트엔드 origin인지 검증한다.
 * 검증 없이 그대로 리다이렉트하면 open redirect(토큰 탈취)로 이어지므로,
 * 반드시 whitelist에 있는 origin만 통과시킨다.
 */
function resolveAllowedOrigin(redirectUri: unknown): string | null {
  if (typeof redirectUri !== 'string' || !redirectUri) return null;
  let origin: string;
  try {
    origin = new URL(redirectUri).origin;
  } catch {
    return null;
  }
  return getAllowedRedirectOrigins().includes(origin) ? origin : null;
}

/** 콜백에서 state(=로그인 시작 시 검증된 redirect_uri)로 최종 리다이렉트 origin을 결정한다. */
function resolveFrontendOrigin(state: unknown): string {
  return resolveAllowedOrigin(state) ?? getFrontendUrl();
}

/**
 * redirect_uri 쿼리 파라미터를 whitelist 검증 후 OAuth state로 실어 보내는 가드.
 * @nestjs/passport의 AuthGuard는 요청별 옵션을 기본 지원하지 않으므로
 * getAuthenticateOptions를 오버라이드해서 state를 주입한다.
 */
@Injectable()
class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const origin = resolveAllowedOrigin(req.query?.redirect_uri);
    return origin ? { state: origin } : {};
  }
}

@Injectable()
class KakaoAuthGuard extends AuthGuard('kakao') {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const origin = resolveAllowedOrigin(req.query?.redirect_uri);
    return origin ? { state: origin } : {};
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ========== 구글 로그인 ==========

  /**
   * GET /auth/google
   * 구글 로그인 시작점
   */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: '구글 로그인 시작',
    description:
      '구글 OAuth 로그인 페이지로 리다이렉트합니다. Swagger에서는 테스트 불가, 브라우저에서 직접 접속하세요.',
  })
  @ApiQuery({
    name: 'redirect_uri',
    required: false,
    description:
      '로그인 성공 후 돌아갈 프론트엔드 주소. 허용된 origin(whitelist)일 때만 반영되며, ' +
      '그 외에는 서버 기본값(FRONTEND_URL)으로 리다이렉트됩니다. 예: https://qknou-fe.onrender.com',
  })
  @ApiResponse({ status: 302, description: '구글 로그인 페이지로 리다이렉트' })
  async googleAuth(@Query('redirect_uri') _redirectUri?: string) {
    // GoogleAuthGuard가 redirect_uri를 검증해 state로 실어 보내고,
    // 자동으로 구글 로그인 페이지로 리다이렉트함
  }

  /**
   * GET /auth/google/callback
   * 구글 로그인 후 돌아오는 곳
   *
   * 1. UseGuards 실행
   * 2. Passport가 validate 호출
   * 3. validate 완료
   * 4. googleAuthCallback 실행
   */
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({
    summary: '구글 로그인 콜백',
    description: '구글 로그인 후 자동으로 호출됩니다. 수동 호출 불가.',
  })
  @ApiResponse({
    status: 302,
    description: '프론트엔드로 리다이렉트 (토큰 포함)',
  })
  async googleAuthCallback(@Req() req, @Res() res: Response) {
    // 2. UseGuards가 Passport 호출
    //    → Passport가 구글 API 호출
    //    → validate() 실행
    //    → done(null, user) 호출
    //    → req.user에 user 담김

    // 3. 이제 여기가 실행됨!
    // req.user에는 GoogleStrategy에서 반환한 user 객체가 담겨있음
    const { access_token } = await this.authService.login(req.user);

    // 프론트엔드로 리다이렉트하면서 토큰을 쿼리 파라미터로 전달
    // state에는 /auth/google 호출 시 검증된 redirect_uri origin이 실려 있음 (없으면 기본값)
    const frontendOrigin = resolveFrontendOrigin(req.query?.state);
    res.redirect(`${frontendOrigin}/auth/success?token=${access_token}`);
  }

  // ========== 카카오 로그인 ==========

  /**
   * GET /auth/kakao
   * 카카오 로그인 시작점
   */
  @Get('kakao')
  @UseGuards(KakaoAuthGuard)
  @ApiOperation({
    summary: '카카오 로그인 시작',
    description:
      '카카오 OAuth 로그인 페이지로 리다이렉트합니다. Swagger에서는 테스트 불가, 브라우저에서 직접 접속하세요.',
  })
  @ApiQuery({
    name: 'redirect_uri',
    required: false,
    description:
      '로그인 성공 후 돌아갈 프론트엔드 주소. 허용된 origin(whitelist)일 때만 반영되며, ' +
      '그 외에는 서버 기본값(FRONTEND_URL)으로 리다이렉트됩니다. 예: https://qknou-fe.onrender.com',
  })
  @ApiResponse({
    status: 302,
    description: '카카오 로그인 페이지로 리다이렉트',
  })
  async kakaoAuth(@Query('redirect_uri') _redirectUri?: string) {
    // KakaoAuthGuard가 redirect_uri를 검증해 state로 실어 보내고,
    // 자동으로 카카오 로그인 페이지로 리다이렉트함
  }

  /**
   * GET /auth/kakao/callback
   * 카카오 로그인 후 돌아오는 곳
   */
  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  @ApiOperation({
    summary: '카카오 로그인 콜백',
    description: '카카오 로그인 후 자동으로 호출됩니다. 수동 호출 불가.',
  })
  @ApiResponse({
    status: 302,
    description: '프론트엔드로 리다이렉트 (토큰 포함)',
  })
  async kakaoAuthCallback(@Req() req, @Res() res: Response) {
    const { access_token } = await this.authService.login(req.user);
    const frontendOrigin = resolveFrontendOrigin(req.query?.state);
    res.redirect(`${frontendOrigin}/auth/success?token=${access_token}`);
  }

  // ========== 테스트용 엔드포인트 ==========

  /**
   * GET /auth/me
   * JWT 인증 테스트용 - 현재 로그인한 사용자 정보 조회
   * Authorization 헤더에 Bearer 토큰 필요
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: '현재 사용자 조회 (JWT 인증 테스트)',
    description:
      'JWT 토큰이 유효한지 테스트하고 현재 로그인한 사용자 정보를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'JWT 인증 성공',
    schema: {
      example: {
        message: 'JWT 인증 성공!',
        user: {
          id: 'uuid',
          email: 'user@example.com',
          name: '홍길동',
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증 실패 (토큰 없음/만료/무효)' })
  async getCurrentUser(@Req() req) {
    return {
      message: 'JWT 인증 성공!',
      user: req.user, // JwtStrategy에서 반환한 사용자 정보
    };
  }
}
