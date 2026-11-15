import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class BackfillExplanationsDto {
  @ApiPropertyOptional({
    description:
      '이번 실행에서 최대 몇 문제까지 생성할지. 비우면 해설 없는 문제 전부.',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description: '동시에 생성할 개수 (LLM 요청 한도 고려, 1~5)',
    default: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  concurrency?: number;
}
