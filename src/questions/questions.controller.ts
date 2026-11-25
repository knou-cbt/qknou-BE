import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { QuestionsService } from './questions.service';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';

@ApiTags('questions')
@Controller('api/questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  /**
   * GET /api/questions/:id
   * 문항 단건 공개 조회. 암기모드 화면 진입 및 공유 링크의 데이터 소스.
   * 로그인 없이도 접근 가능하나 정답·해설은 로그인 시에만 준다. 로그인 상태면 isBookmarked를 채워준다.
   */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '문항 단건 공개 조회',
    description:
      '암기모드 화면 진입 및 공유 링크(/memorize/{id} 등)의 데이터 소스로 사용합니다. 로그인 없이도 조회 가능하지만 정답·해설(correctAnswers, explanation)은 로그인 시에만 채워지고 비로그인은 null입니다. Authorization 헤더가 있으면 isBookmarked가 채워집니다.',
  })
  @ApiParam({ name: 'id', description: '문항 ID', type: Number })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '문항을 찾을 수 없음' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.questionsService.findOnePublic(id, req.user?.id);
    return { success: true, data };
  }
}
