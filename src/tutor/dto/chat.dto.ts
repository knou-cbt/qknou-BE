import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// LLM 토큰 비용/프롬프트 길이 상한. 프론트는 최근 대화 몇 턴만 보내므로 넉넉한 값.
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_CONTENT_LENGTH = 4000;
const MAX_HISTORY_SIZE = 20;

class ChatMessageDto {
  @ApiProperty({
    description:
      '메시지 역할. user=사용자(학생)가 보낸 메시지, assistant=AI 튜터가 보낸 응답. 대화 이어갈 때 이전 메시지를 순서대로 넣으면 됨.',
    enum: ['user', 'assistant'],
  })
  // IsString만 있으면 'system'도 통과해서 클라이언트가 시스템 프롬프트를 끼워넣을 수 있었음
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  @MaxLength(MAX_HISTORY_CONTENT_LENGTH)
  content: string;
}

export class TutorChatDto {
  @ApiProperty({ description: '현재 문제 ID', example: 101 })
  @IsInt()
  questionId: number;

  @ApiProperty({
    description: `사용자 질문 (최대 ${MAX_MESSAGE_LENGTH}자)`,
    example: 'DI가 뭐야?',
  })
  @IsString()
  @MaxLength(MAX_MESSAGE_LENGTH)
  message: string;

  @ApiPropertyOptional({
    description: `최근 대화 내역 (최대 ${MAX_HISTORY_SIZE}개). 첫 질문 시 생략 가능.`,
    type: [ChatMessageDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_HISTORY_SIZE)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  history?: ChatMessageDto[];
}
