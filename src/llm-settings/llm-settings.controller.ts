import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { LlmSettingsService } from './llm-settings.service';
import {
  CreateLlmSettingDto,
  UpdateLlmSettingDto,
} from './dto/llm-setting.dto';

const SETTING_EXAMPLE = {
  success: true,
  data: {
    provider: 'openai',
    baseUrl: null,
    model: 'gpt-4o-mini',
    apiKeyMasked: '…abcd',
    isEnabled: true,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
  },
};

@ApiTags('llm-settings')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/users/me/llm-setting')
export class LlmSettingsController {
  constructor(private readonly llmSettingsService: LlmSettingsService) {}

  /**
   * GET /api/users/me/llm-setting
   * 내 개인 LLM 설정 조회 (API Key는 끝 4자리만)
   */
  @Get()
  @ApiOperation({
    summary: '내 개인 LLM 설정 조회',
    description: 'API Key 원문은 반환하지 않고 끝 4자리만 표시합니다.',
  })
  @ApiResponse({ status: 200, schema: { example: SETTING_EXAMPLE } })
  @ApiResponse({ status: 404, description: '등록된 설정 없음' })
  async get(@Req() req: any) {
    const data = await this.llmSettingsService.get(this.userId(req));
    return { success: true, data };
  }

  /**
   * POST /api/users/me/llm-setting
   * 개인 LLM 등록. 저장 전에 실제로 한 번 호출해서 연결을 확인함
   */
  @Post()
  // 등록/수정마다 외부 LLM을 테스트 호출하므로 연타 제한
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '개인 LLM 등록',
    description:
      '저장 전에 테스트 호출로 apiKey/model/baseUrl을 검증합니다. 등록된 개인 LLM은 AI 튜터 챗봇에서만 사용되며, 사용하는 동안 일일 횟수 제한에서 차감되지 않습니다.',
  })
  @ApiResponse({ status: 201, schema: { example: SETTING_EXAMPLE } })
  @ApiResponse({
    status: 400,
    description: '입력값 오류, 내부망 주소, 연결 확인 실패',
  })
  @ApiResponse({ status: 409, description: '이미 등록됨 (PATCH 사용)' })
  async create(@Req() req: any, @Body() dto: CreateLlmSettingDto) {
    const data = await this.llmSettingsService.create(this.userId(req), dto);
    return { success: true, data };
  }

  /**
   * PATCH /api/users/me/llm-setting
   * 개인 LLM 수정. isEnabled만 바꾸면 기본 LLM ↔ 개인 LLM 전환
   */
  @Patch()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: '개인 LLM 수정 / 사용 여부 전환',
    description:
      '보낸 필드만 바뀝니다. isEnabled=false면 기본 LLM을 사용합니다. provider나 baseUrl을 바꿀 때는 apiKey를 다시 보내야 합니다.',
  })
  @ApiResponse({ status: 200, schema: { example: SETTING_EXAMPLE } })
  @ApiResponse({ status: 400, description: '입력값 오류, 연결 확인 실패' })
  @ApiResponse({ status: 404, description: '등록된 설정 없음' })
  async update(@Req() req: any, @Body() dto: UpdateLlmSettingDto) {
    const data = await this.llmSettingsService.update(this.userId(req), dto);
    return { success: true, data };
  }

  /**
   * DELETE /api/users/me/llm-setting
   * 개인 LLM 삭제 (저장된 API Key도 함께 삭제)
   */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '개인 LLM 삭제' })
  @ApiResponse({ status: 204, description: '삭제 완료' })
  @ApiResponse({ status: 404, description: '등록된 설정 없음' })
  async remove(@Req() req: any) {
    await this.llmSettingsService.remove(this.userId(req));
  }

  // 관리자 전용 토큰(role=admin)은 users 테이블 사용자가 아니라서 설정을 가질 수 없음
  private userId(req: any): string {
    if (req.user?.role === 'admin') {
      throw new ForbiddenException(
        '관리자 계정은 개인 LLM을 등록할 수 없습니다.',
      );
    }
    return req.user.id;
  }
}
