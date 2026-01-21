/**
 * 시험 타입 ENUM
 * - DB에는 숫자로 저장됨 (1, 2, 3, 4)
 * - 코드에서는 의미 있는 이름으로 사용
 */
export enum ExamType{
  FIRST_SEMESTER_FINAL = 1,   // 1학기 기말
  SECOND_SEMESTER_FINAL = 2,  // 2학기 기말
  SUMMER_SEMESTER = 3,         // 하계 계절학기
  WINTER_SEMESTER = 4,         // 동계 계절학기
}

/**
 * 시험 타입 라벨(화면 표시용)
 */
export const ExamTypeLabel : Record < ExamType, string>= {
  [ExamType.FIRST_SEMESTER_FINAL]: '1학기 기말',
  [ExamType.SECOND_SEMESTER_FINAL]: '2학기 기말',
  [ExamType.SUMMER_SEMESTER]: '하계 계절학기',
  [ExamType.WINTER_SEMESTER]: '동계 계절학기',  
}

/**
 * 문자열에서 ExamType으로 변환하는 헬퍼 함수
 */
export function parseExamType(examTypeText: string): ExamType{
  const text = examTypeText.toLowerCase();

  if (text.includes('계절')) {
    if(text.includes('하계')) return ExamType.SUMMER_SEMESTER;
    if(text.includes('동계')) return ExamType.WINTER_SEMESTER;
    throw new Error(`계절학기 타입을 특정할 수 없습니다: ${examTypeText}`);
  }
  //기말시험 체크
  if(text.includes('기말')){
    if(text.includes('2학기') || text.includes('2 학기')) return ExamType.SECOND_SEMESTER_FINAL;
    if(text.includes('1학기') || text.includes('1 학기')) return ExamType.FIRST_SEMESTER_FINAL;
    throw new Error(`기말시험의 학기 정보를 특정할 수 없습니다: ${examTypeText}`);
  }
  throw new Error(`알 수 없는 시험 타입: ${examTypeText}`);
}