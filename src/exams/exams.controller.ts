import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { GetQuestionsQueryDto } from './dto/get-questions-query.dto';
import { ExamsService } from './exams.service';
import { SubmitExamDto } from './dto/submit-exam.dto';

@Controller('api/exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) { }

  /**
   * GET /api/exams/:id/questions
   * 시험의 문제 조회 (페이지네이션 지원)
   * 
   * @param mode - study: 정답 포함 | test: 정답 미포함 (기본값)
   * @param page - 페이지 번호 (선택사항, 미제공 시 전체 조회)
   * @param limit - 페이지당 문제 수 (선택사항)
   * 
   * @example
   * GET /api/exams/1/questions (전체 조회)
   * GET /api/exams/1/questions?page=1&limit=5 (5개씩 페이지네이션)
   */
  @Get(':id/questions')
  async findQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetQuestionsQueryDto,
  ) {
    const data = await this.examsService.findQuestions(
      id, 
      query.mode,
      query.page,
      query.limit
    )
    return { success: true, data }
  }

  /**
   * POST /api/exams/:id/submit
   */
  @Post(':id/submit')
  async submitExam(
    @Param('id', ParseIntPipe) id: number,
    @Body() submitDto: SubmitExamDto,
  ) {
    if (!submitDto.answers || submitDto.answers.length === 0) {
      throw new BadRequestException('답안을 제출해주세요.')
    }
    const data = await this.examsService.submitExam(id, submitDto.answers)
    return { success: true, data }
  }
}
