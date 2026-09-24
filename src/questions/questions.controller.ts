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
   * 로그인 없이도 접근 가능하며, 로그인 상태면 isBookmarked를 채워준다.
   */
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '문항 단건 공개 조회',
    description:
      '암기모드 화면 진입 및 공유 링크(/memorize/{id} 등)의 데이터 소스로 사용합니다. 로그인 없이도 조회 가능하며, Authorization 헤더가 있으면 isBookmarked가 채워집니다.',
  })
  @ApiParam({ name: 'id', description: '문항 ID', type: Number })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '문항을 찾을 수 없음' })
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.questionsService.findOnePublic(id, req.user?.id);
    return { success: true, data };
  }
}
