import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class CheckDuplicateQueryDto {
  @ApiProperty({ description: '과목 ID', example: 3 })
  @Type(() => Number)
  @IsInt()
  subjectId: number;

  @ApiProperty({ description: '연도', example: 2025 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ description: '시험 종류 (1~4)', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  examType: number;
}
