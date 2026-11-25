import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { GetQuestionsQueryDto } from './dto/get-questions-query.dto';
import { FindQuestionsResponseDto } from './dto/find-questions-response.dto';
import { ExamsService } from './exams.service';
import { SubmitExamDto } from './dto/submit-exam.dto';
import { Throttle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PREVIEW_QUESTION_COUNT } from './exams.service';

@ApiTags('exams')
@Controller('api/exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) {}

  /**
   * GET /api/exams/:id/questions
   * 시험의 문제 조회. 정답·해설은 넣지 않는다(정답: GET /api/exams/:id/answers).
   *
   * - 로그인: 전체 문항 (page·limit 페이지네이션 지원)
   * - 비로그인: 앞 PREVIEW_QUESTION_COUNT 문항만 + preview 정보
   * - mode 파라미터는 예전 화면 호환용으로 받기만 하고 쓰지 않는다
   */
  @Get(':id/questions')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '시험 문제 조회',
    description: `특정 시험의 문제들을 조회합니다. 정답·해설은 포함하지 않습니다. 비로그인은 앞 ${PREVIEW_QUESTION_COUNT}문항만 받습니다. 문제/선택지 이미지는 imageUrls 배열로 제공됩니다.`,
  })
  @ApiParam({ name: 'id', description: '시험 ID', type: Number })
  @ApiOkResponse({
    description: '문제 조회 성공',
    type: FindQuestionsResponseDto,
  })
  @ApiResponse({ status: 404, description: '시험을 찾을 수 없습니다' })
  async findQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetQuestionsQueryDto,
    @Req() req: any,
  ) {
    const data = await this.examsService.findQuestions(
      id,
      Boolean(req.user?.id),
      query.page,
      query.limit,
    );
    return { success: true, data };
  }

  /**
   * GET /api/exams/:id/answers
   * 시험 정답 조회 (로그인 필요). 암기모드에서 문항 목록과 합쳐 쓴다.
   */
  @Get(':id/answers')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: '시험 정답 조회 (로그인 필요)',
    description:
      '시험의 문항별 정답(correctAnswers)을 돌려줍니다. 해설은 튜터 해설 API로 따로 받습니다.',
  })
  @ApiParam({ name: 'id', description: '시험 ID', type: Number })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '로그인 필요' })
  @ApiResponse({ status: 404, description: '시험을 찾을 수 없습니다' })
  async findAnswers(@Param('id', ParseIntPipe) id: number) {
    const data = await this.examsService.findAnswers(id);
    return { success: true, data };
  }

  /**
   * POST /api/exams/:id/submit
   */
  @Post(':id/submit')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '시험 제출',
    description:
      '시험 답안을 제출하고 채점 결과를 받습니다. 로그인 상태로 호출하면 "최근 풀이 기록"(마이페이지)에 자동 저장됩니다(이전 기록은 대체됨). 비로그인은 미리보기 문항만 채점합니다.',
  })
  @ApiParam({ name: 'id', description: '시험 ID', type: Number })
  @ApiResponse({ status: 200, description: '채점 완료' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({ status: 404, description: '시험을 찾을 수 없습니다' })
  async submitExam(
    @Param('id', ParseIntPipe) id: number,
    @Body() submitDto: SubmitExamDto,
    @Req() req: any,
  ) {
    if (!submitDto.answers || submitDto.answers.length === 0) {
      throw new BadRequestException('답안을 제출해주세요.');
    }
    const data = await this.examsService.submitExam(
      id,
      submitDto.answers,
      req.user?.id,
    );
    return { success: true, data };
  }
}
