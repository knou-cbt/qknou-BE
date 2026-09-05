import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Patch,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { ExamSubmissionsService } from './exam-submissions.service';
import { UploadExamSubmissionDto } from './dto/upload-exam-submission.dto';
import { CheckDuplicateQueryDto } from './dto/check-duplicate-query.dto';
import { PatchParsedResultDto } from './dto/patch-parsed-result.dto';
import { RejectSubmissionDto } from './dto/reject-submission.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminGuard } from 'src/auth/guards/admin.guard';

/** 20MB, Multer가 버퍼로 다 받기 전에 컷 */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

@ApiTags('exam-submissions')
@Controller()
export class ExamSubmissionsController {
  constructor(
    private readonly examSubmissionsService: ExamSubmissionsService,
  ) {}

  /**
   * POST /api/exam-submissions
   * 시험지 업로드 (사용자, 로그인 필수)
   */
  @Post('api/exam-submissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: '시험지 등록 - 업로드',
    description:
      '사용자가 시험지 PDF를 업로드합니다. 접수 후 OCR과 관리자 검수는 비동기로 진행됩니다.',
  })
  @ApiResponse({ status: 201, description: '접수 성공 (처리는 비동기)' })
  @ApiResponse({
    status: 400,
    description: '중복 시험지 / PDF 아님 / 유효성 실패',
  })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  @ApiResponse({
    status: 413,
    description: '파일 크기 초과 (20MB, Multer가 자동으로 반환)',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadExamSubmissionDto,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('시험지 파일이 필요합니다.');
    }
    const data = await this.examSubmissionsService.upload(req.user.id, file, {
      subjectId: dto.subjectId,
      year: dto.year,
      examType: dto.examType,
    });
    return { success: true, data };
  }

  /**
   * GET /api/exam-submissions/check
   * 사전 중복 확인 (인증 불필요)
   */
  @Get('api/exam-submissions/check')
  @ApiOperation({
    summary: '시험지 등록 - 사전 중복 확인',
    description:
      '업로드 전에 (subjectId, year, examType) 조합이 이미 등록돼 있는지 확인합니다. UX 보조용이며 최종 방어선은 업로드 API의 DB 제약입니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async check(@Query() query: CheckDuplicateQueryDto) {
    const data = await this.examSubmissionsService.checkDuplicate(
      query.subjectId,
      query.year,
      query.examType,
    );
    return { success: true, data };
  }

  /**
   * GET /api/admin/exam-submissions
   * 검수 대기열 조회 (관리자)
   */
  @Get('api/admin/exam-submissions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    summary: '시험지 등록(관리자) - 검수 대기열 조회',
    description: '관리자가 검수할 시험지 등록 목록을 페이지 단위로 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  async list(
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    const data = await this.examSubmissionsService.listForAdmin(
      status,
      page,
      Math.min(limit, 100),
    );
    return { success: true, data };
  }

  /**
   * GET /api/admin/exam-submissions/:id
   * 상세 조회 (관리자)
   */
  @Get('api/admin/exam-submissions/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({
    summary: '시험지 등록(관리자) - 상세 조회',
    description:
      'OCR 파싱 결과(parsedResult) 전체를 포함한 상세 정보를 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({ status: 404, description: '등록 건을 찾을 수 없음' })
  async getDetail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.examSubmissionsService.getDetailForAdmin(id);
    return { success: true, data };
  }

  /**
   * PATCH /api/admin/exam-submissions/:id
   * 파싱 결과 수정 (관리자)
   */
  @Patch('api/admin/exam-submissions/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({
    summary: '시험지 등록(관리자) - 파싱 결과 수정',
    description:
      '관리자가 OCR 파싱 결과를 검수하며 수정합니다. expectedVersion이 현재 version과 다르면 409 (다른 관리자가 먼저 수정함).',
  })
  @ApiResponse({ status: 200, description: '수정 성공' })
  @ApiResponse({ status: 400, description: 'parsedResult 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({
    status: 409,
    description: 'parsed 상태가 아니거나 version 불일치(동시 수정 충돌)',
  })
  async patch(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchParsedResultDto,
  ) {
    const data = await this.examSubmissionsService.patchParsedResult(
      id,
      dto.parsedResult,
      dto.expectedVersion,
    );
    return { success: true, data };
  }

  /**
   * POST /api/admin/exam-submissions/:id/publish
   * 게시 (관리자)
   */
  @Post('api/admin/exam-submissions/:id/publish')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({
    summary: '시험지 등록(관리자) - 게시',
    description:
      '검수 완료된 parsedResult를 실제 exams/questions에 반영합니다. 이미 게시된 건을 다시 호출하면 기존 examId를 그대로 반환합니다(멱등).',
  })
  @ApiResponse({ status: 200, description: '게시 성공' })
  @ApiResponse({ status: 400, description: 'parsedResult가 비어있음' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({ status: 404, description: '등록 건을 찾을 수 없음' })
  @ApiResponse({
    status: 409,
    description: 'parsed 상태가 아니거나 동일 조합의 시험이 이미 존재함',
  })
  async publish(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    const data = await this.examSubmissionsService.publish(id, req.user.id);
    return { success: true, data };
  }

  /**
   * POST /api/admin/exam-submissions/:id/reject
   * 반려 (관리자)
   */
  @Post('api/admin/exam-submissions/:id/reject')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', type: Number })
  @ApiOperation({
    summary: '시험지 등록(관리자) - 반려',
    description: 'parsed 또는 failed 상태인 등록 건을 반려 처리합니다.',
  })
  @ApiResponse({ status: 200, description: '반려 처리 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  @ApiResponse({ status: 404, description: '등록 건을 찾을 수 없음' })
  @ApiResponse({
    status: 409,
    description: '반려할 수 없는 상태 (이미 게시됨 등)',
  })
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectSubmissionDto,
    @Req() req: any,
  ) {
    const data = await this.examSubmissionsService.reject(
      id,
      dto.reason,
      req.user.id,
    );
    return { success: true, data };
  }
}
