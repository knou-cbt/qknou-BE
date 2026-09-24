import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';

@ApiTags('admin-auth')
@Controller()
export class AdminAuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/admin/auth/login
   * 관리자 로그인 (아이디/비밀번호). 구글/카카오 로그인과 별개 경로.
   */
  @Post('api/admin/auth/login')
  @ApiOperation({ summary: '관리자 로그인 (아이디/비밀번호)' })
  @ApiResponse({ status: 200, description: '로그인 성공, JWT 반환' })
  @ApiResponse({ status: 401, description: '아이디 또는 비밀번호 불일치' })
  async login(@Body() dto: AdminLoginDto) {
    return this.authService.loginAdmin(dto.username, dto.password);
  }
}
