import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  NotFoundException,
  UseGuards,
  Req,
  Query,
  Delete,
} from '@nestjs/common';
import { TutorService } from './tutor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository } from 'typeorm';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TutorChatDto } from './dto/chat.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ChatLimitGuard } from './guards/chat-limit.guard';

@ApiTags('tutor')
@Controller('api/tutor')
export class TutorController {
  constructor(
    private readonly tutorService: TutorService,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
  ) {}

  @Get('questions/:id/explanation')
  @ApiOperation({
    summary: '특정 문제 해설 조회 및 생성',
    description:
      'DB에 해설이 없으면 AI 모델을 통해 실시간으로 생성하여 반환합니다. 생성 시 concept_tags도 함께 추출됩니다.',
  })
  @ApiParam({ name: 'id', description: '문제 ID', type: Number })
  @ApiResponse({ status: 200, description: '해설 조회 성공' })
  async getExplanation(@Param('id', ParseIntPipe) id: number) {
    const question = await this.questionRepository.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException(`문제 ID ${id}를 찾을 수 없습니다.`);
    }

    if (question.explanation) {
      return {
        success: true,
        explanation: question.explanation,
        conceptTags: question.concept_tags,
        generated: false,
      };
    }

    const result = await this.tutorService.generateExplanation(question);
    return {
      success: true,
      explanation: result.explanation,
      conceptTags: result.conceptTags,
      generated: true,
    };
  }

  @Post('questions/:id/explanation/regenerate')
  @ApiOperation({
    summary: '특정 문제 해설 재생성',
    description:
      '기존 해설을 AI 모델을 통해 강제로 다시 생성하여 덮어씁니다. concept_tags도 함께 재생성됩니다.',
  })
  @ApiParam({ name: 'id', description: '문제 ID', type: Number })
  @ApiResponse({ status: 201, description: '해설 재생성 성공' })
  async regenerateExplanation(@Param('id', ParseIntPipe) id: number) {
    const question = await this.questionRepository.findOne({ where: { id } });
    if (!question) {
      throw new NotFoundException(`문제 ID ${id}를 찾을 수 없습니다.`);
    }

    const result = await this.tutorService.generateExplanation(question);
    return {
      success: true,
      explanation: result.explanation,
      conceptTags: result.conceptTags,
      generated: true,
    };
  }

  @Post('chat')
  @UseGuards(JwtAuthGuard, ChatLimitGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'AI 튜터 챗봇 (로그인 필수, 일 5회 제한)',
    description:
      '현재 문제 기반으로 개념 질문, 해설 질문, 비교, 관련 문제 추천 등을 처리합니다. 로그인한 사용자만 사용 가능하며 하루 5회로 제한됩니다.',
  })
  @ApiResponse({
    status: 200,
    description: '챗봇 응답 성공',
    schema: {
      example: {
        success: true,
        data: {
          answer: 'DI(Dependency Injection)는...',
          intent: 'define',
        },
        remainingCount: 4,
      },
    },
  })
  @ApiResponse({ status: 401, description: '인증 실패 (로그인 필요)' })
  @ApiResponse({
    status: 403,
    description: '일일 사용 횟수 초과 (5회 제한)',
  })
  async chat(@Body() dto: TutorChatDto, @Req() req: any) {
    const result = await this.tutorService.chat(
      dto.questionId,
      dto.message,
      dto.history || [],
    );

    return {
      success: true,
      data: result,
      remainingCount: req.remainingCount,
    };
  }

  @Get('remaining-count')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '남은 챗봇 사용 횟수 조회',
    description: '오늘 남은 AI 튜터 챗봇 사용 횟수를 반환합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '조회 성공',
    schema: {
      example: {
        success: true,
        remainingCount: 3,
        totalLimit: 5,
      },
    },
  })
  async getRemainingCount(@Req() req: any) {
    const userId = req.user.id;
    const remaining = await this.tutorService.getRemainingCount(userId);

    return {
      success: true,
      remainingCount: remaining,
      totalLimit: 5,
    };
  }

  @Delete('cleanup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '오래된 챗봇 사용 데이터 삭제 (관리자용)',
    description:
      '지정된 일수 이전의 챗봇 사용 데이터를 삭제합니다. 기본값: 90일',
  })
  @ApiResponse({
    status: 200,
    description: '삭제 완료',
    schema: {
      example: {
        success: true,
        deleted: 1523,
        cutoffDate: '2025-12-08',
        message: '1523개의 오래된 데이터가 삭제되었습니다.',
      },
    },
  })
  async cleanupOldData(@Query('days') days?: number) {
    const daysToDelete = days ? parseInt(days.toString()) : 90;

    const result =
      await this.tutorService.manualCleanupOldChatLimits(daysToDelete);

    return {
      success: true,
      deleted: result.deleted,
      cutoffDate: result.cutoffDate,
      message: `${result.deleted}개의 오래된 데이터가 삭제되었습니다.`,
    };
  }
}
