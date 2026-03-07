import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 선택지 한 개
 */
export class ChoiceDto {
  @ApiProperty({ description: '선택지 번호 (1~4)', example: 1 })
  number: number;

  @ApiProperty({
    description: '선택지 텍스트',
    example: '비피압대수층(unconfined aquifer)의 지하수를 천층수라 한다.',
  })
  text: string;

  @ApiPropertyOptional({
    description: '선택지에 첨부된 이미지 URL 배열 (없으면 null)',
    type: [String],
    nullable: true,
    example: null,
  })
  imageUrls: string[] | null;
}

/**
 * 문제 한 개 (공통 필드)
 */
export class QuestionDto {
  @ApiProperty({ description: '문제 ID' })
  id: number;

  @ApiProperty({ description: '문제 번호', example: 36 })
  number: number;

  @ApiProperty({ description: '문제 지문 텍스트' })
  text: string;

  @ApiPropertyOptional({ description: '예시/보기 텍스트', nullable: true })
  example: string | null;

  @ApiPropertyOptional({
    description:
      '문제에 첨부된 이미지 URL 배열 (문장 중간/보기 그림 등, 없으면 null)',
    type: [String],
    nullable: true,
    example: [
      'https://example.com/crawled-images/exam_2019_sub_과목명_q_37_img0_1234567890.png',
    ],
  })
  imageUrls: string[] | null;

  @ApiProperty({ description: '선택지 목록', type: [ChoiceDto] })
  choices: ChoiceDto[];
}

/**
 * study 모드 시 추가되는 필드
 */
export class QuestionStudyDto extends QuestionDto {
  @ApiProperty({ description: '정답 번호 배열 (복수 정답 가능)', example: [3] })
  correctAnswers: number[];

  @ApiPropertyOptional({ description: '해설', nullable: true })
  explanation: string | null;
}

/**
 * 시험 메타 정보
 */
export class ExamInfoDto {
  @ApiProperty()
  id: number;

  @ApiProperty({ description: '시험 제목' })
  title: string;

  @ApiProperty({ description: '과목명' })
  subject: string;

  @ApiProperty({ description: '총 문항 수' })
  totalQuestions: number;

  @ApiProperty({ description: '연도', example: 2019 })
  year: number;
}

/**
 * 페이지네이션 정보 (page, limit 쿼리 사용 시만 포함)
 */
export class PaginationDto {
  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  total: number;

  @ApiProperty()
  totalPages: number;

  @ApiProperty()
  hasNext: boolean;

  @ApiProperty()
  hasPrev: boolean;
}

/**
 * GET /api/exams/:id/questions 응답
 */
export class FindQuestionsResponseDto {
  @ApiProperty({ description: '시험 정보', type: ExamInfoDto })
  exam: ExamInfoDto;

  @ApiProperty({
    description:
      '문제 목록 (test 모드: 기본 필드만, study 모드: correctAnswers, explanation 포함)',
    type: [QuestionDto],
  })
  questions: QuestionDto[] | QuestionStudyDto[];

  @ApiPropertyOptional({
    description: 'page, limit 쿼리 사용 시 페이지네이션 정보',
    type: PaginationDto,
  })
  pagination?: PaginationDto;
}
