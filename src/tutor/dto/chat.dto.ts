import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
    @ApiProperty({ description: '메시지 역할', enum: ['user', 'assistant'] })
    @IsString()
    role: 'user' | 'assistant';

    @ApiProperty({ description: '메시지 내용' })
    @IsString()
    content: string;
}

export class TutorChatDto {
    @ApiProperty({ description: '현재 문제 ID', example: 101 })
    @IsInt()
    questionId: number;

    @ApiProperty({ description: '사용자 질문', example: 'DI가 뭐야?' })
    @IsString()
    message: string;

    @ApiPropertyOptional({ description: '최근 대화 내역', type: [ChatMessageDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ChatMessageDto)
    history?: ChatMessageDto[];
}
