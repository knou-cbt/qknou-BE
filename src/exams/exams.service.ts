import { Injectable } from '@nestjs/common';
import { Exam } from './entities/exam.entity';
import { DataSource } from 'typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { SubjectsService } from 'src/subjects/subjects.service';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * 복수 정답 매핑 테이블
 * 방송대 시험에서 사용하는 복수 정답 표기(A~K)를 실제 선택지 번호 배열로 변환
 * 예: 'A' = [1, 2] (1번과 2번 모두 정답)
 */
const MULTIPLE_ANSWER_MAP: Record<string, number[]> = {
  'A': [1, 2], 'B': [1, 3], 'C': [1, 4], 'D': [2, 3],
  'E': [2, 4], 'F': [3, 4], 'G': [1, 2, 3], 'H': [1, 2, 4],
  'I': [1, 3, 4], 'J': [2, 3, 4], 'K': [1, 2, 3, 4]
};

/**
 * 시험 관리 서비스
 * 외부 사이트에서 시험 데이터를 크롤링하여 DB에 저장
 */
@Injectable()
export class ExamsService {
  constructor(
    private subjectsService: SubjectsService,  // 과목 관리 서비스
    private dataSource: DataSource              // TypeORM DataSource (트랜잭션 처리용)
  ) { }

  /**
   * 정답 문자열을 숫자 배열로 변환
   * @param answerText - 정답 문자열 (예: '1', '2', 'A', 'K')
   * @returns 정답 번호 배열 (예: [1], [1, 2], [1, 2, 3, 4])
   */
  private parseCorrectAnswers(answerText: string): number[] {
    const trimmed = answerText.trim();
    
    // 복수 정답 체크 (A~K)
    if (MULTIPLE_ANSWER_MAP[trimmed]) {
      return MULTIPLE_ANSWER_MAP[trimmed];
    }
    
    // 단일 정답 (1~4)
    const parsed = parseInt(trimmed);
    if (isNaN(parsed)) {
      throw new Error(`잘못된 정답 형식: ${answerText}`);
    }
    return [parsed];
  }

  /**
   * 시험 타입 문자열을 숫자 코드로 변환
   * @param examTypeText - 시험 타입 문자열 (예: '1학기 기말', '2학기 기말')
   * @returns 시험 타입 코드 (1: 1학기 기말, 2: 2학기 기말, 3: 하계, 4: 동계)
   */
  private parseExamType(examTypeText: string): number {
    // 계절학기 체크 (하계/동계 구분)
    if (examTypeText.includes('계절')) {
      if (examTypeText.includes('하계')) return 3;
      if (examTypeText.includes('동계')) return 4;
      return 3; // 하계/동계 구분 안 됨
    }
    
    // 기말시험 체크 (1학기/2학기 구분)
    if (examTypeText.includes('기말')) {
      if (examTypeText.includes('2학기') || examTypeText.includes('2 학기')) return 2;
      return 1; // 1학기 기말 (기본값)
    }
    
    return 1; // 기본값: 1학기 기말
  }

  /**
   * URL에서 시험 데이터를 크롤링하여 DB에 저장
   * @param url - 크롤링할 시험 페이지 URL
   * @param forceRetry - true일 경우 기존 데이터 삭제 후 재저장
   * @returns 저장된 시험 정보 (examId, title, questionCount)
   */
  async saveExamFromUrl(url: string, forceRetry: boolean = false) {
    // ========================================
    // 1단계: HTML 다운로드 및 파싱 준비
    // ========================================
    console.log('HTML 다운로드 중...');
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);  // cheerio로 jQuery 스타일 DOM 조작 가능

    // ========================================
    // 2단계: 시험 메타 정보 추출
    // ========================================
    console.log('시험 정보 파싱 중...');
    
    let year: number | null = null;  // 시험 연도 (추출 실패 시 null)
    let questionCount: number; // 예상 문제 수
    let subjectName: string;   // 과목명
    let examTypeText: string;  // 시험 종류 (예: '1학기 기말')
    let semester: number | null = null; // 학기 정보 (1학기, 2학기)
    
    // HTML 구조가 다른 두 가지 버전 지원
    
