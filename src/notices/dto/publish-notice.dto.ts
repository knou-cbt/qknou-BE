import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class PublishNoticeDto {
  @ApiProperty({
    description: '공지 제목',
    example: '9월 업데이트 소식',
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: '공지 내용 (여러 내역을 조합해 관리자가 직접 작성)',
    example: '- 문항 오류 3건 수정\n- 신규 시험 5개 추가',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    description: '이 공지에 묶을 update_entries ID 목록',
    type: [Number],
    example: [12, 13, 14],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  entryIds: number[];
}
