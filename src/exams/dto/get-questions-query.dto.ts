import { IsEnum, IsOptional, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * 문제 조회 모드
 */
export enum QuestionMode{
  STUDY = 'study',
  TEST = 'test'
}

export class GetQuestionsQueryDto { 
  @ApiPropertyOptional({ 
    enum: QuestionMode, 
    default: QuestionMode.TEST,
    description: '문제 조회 모드 (study: 정답 포함, test: 정답 미포함)',
    example: 'test'
  })
  @IsOptional()
  @IsEnum(QuestionMode)
  mode: QuestionMode = QuestionMode.TEST;

  @ApiPropertyOptional({ 
    type: Number,
    description: '페이지 번호 (미제공 시 전체 조회)',
    example: 1,
    minimum: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ 
    type: Number,
    description: '페이지당 문제 수',
    example: 5,
    minimum: 1,
    maximum: 35
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(35)
  limit?: number;
}