import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ChatMessageDto {
  @ApiProperty({
    description:
      '메시지 역할. user=사용자(학생)가 보낸 메시지, assistant=AI 튜터가 보낸 응답. 대화 이어갈 때 이전 메시지를 순서대로 넣으면 됨.',
    enum: ['user', 'assistant'],
  })
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

  @ApiPropertyOptional({
    description: '최근 대화 내역. 첫 질문 시 생략 가능.',
    type: [ChatMessageDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
