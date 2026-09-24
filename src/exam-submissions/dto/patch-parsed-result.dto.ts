import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ChoiceDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  number: number;

  @ApiProperty({ example: '① 선택지 내용' })
  @IsString()
  text: string;

  @ApiProperty({ type: [String], nullable: true })
  @IsOptional()
  @IsArray()
  imageUrls: string[] | null;
}

class ParsedQuestionDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  questionNumber: number;

  @ApiProperty({ example: '다음 중 옳은 것은?' })
  @IsString()
  @IsNotEmpty()
  questionText: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  exampleText?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sharedExample?: string | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  sharedExampleImageUrls?: string[] | null;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  questionImageUrls?: string[] | null;

  @ApiProperty({ type: [Number], example: [3] })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  correctAnswers: number[];

  @ApiProperty({ type: [ChoiceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChoiceDto)
  choices: ChoiceDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  explanation?: string | null;
}

class ParsedResultDto {
  @ApiProperty({ example: '경영학원론 2025 1학기 기말' })
  @IsString()
  @IsNotEmpty()
  examTitle: string;

  @ApiProperty({ type: [ParsedQuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ParsedQuestionDto)
  questions: ParsedQuestionDto[];
}

export class PatchParsedResultDto {
  @ApiProperty({ description: '수정된 문항 배열 (전체 교체)' })
  @ValidateNested()
  @Type(() => ParsedResultDto)
  parsedResult: ParsedResultDto;

  @ApiProperty({
    description:
      '수정 전 조회 시 받은 version 값. 그 사이 다른 관리자가 먼저 수정했으면 409',
    example: 1,
  })
  @IsInt()
  expectedVersion: number;
}
