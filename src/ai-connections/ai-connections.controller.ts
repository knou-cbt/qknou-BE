import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserThrottlerGuard } from 'src/common/guards/user-throttler.guard';
import { AiConnectionsService } from './ai-connections.service';
import {
  PatchActiveProviderDto,
  PutAiConnectionDto,
} from './dto/ai-connection.dto';
import { AI_PROVIDERS, parseProvider } from './ai-providers';

const CONNECTION_EXAMPLE = {
  provider: 'gemini',
  maskedKey: 'AIza...x9Qk',
  connectedAt: '2026-10-30T09:00:00.000Z',
};
const LIST_EXAMPLE = {
  success: true,
  data: { activeProvider: 'gemini', connections: [CONNECTION_EXAMPLE] },
};
const PROVIDER_PARAM = {
  name: 'provider',
  enum: AI_PROVIDERS,
  description: '지원하지 않는 값이면 400',
};

@ApiTags('ai-connections')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('api/users/me/ai-connections')
export class AiConnectionsController {
  constructor(private readonly aiConnectionsService: AiConnectionsService) {}

  /**
   * GET /api/users/me/ai-connections
   * 연결한 AI 목록과 튜터가 쓸 AI. 키는 마스킹된 값만
   */
  @Get()
  @ApiOperation({
    summary: '내 AI 연결 목록 조회',
    description:
      'activeProvider가 null이면 큐노 기본 AI. API Key 원문은 반환하지 않습니다.',
  })
  @ApiResponse({ status: 200, schema: { example: LIST_EXAMPLE } })
  async list(@Req() req: any) {
    const data = await this.aiConnectionsService.list(this.userId(req));
    return { success: true, data };
  }

  /**
   * PATCH /api/users/me/ai-connections
   * 튜터가 쓸 AI 선택. null이면 큐노 기본 AI
   */
  @Patch()
  @ApiOperation({ summary: '사용할 AI 선택' })
  @ApiResponse({ status: 200, schema: { example: LIST_EXAMPLE } })
  @ApiResponse({ status: 400, description: '연결하지 않은 제공사' })
  async setActive(@Req() req: any, @Body() dto: PatchActiveProviderDto) {
    const data = await this.aiConnectionsService.setActive(
      this.userId(req),
      dto.activeProvider,
    );
    return { success: true, data };
  }

  /**
   * PUT /api/users/me/ai-connections/:provider
   * 키 저장(연결). 저장 전에 제공사에 키를 확인함
   */
  @Put(':provider')
  // 호출마다 외부 제공사로 요청이 나가므로 사용자당 분당 5회
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'AI 키 저장(연결)',
    description:
      '제공사의 목록 조회 API로 키를 확인한 뒤(요금 없음) 암호화해 저장합니다. 같은 제공사를 다시 저장하면 키를 교체합니다. 처음 연결한 키면 사용할 AI로 자동 선택됩니다.',
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiResponse({
    status: 200,
    schema: { example: { success: true, data: CONNECTION_EXAMPLE } },
  })
  @ApiResponse({
    status: 400,
    description: '키 형식 오류, 제공사가 무효 키로 응답',
  })
  @ApiResponse({ status: 429, description: '요청 제한 초과' })
  @ApiResponse({ status: 502, description: '제공사 장애·타임아웃' })
  @ApiResponse({
    status: 503,
    description: '서버 암호화 키 미설정으로 기능 비활성화',
  })
  async connect(
    @Req() req: any,
    @Param('provider') provider: string,
    @Body() dto: PutAiConnectionDto,
  ) {
    const data = await this.aiConnectionsService.connect(
      this.userId(req),
      parseProvider(provider),
      dto.apiKey,
    );
    return { success: true, data };
  }

  /**
   * DELETE /api/users/me/ai-connections/:provider
   * 연결 해제 (키 물리 삭제). 없는 연결이어도 200
   */
  @Delete(':provider')
  @ApiOperation({
    summary: 'AI 연결 해제',
    description:
      '저장된 키를 삭제합니다. 사용 중이던 AI였다면 큐노 기본 AI로 돌아갑니다.',
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiResponse({ status: 200, schema: { example: { success: true } } })
  async disconnect(@Req() req: any, @Param('provider') provider: string) {
    await this.aiConnectionsService.disconnect(
      this.userId(req),
      parseProvider(provider),
    );
    return { success: true };
  }

  // 관리자 전용 토큰(role=admin)은 users 테이블 사용자가 아니라서 연결을 가질 수 없음
  private userId(req: any): string {
    if (req.user?.role === 'admin') {
      throw new ForbiddenException('관리자 계정은 AI를 연결할 수 없습니다.');
    }
    return req.user.id;
  }
}
