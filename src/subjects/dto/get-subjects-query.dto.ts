import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class GetSubjectsQueryDto{
  //과목명 검색어(선택사항)
  @ApiPropertyOptional({ 
    description: '과목명 검색어',
    example: '컴퓨터',
    type: String
  })
  @IsOptional()
  @IsString()
  search?: string;
  
  //페이지 번호(선택사항, 기본값 1)
  @ApiPropertyOptional({ 
    description: '페이지 번호',
    example: 1,
    default: 1,
    minimum: 1,
    type: Number
  })
  @IsOptional()
  @Type(()=> Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  //페이지당 항목 수(선택사항, 기본값 10)
  @ApiPropertyOptional({ 
    description: '페이지당 항목 수',
    example: 10,
    default: 10,
    minimum: 1,
    type: Number
  })
  @IsOptional()
  @Type(()=> Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}