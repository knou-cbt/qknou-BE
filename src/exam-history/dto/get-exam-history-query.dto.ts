import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetExamHistoryQueryDto {
  @ApiProperty({ description: '시험 제목 검색어', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: '페이지 번호 (기본 1)', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: '페이지당 개수 (기본 10, 최대 50)',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
