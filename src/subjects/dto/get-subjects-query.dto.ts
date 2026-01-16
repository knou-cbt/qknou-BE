import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Min } from "class-validator";

export class GetSubjectsQueryDto{
  //과목명 검색어(선택사항)
  @IsOptional()
  @IsString()
  search?: string;
  
  //페이지 번호(선택사항, 기본값 1)
  @IsOptional()
  @Type(()=> Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  //페이지당 항목 수(선택사항, 기본값 10)
  @IsOptional()
  @Type(()=> Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}