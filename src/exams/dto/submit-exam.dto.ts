import { Type } from "class-transformer";
import { IsArray, IsNumber, Max, Min, ValidateNested } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

class AnswerDto{
  @ApiProperty({ 
    description: '문제 ID',
    example: 1,
    type: Number
  })
  @IsNumber()
  questionId: number;

  @ApiProperty({ 
    description: '선택한 답안 번호 (1~4)',
    example: 2,
    minimum: 1,
    maximum: 4,
    type: Number
  })
  @IsNumber()
  @Min(1)
  @Max(4) //선택지 번호 (1~4)
  selectedAnswer: number;
}

export class SubmitExamDto{
  @ApiProperty({ 
    description: '제출할 답안 목록',
    type: [AnswerDto],
    example: [
      { questionId: 1, selectedAnswer: 2 },
      { questionId: 2, selectedAnswer: 1 }
    ]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[]
}