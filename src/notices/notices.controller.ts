import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NoticesService } from './notices.service';
import { CreateUpdateEntryDto } from './dto/create-update-entry.dto';
import { PublishNoticeDto } from './dto/publish-notice.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminGuard } from 'src/auth/guards/admin.guard';

@ApiTags('notices')
@Controller()
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  /**
   * GET /api/notices/active
   * 현재 노출 기간 내의 활성 업데이트 공지 조회 (접속 시 모달, 인증 불필요)
   */
  @Get('api/notices/active')
  @ApiOperation({
    summary: '활성 업데이트 공지 조회',
    description:
      '발행일로부터 7일 이내이고 활성화된 업데이트 공지를 조회합니다. 로그인 여부와 무관하게 조회 가능합니다.',
  })
  @ApiResponse({ status: 200, description: '조회 성공 (없으면 data: [])' })
  async getActive() {
    const data = await this.noticesService.getActive();
    return { success: true, data };
  }

  /**
   * POST /api/admin/update-entries
   * 업데이트 내역 적재 (관리자, 내부용)
   */
  @Post('api/admin/update-entries')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '업데이트 내역 적재 (관리자)',
    description:
      '문제 수정/시험 추가 등 개별 업데이트 내역을 누적 저장합니다. 저장 시점에는 사용자에게 노출되지 않습니다.',
  })
  @ApiResponse({ status: 201, description: '저장 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  async createEntry(@Body() dto: CreateUpdateEntryDto) {
    const data = await this.noticesService.createEntry(dto.type, dto.content);
    return { success: true, data };
  }

  /**
   * POST /api/admin/notices/publish
   * 누적된 업데이트 내역을 묶어 사용자 노출용 공지로 발행 (관리자)
   */
  @Post('api/admin/notices/publish')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '업데이트 알림 발행 (관리자)',
    description:
      '누적된 업데이트 내역 중 선택한 것들을 묶어 하나의 사용자 노출용 공지로 발행합니다. 노출 기간은 발행일로부터 7일 고정입니다.',
  })
  @ApiResponse({ status: 201, description: '발행 성공' })
  @ApiResponse({
    status: 400,
    description: 'entryIds가 존재하지 않거나 이미 다른 공지에 묶인 내역 포함',
  })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 403, description: '관리자 권한 없음' })
  async publish(@Body() dto: PublishNoticeDto) {
    const data = await this.noticesService.publish(
      dto.title,
      dto.content,
      dto.entryIds,
    );
    return { success: true, data };
  }
}
