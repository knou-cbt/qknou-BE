import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ExamHistoryService } from './exam-history.service';
import { GetExamHistoryQueryDto } from './dto/get-exam-history-query.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('mypage')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/users/me')
export class ExamHistoryController {
  constructor(private readonly examHistoryService: ExamHistoryService) {}

  /**
   * GET /api/users/me/exam-history
   * 풀이 기록 목록 조회 (누적, 최신순, 시험 제목 검색 + 페이지네이션)
   */
  @Get('exam-history')
  @ApiOperation({
    summary: '풀이 기록 목록 조회',
    description:
      '지금까지 제출한 시험 기록을 최신순으로 조회합니다. 시험 제목으로 검색 가능하고, data.total이 "풀었던 문제 N회" 같은 통계로 그대로 쓰입니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  async getExamHistory(
    @Query() query: GetExamHistoryQueryDto,
    @Req() req: any,
  ) {
    const data = await this.examHistoryService.getHistoryForUser(req.user.id, {
      search: query.search,
      page: query.page ?? 1,
      limit: query.limit ?? 10,
    });
    return { success: true, data };
  }

  /**
   * GET /api/users/me/exam-history/:attemptId
   * 풀이 기록 1건 상세 (문항별 정오답 포함)
   */
  @Get('exam-history/:attemptId')
  @ApiParam({ name: 'attemptId', type: Number })
  @ApiOperation({
    summary: '풀이 기록 상세 조회',
    description:
      '문항별 정오답을 포함한 풀이 기록 1건의 상세 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  @ApiResponse({
    status: 404,
    description: '기록을 찾을 수 없음 (본인 기록이 아닌 경우 포함)',
  })
  async getExamHistoryDetail(
    @Param('attemptId', ParseIntPipe) attemptId: number,
    @Req() req: any,
  ) {
    const data = await this.examHistoryService.getAttemptDetailForUser(
      req.user.id,
      attemptId,
    );
    return { success: true, data };
  }
}
