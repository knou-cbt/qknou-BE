import { Controller, Get, Post, Body, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository } from 'typeorm';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TutorChatDto } from './dto/chat.dto';

@ApiTags('tutor')
@Controller('api/tutor')
export class TutorController {
    constructor(
        private readonly tutorService: TutorService,
        @InjectRepository(Questsion)
        private questionRepository: Repository<Questsion>
    ) { }

    @Get('questions/:id/explanation')
    @ApiOperation({
        summary: '특정 문제 해설 조회 및 생성',
        description: 'DB에 해설이 없으면 AI 모델을 통해 실시간으로 생성하여 반환합니다. 생성 시 concept_tags도 함께 추출됩니다.'
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
        description: '기존 해설을 AI 모델을 통해 강제로 다시 생성하여 덮어씁니다. concept_tags도 함께 재생성됩니다.'
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
    @ApiOperation({
        summary: 'AI 튜터 챗봇',
        description: '현재 문제 기반으로 개념 질문, 해설 질문, 비교, 관련 문제 추천 등을 처리합니다.'
    })
    @ApiResponse({ status: 200, description: '챗봇 응답 성공' })
    async chat(@Body() dto: TutorChatDto) {
        const result = await this.tutorService.chat(
            dto.questionId,
            dto.message,
            dto.history || [],
        );

        return {
            success: true,
            data: result,
        };
    }
}
