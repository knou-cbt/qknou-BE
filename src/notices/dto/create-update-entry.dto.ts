import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateUpdateEntryDto {
  @ApiProperty({
    description: '업데이트 유형',
    example: '문제수정',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  type: string;

  @ApiProperty({
    description: '업데이트 내용',
    example: '경영학원론 2019 기말 3번 문항 정답 수정',
  })
  @IsString()
  @IsNotEmpty()
  content: string;
}
