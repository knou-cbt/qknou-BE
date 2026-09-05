import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ExamHistoryService } from './exam-history.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('mypage')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/users/me')
export class ExamHistoryController {
  constructor(private readonly examHistoryService: ExamHistoryService) {}

  /**
   * GET /api/users/me/exam-history
   * 최근 시험 풀이 기록 조회 (누적하지 않고 최신 1건만 존재)
   */
  @Get('exam-history')
  @ApiOperation({
    summary: '최근 시험 풀이 기록 조회',
    description:
      '가장 최근에 제출한 시험 1건과 문항별 정오답을 조회합니다. 기록이 없으면 data가 null입니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공 (기록 없으면 data: null)',
  })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  async getExamHistory(@Req() req: any) {
    const data = await this.examHistoryService.getLatestForUser(req.user.id);
    return { success: true, data };
  }
}
