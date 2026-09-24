import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BookmarksService } from './bookmarks.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('bookmarks')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarksService: BookmarksService) {}

  /**
   * GET /api/bookmarks
   * 북마크한 문항 목록 조회 (최신 등록순)
   */
  @Get()
  @ApiOperation({
    summary: '북마크 목록 조회',
    description:
      '로그인한 사용자가 북마크한 문항 목록을 최신 등록순으로 조회합니다. ' +
      'withDetail=true를 주면 선택지/정답/해설 등 문항 상세를 함께 내려주며, ' +
      '순차 복습(암기모드) 화면에서 문항별로 추가 조회 없이 바로 사용할 수 있습니다.',
  })
  @ApiQuery({
    name: 'withDetail',
    required: false,
    type: Boolean,
    description:
      'true면 문항 상세(선택지/정답/해설/이미지)를 함께 반환합니다. 기본값 false.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  async findAll(@Req() req: any, @Query('withDetail') withDetail?: string) {
    const data = await this.bookmarksService.findAllByUser(
      req.user.id,
      withDetail === 'true',
    );
    return { success: true, data };
  }

  /**
   * POST /api/bookmarks/:questionId
   * 문항 북마크 등록 (이미 등록돼 있으면 그대로 200 반환)
   */
  @Post(':questionId')
  @ApiOperation({
    summary: '북마크 등록',
    description:
      '문항을 북마크합니다. 이미 북마크된 문항이면 에러 없이 기존 상태를 반환합니다.',
  })
  @ApiParam({ name: 'questionId', description: '문항 ID', type: Number })
  @ApiResponse({ status: 201, description: '등록 성공' })
  @ApiResponse({ status: 200, description: '이미 북마크되어 있던 경우' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  @ApiResponse({ status: 404, description: '문항을 찾을 수 없음' })
  async create(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bookmark, created } = await this.bookmarksService.create(
      req.user.id,
      questionId,
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return {
      success: true,
      data: {
        questionId: bookmark.question_id,
        bookmarkedAt: bookmark.created_at,
      },
    };
  }

  /**
   * DELETE /api/bookmarks/:questionId
   * 문항 북마크 해제 (북마크가 없었어도 성공으로 처리)
   */
  @Delete(':questionId')
  @ApiOperation({
    summary: '북마크 해제',
    description: '문항 북마크를 해제합니다.',
  })
  @ApiParam({ name: 'questionId', description: '문항 ID', type: Number })
  @ApiResponse({ status: 200, description: '해제 성공' })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  async remove(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() req: any,
  ) {
    await this.bookmarksService.remove(req.user.id, questionId);
    return { success: true };
  }
}
