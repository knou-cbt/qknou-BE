import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { FeedbackType } from '../entities/feedback.entity';

const FEEDBACK_TYPES: FeedbackType[] = [
  'question_bug',
  'site_bug',
  'suggestion',
  'other',
];

export class CreateFeedbackDto {
  @ApiProperty({
    description: '피드백 유형',
    enum: FEEDBACK_TYPES,
    example: 'question_bug',
  })
  @IsIn(FEEDBACK_TYPES)
  type: FeedbackType;

  @ApiProperty({
    description: '피드백 내용 (최대 5000자)',
    example: '3번 선택지 정답 표기가 이상해요',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiProperty({
    description: '문항 ID (문항 관련 제보일 때)',
    required: false,
    example: 101,
  })
  @IsOptional()
  @IsInt()
  questionId?: number;

  @ApiProperty({
    description: '제보 시점 페이지 URL (최대 2000자)',
    required: false,
    example: 'https://qknou.kr/exams/1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  pageUrl?: string;
}
