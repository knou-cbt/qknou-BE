import { Controller, Get, Post, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository } from 'typeorm';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

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
        description: 'DB에 해설이 없으면 AI 모델을 통해 실시간으로 생성하여 반환합니다.'
    })
    @ApiParam({ name: 'id', description: '문제 ID', type: Number })
    @ApiResponse({ status: 200, description: '해설 조회 성공' })
    async getExplanation(@Param('id', ParseIntPipe) id: number) {
        const question = await this.questionRepository.findOne({ where: { id } });
        if (!question) {
            throw new NotFoundException(`문제 ID ${id}를 찾을 수 없습니다.`);
        }

        // 해설이 DB에 이미 존재하면 바로 반환 (빠른 응답)
        if (question.explanation) {
            return { success: true, explanation: question.explanation, generated: false };
        }

        // 해설이 없으면 AI를 통해 생성 (온디맨드)
        const explanation = await this.tutorService.generateExplanation(question);
        return { success: true, explanation, generated: true };
    }

    @Post('questions/:id/explanation/regenerate')
    @ApiOperation({
        summary: '특정 문제 해설 재생성',
        description: '기존 해설이 마음에 들지 않을 때, AI 모델을 통해 해설을 강제로 다시 생성하여 덮어씁니다.'
    })
    @ApiParam({ name: 'id', description: '문제 ID', type: Number })
    @ApiResponse({ status: 201, description: '해설 재생성 성공' })
    async regenerateExplanation(@Param('id', ParseIntPipe) id: number) {
        const question = await this.questionRepository.findOne({ where: { id } });
        if (!question) {
            throw new NotFoundException(`문제 ID ${id}를 찾을 수 없습니다.`);
        }

        // AI를 통해 무조건 새로 생성하여 덮어쓰기
        const explanation = await this.tutorService.generateExplanation(question);
        return { success: true, explanation, generated: true };
    }
}
