import { Type } from "class-transformer";
import { IsArray, IsNumber, Max, Min, ValidateNested } from "class-validator";

class AnswerDto{
  @IsNumber()
  questionId: number;

  @IsNumber()
  @Min(1)
  @Max(4) //선택지 번호 (1~4)
  selectedAnswer: number;
}

export class SubmitExamDto{
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[]
}