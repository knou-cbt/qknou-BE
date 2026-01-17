import { IsEnum, IsOptional } from "class-validator";

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
}