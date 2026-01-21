import { IsEnum, IsOptional, IsInt, Min, Max } from "class-validator";
import { Type } from "class-transformer";

/**
 * 문제 조회 모드
 */
export enum QuestionMode{
  STUDY = 'study',
  TEST = 'test'
}

export class GetQuestionsQueryDto { 
  @IsOptional()
  @IsEnum(QuestionMode)
  mode: QuestionMode = QuestionMode.TEST;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(35)
  limit?: number;
}