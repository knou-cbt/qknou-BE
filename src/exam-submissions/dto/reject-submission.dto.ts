import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectSubmissionDto {
  @ApiProperty({ description: '반려 사유', example: '스캔 품질이 너무 낮음' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