    // 버전 1: alla6TitleTbl 클래스를 사용하는 버전
    const alla6InfoTable = $('table.alla6TitleTbl tbody');
    if (alla6InfoTable.length > 0) {
      console.log('alla6TitleTbl 버전 감지');
      const infoText = alla6InfoTable.text();
      
      // 정규식으로 연도, 학기, 문제 수 추출
      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const semesterMatch = infoText.match(/(\d+)\s*학기/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);
      
      year = yearMatch ? parseInt(yearMatch[1]) : null;
      semester = semesterMatch ? parseInt(semesterMatch[1]) : null;
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;
      
      // 테이블 구조: 1행=연도/학기/학년/문항, 2행=과목명, 3행=시험종류
      subjectName = alla6InfoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = alla6InfoTable.find('tr').eq(2).find('td').text().replace('시험종류', '').replace(':', '').trim();
    } else {
      // 버전 2: 기본 table tbody 사용 (allaTitleTbl 등)
      console.log('  📌 기본 tbody 버전 감지');
      
      // allaTitleTbl 클래스가 있으면 직접 사용
      let infoTable = $('table.allaTitleTbl tbody');
      
      // 없거나 비어있으면, tr이 있는 tbody 찾기 (비어있지 않은 tbody)
      if (infoTable.length === 0 || infoTable.find('tr').length === 0) {
        $('table tbody').each((_, elem) => {
          const $elem = $(elem);
          if ($elem.find('tr').length > 0) {
            infoTable = $elem;
            return false; // break
          }
        });
      }
      
      // 첫 번째 행의 첫 번째 td에서 정보 추출 (span.ibold 태그 사용)
      const firstRowTd = infoTable.find('tr').first().find('td').first();
      const infoText = firstRowTd.text();
      console.log("정규식 전 형태  >> ",infoText);
      
      // 정규식으로 연도, 학기, 문제 수 추출
      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const semesterMatch = infoText.match(/(\d+)\s*학기/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);
      console.log("yearMatch >> ",yearMatch);
      console.log("semesterMatch >> ",semesterMatch);
      console.log("questionCountMatch >> ",questionCountMatch);
      
      year = yearMatch ? parseInt(yearMatch[1]) : null;
      semester = semesterMatch ? parseInt(semesterMatch[1]) : null;
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;
      
      // 테이블 구조: 1행=연도/학기/학년/문항, 2행=과목명, 3행=시험종류
      subjectName = infoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = infoTable.find('tr').eq(2).find('td').text().trim();
    }
    
    // 시험 타입 변환 및 제목 생성
    // examTypeText에 학기 정보가 없고, 추출한 학기 정보가 있으면 추가
    if (semester && !examTypeText.includes('학기')) {
      examTypeText = `${semester}학기 ${examTypeText}`;
    }
    
    const examType = this.parseExamType(examTypeText);
    const yearText = year ? `${year}년도` : '연도 미상';
    const title = `${subjectName} ${examTypeText} ${yearText}`;
    
    console.log(`  - 과목: ${subjectName}`);
    console.log(`  - 시험 종류: ${examTypeText} (타입: ${examType})`);
    console.log(`  - 년도: ${year ?? '미상'}`);
    if (semester) {
      console.log(`  - 학기: ${semester}학기`);
    }
    console.log(`  - 예상 문제 수: ${questionCount}`);

    // ========================================
    // 3단계: 문제 및 선택지 크롤링
    // ========================================
    console.log('❓ 문제 크롤링 중...');
    
    // 크롤링한 문제 데이터를 담을 배열
    const questions: Array<{
      questionNumber: number;          // 문제 번호
      questionText: string;            // 문제 텍스트
      exampleText: string | null;      // 보기문 (선택사항)
      questionImageUrl: string | null; // 문제 이미지 URL
      choices: Array<{                 // 선택지 배열 (JSONB로 저장됨)
        choiceNumber: number;          // 선택지 번호 (1~4)
        choiceText: string;            // 선택지 텍스트
        choiceImageUrl: string | null; // 선택지 이미지 URL
      }>;
    }> = [];

    // HTML 구조에 따라 적절한 CSS 클래스 선택
    let questionTables = $('table.allaBasicTbl');  // 기본 버전 시도
    let questionClass = 'allaQuestionNo';          // 문제 번호 클래스
    let questionRowClass = 'allaQuestionTr';       // 문제 행 클래스
    let answerRowClass = 'allaAnswerTr';           // 선택지 행 클래스
    
