import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { GetQuestionsQueryDto } from './dto/get-questions-query.dto';
import { ExamsService } from './exams.service';
import { SubmitExamDto } from './dto/submit-exam.dto';

@Controller('api/exams')
export class ExamsController {
  constructor(private readonly examsService: ExamsService) { }

  /**
   * GET /api/exams/:id/questions
   * 시험의 전체 문제 조회
   * 
   * @param mode - study: 정답 포함 | test: 정답 미포함 (기본값)
   */
  @Get(':id/questions')
  async findQuestions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetQuestionsQueryDto,
  ) {
    const data = await this.examsService.findQuestions(id, query.mode)
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
