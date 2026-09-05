import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { FeedbacksService } from './feedbacks.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FeedbackLimitGuard } from './guards/feedback-limit.guard';

@ApiTags('feedbacks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/feedbacks')
export class FeedbacksController {
  constructor(private readonly feedbacksService: FeedbacksService) {}

  /**
   * POST /api/feedbacks
   * 피드백/문항 이상 제보 접수. GitHub Issue 자동 생성 + Discord 알림.
   * 로그인 필수, 일일 15회 제한.
   */
  @Post()
  @UseGuards(FeedbackLimitGuard)
  @ApiOperation({
    summary: '피드백 제출',
    description:
      '피드백/문항 이상 제보를 접수하고 GitHub Issue를 자동 생성, Discord로 알립니다. GitHub/Discord 연동이 실패해도 접수 자체는 성공 처리됩니다. 로그인 필수, 일일 15회 제한.',
  })
  @ApiResponse({ status: 201, description: '접수 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  @ApiResponse({ status: 403, description: '일일 제출 횟수 초과' })
  @ApiResponse({ status: 404, description: '문항을 찾을 수 없음' })
  async create(@Body() dto: CreateFeedbackDto, @Req() req: any) {
    const data = await this.feedbacksService.submit(
      req.user.id,
      req.user.email,
      dto,
    );
    return { success: true, data, remainingCount: req.remainingCount };
  }

  /**
   * GET /api/feedbacks/remaining-count
   * 오늘 남은 피드백 제출 가능 횟수 조회
   */
  @Get('remaining-count')
  @ApiOperation({
    summary: '남은 피드백 제출 가능 횟수 조회',
    description: '오늘 남은 피드백 제출 가능 횟수를 반환합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  async getRemainingCount(@Req() req: any) {
    const remainingCount = await this.feedbacksService.getRemainingCount(
      req.user.id,
    );
    return { success: true, remainingCount, totalLimit: 15 };
  }
}