    // alla6 버전으로 전환 (allaBasicTbl이 없을 경우)
    if (questionTables.length === 0) {
      console.log('  📌 alla6BasicTbl 사용');
      questionTables = $('table.alla6BasicTbl');
      questionClass = 'alla6QuestionNo';
      questionRowClass = 'alla6QuestionTr';
      answerRowClass = 'alla6AnswerTr';
    } else {
      console.log('  📌 allaBasicTbl 사용');
    }

    // 각 문제 테이블을 순회하며 데이터 추출
    questionTables.each((_, element) => {
      const table = $(element);
      
      // 문제 번호 추출
      const questionNoText = table.find(`span.${questionClass}`).text().trim();
      const questionNumber = parseInt(questionNoText);
      
      if (isNaN(questionNumber)) return;  // 유효하지 않은 문제 번호는 건너뜀

      // 보기문 추출 (선택사항 - 없을 수도 있음)
      let exampleText: string | null = null;
      const exampleRow = table.find('tr.alla6ExampleTr_Txt .allaExampleList_p, tr.allaExampleTr_Txt .allaExampleList_p');
      if (exampleRow.length > 0) {
        exampleText = exampleRow.text().trim();
      }

      // 문제 텍스트 추출 (문제 번호를 제외한 순수 텍스트)
      const questionRow = table.find(`tr.${questionRowClass} td`);
      const fullText = questionRow.text().trim();
      const questionText = fullText.replace(questionNoText, '').trim();

      // 문제에 포함된 이미지 URL 추출
      const questionImageUrl = questionRow.find('img').first().attr('src') || null;

      // 선택지 배열 초기화
      const choices: Array<{
        choiceNumber: number;
        choiceText: string;
        choiceImageUrl: string | null;
      }> = [];

      // 각 선택지 행을 순회하며 데이터 추출
      table.find(`tr.${answerRowClass}`).each((_, choiceElement) => {
        const choiceRow = $(choiceElement);
        const input = choiceRow.find('input[type=radio]');
        const choiceNumber = parseInt(input.attr('value') || '0');
        
        // value=5는 "모름", value=0은 잘못된 값 → 제외
        if (choiceNumber === 5 || choiceNumber === 0) return;

        // 선택지 텍스트 추출 (label 태그 전체 텍스트)
        const label = choiceRow.find('label');
        const choiceText = label.text().trim();

        // 선택지에 포함된 이미지 URL 추출
        const choiceImageUrl = label.find('img').first().attr('src') || null;

        choices.push({
          choiceNumber,
          choiceText,
          choiceImageUrl
        });
      });

      // 크롤링한 문제 데이터를 배열에 추가
      questions.push({
        questionNumber,
        questionText,
        exampleText,
        questionImageUrl,
        choices
      });
    });

    console.log(`  ✅ ${questions.length}개 문제 크롤링 완료`);

    // ========================================
    // 4단계: 정답표 크롤링
    // ========================================
    console.log('✔️  정답표 파싱 중...');
    
    // 문제 번호 → 정답 배열 매핑 (예: 1 → [2], 10 → [1, 2])
    const answerMap = new Map<number, number[]>();
    
    // 방법 1: 테이블 형식 정답표 (allaAnswerTableDiv)
    const answerTableDiv = $('.allaAnswerTableDiv table tr');
    if (answerTableDiv.length > 1) {  // 헤더 포함 최소 2행 이상
      console.log('  📌 테이블 형식 정답표');
      
      answerTableDiv.each((index, row) => {
        if (index === 0) return;  // 헤더 행 건너뛰기
        
        const cells = $(row).find('td');
        if (cells.length < 2) return;  // 최소 2개 컬럼 필요
        
        // 1열: 문제 번호, 2열: 정답
        const questionNo = parseInt(cells.eq(0).text().trim());
        const answerText = cells.eq(1).text().trim();
        
        if (!isNaN(questionNo) && answerText) {
          try {
            answerMap.set(questionNo, this.parseCorrectAnswers(answerText));
          } catch (error) {
            console.warn(`  ⚠️  문제 ${questionNo} 정답 파싱 실패: ${answerText}`);
          }
        }
      });
    } else {
      // 방법 2: 문자열 형식 정답표 (예: "K2343433211...")
      console.log('  📌 문자열 형식 정답표');
      
      const answerStringRow = $('table tbody tr:contains("문제답안")');
      if (answerStringRow.length > 0) {
        // "문제답안" 행의 다음 행에서 정답 문자열 추출
        const answerString = answerStringRow.next().find('td').text().trim();
        console.log(`  📝 정답 문자열: ${answerString}`);
        
        // 각 문자가 순서대로 문제 1, 2, 3...의 정답
        for (let i = 0; i < answerString.length; i++) {
          const char = answerString[i];
          const questionNo = i + 1;
          
          try {
            const answers = this.parseCorrectAnswers(char);
            answerMap.set(questionNo, answers);
          } catch (error) {
            console.warn(`  ⚠️  문제 ${questionNo} 정답 파싱 실패: ${char}`);
          }
        }
      }
    }

