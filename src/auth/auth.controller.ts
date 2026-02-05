import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Response } from 'express';

/** OAuth 로그인 성공 후 리다이렉트할 프론트엔드 URL (환경 변수 또는 NODE_ENV 기반) */
function getFrontendUrl(): string {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  return process.env.NODE_ENV === 'production'
    ? 'https://www.qknou.kr'
    : 'http://localhost:3001';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ========== 구글 로그인 ==========
  
  /**
   * GET /auth/google
   * 구글 로그인 시작점
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Guard가 자동으로 구글 로그인 페이지로 리다이렉트
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
  async googleAuthCallback(@Req() req, @Res() res: Response) {
    // 2. UseGuards가 Passport 호출
    //    → Passport가 구글 API 호출
    //    → validate() 실행
    //    → done(null, user) 호출
    //    → req.user에 user 담김
    
    // 3. 이제 여기가 실행됨!
    // req.user에는 GoogleStrategy에서 반환한 user 객체가 담겨있음
    const { access_token, user } = await this.authService.login(req.user);
    
    // 프론트엔드로 리다이렉트하면서 토큰을 쿼리 파라미터로 전달
    res.redirect(`${getFrontendUrl()}/auth/success?token=${access_token}`);
  }

  // ========== 카카오 로그인 ==========
  
  /**
   * GET /auth/kakao
   * 카카오 로그인 시작점
   */
  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  async kakaoAuth() {
    // Guard가 자동으로 카카오 로그인 페이지로 리다이렉트
  }

  /**
   * GET /auth/kakao/callback
   * 카카오 로그인 후 돌아오는 곳
   */
  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  async kakaoAuthCallback(@Req() req, @Res() res: Response) {
    const { access_token, user } = await this.authService.login(req.user);
    res.redirect(`${getFrontendUrl()}/auth/success?token=${access_token}`);
  }

  // ========== 테스트용 엔드포인트 ==========
  
  /**
   * GET /auth/me
   * JWT 인증 테스트용 - 현재 로그인한 사용자 정보 조회
   * Authorization 헤더에 Bearer 토큰 필요
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getCurrentUser(@Req() req) {
    return {
      message: 'JWT 인증 성공!',
      user: req.user,  // JwtStrategy에서 반환한 사용자 정보
    };
  }
}