    console.log(`  ✅ ${answerMap.size}개 정답 파싱 완료`);

    // 정답표가 없으면 에러 발생
    if (questions.length > 0 && answerMap.size === 0) {
      throw new Error('정답표를 찾을 수 없습니다. HTML 구조를 확인하세요.');
    }

    // 필수 정보 검증
    if (!year) {
      throw new Error('시험 연도를 추출할 수 없습니다. HTML 구조를 확인하세요.');
    }
    if (!subjectName || subjectName.trim() === '') {
      throw new Error('과목명을 추출할 수 없습니다. HTML 구조를 확인하세요.');
    }

    // ========================================
    // 5단계: 트랜잭션으로 DB 저장
    // ========================================
    console.log('💾 데이터베이스 저장 중...');
    
    return await this.dataSource.transaction(async (manager) => {
      // 5-1. 중복 체크 및 재시도 처리
      if (forceRetry) {
        // --retry 옵션: 기존 데이터 삭제 후 재저장
        const existingExam = await manager.findOne(Exam, { where: { title } });
        if (existingExam) {
          console.log('  ⚠️  기존 시험 삭제 중...');
          await manager.delete(Exam, existingExam.id);  // CASCADE로 문제도 함께 삭제됨
          console.log('  ✅ 삭제 완료');
        }
      } else {
        // 일반 모드: 중복 시 에러 발생
        const existingExam = await manager.findOne(Exam, { where: { title } });
        if (existingExam) {
          throw new Error(
            `부분적으로 저장된 데이터가 있습니다. --retry 옵션을 사용하세요.\n` +
            `기존 시험 ID: ${existingExam.id}, 제목: ${existingExam.title}`
          );
        }
      }

      // 5-2. 과목 찾기 또는 생성
      const subject = await this.subjectsService.findOrCreateByName(subjectName);

      // 5-3. 시험 엔티티 생성 및 저장
      const exam = manager.create(Exam, {
        subject_id: subject.id,
        year,
        exam_type: examType,
        title,
        total_questions: questions.length
      });
      const savedExam = await manager.save(exam);
      console.log(`  ✅ 시험 저장 완료 (ID: ${savedExam.id})`);

      // 5-4. 문제 및 선택지 저장
      // 선택지는 JSONB 형식으로 questions 테이블에 함께 저장됨
      for (const questionData of questions) {
        // 해당 문제의 정답 가져오기
        const correctAnswers = answerMap.get(questionData.questionNumber);
        
        // 정답이 없는 문제는 건너뛰기
        if (!correctAnswers || correctAnswers.length === 0) {
          console.warn(`  ⚠️  문제 ${questionData.questionNumber} 정답 없음, 건너뜀`);
          continue;
        }

        // 문제 엔티티 생성
        const question = manager.create(Questsion, {
          exam_id: savedExam.id,
          question_number: questionData.questionNumber,
          question_text: questionData.questionText,
          example_text: questionData.exampleText,
          question_image_url: questionData.questionImageUrl,
          correct_answers: correctAnswers,
          choices: questionData.choices  // JSONB 컬럼에 배열 그대로 저장
        });
        await manager.save(question);
      }

      console.log(`  ✅ ${questions.length}개 문제 및 선택지 저장 완료`);

      // 저장 결과 반환
      return {
        examId: savedExam.id,
        title: savedExam.title,
        questionCount: questions.length
      };
    });
  }
}
