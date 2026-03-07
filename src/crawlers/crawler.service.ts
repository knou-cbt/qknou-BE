import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Exam } from 'src/exams/entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository, DataSource } from 'typeorm';
import { SubjectsService } from 'src/subjects/subjects.service';
import { parseExamType } from 'src/exams/enums/exam-type.enum';
import { StorageService } from 'src/storage/storage.service';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 복수 정답 매핑 테이블
 * 방송대 시험에서 사용하는 복수 정답 표기(A~K)를 실제 선택지 번호 배열로 변환
 * 예: 'A' = [1, 2] (1번과 2번 모두 정답)
 */
const MULTIPLE_ANSWER_MAP: Record<string, number[]> = {
  A: [1, 2],
  B: [1, 3],
  C: [1, 4],
  D: [2, 3],
  E: [2, 4],
  F: [3, 4],
  G: [1, 2, 3],
  H: [1, 2, 4],
  I: [1, 3, 4],
  J: [2, 3, 4],
  K: [1, 2, 3, 4],
};

/**
 * 크롤링 실패 로그 인터페이스
 */
interface CrawlErrorLog {
  timestamp: string;
  url: string;
  subjectName?: string;
  errorType: 'subject' | 'exam' | 'parsing' | 'missing_answer';
  errorMessage: string;
  stackTrace?: string;
  skippedQuestions?: number[]; // 건너뛴 문제 번호들
}

/**
 * 방송대 기출문제를 크롤링하여 DB에 저장
 */
@Injectable()
export class CrawlerService {
  private readonly LOG_DIR = path.join(process.cwd(), 'logs', 'crawl');

  constructor(
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    private subjectsService: SubjectsService,
    private dataSource: DataSource,
    private storageService: StorageService,
  ) {
    // 로그 디렉토리 생성 (없으면)
    this.ensureLogDirectory();
  }

  //TODO 메서드들 추가

  /**
   * 유틸리티: 대기 함수(서버 부담 감소)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 로그 디렉토리 생성 (없으면)
   */
  private ensureLogDirectory(): void {
    if (!fs.existsSync(this.LOG_DIR)) {
      fs.mkdirSync(this.LOG_DIR, { recursive: true });
      console.log(`📁 로그 디렉토리 생성: ${this.LOG_DIR}`);
    }
  }

  /**
   * 실패한 크롤링 로그를 JSON 파일에 저장
   */
  private async saveErrorLogs(errors: CrawlErrorLog[]): Promise<string> {
    if (errors.length === 0) return '';

    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(this.LOG_DIR, `crawl-errors-${dateStr}.json`);

    // 기존 로그 읽기 (같은 날짜에 이미 로그가 있으면 추가)
    let logs: CrawlErrorLog[] = [];
    if (fs.existsSync(logFile)) {
      try {
        const content = fs.readFileSync(logFile, 'utf-8');
        logs = JSON.parse(content);
      } catch {
        console.warn('⚠️  기존 로그 파일 읽기 실패, 새로 생성합니다.');
      }
    }

    // 새 로그 추가
    logs.push(...errors);

    // 파일에 저장 (보기 좋게 포맷팅)
    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2), 'utf-8');

    return logFile;
  }

  /**
   * 실패한 URL 목록을 텍스트 파일로 저장 (재시도용)
   */
  private async saveFailedUrls(urls: string[]): Promise<string> {
    if (urls.length === 0) return '';

    const dateStr = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const urlFile = path.join(
      this.LOG_DIR,
      `failed-urls-${dateStr}-${timestamp}.txt`,
    );

    // URL 목록을 한 줄씩 저장
    fs.writeFileSync(urlFile, urls.join('\n'), 'utf-8');

    return urlFile;
  }

  /**
   * 정답 문자열을 숫자 배열로 변환
   * @param answerText - 정답 문자열 (예: '1', '2', 'A', 'K')
   * @returns 정답 번호 배열 (예: [1], [1, 2], [1, 2, 3, 4])
   */
  private parseCorrectAnswers(answerText: string): number[] {
    const trimmed = answerText.trim();
    //복수 정답 체크(A~K)
    if (MULTIPLE_ANSWER_MAP[trimmed]) {
      return MULTIPLE_ANSWER_MAP[trimmed];
    }
    //단일 정답(1~4)
    const parsed = parseInt(trimmed);
    if (isNaN(parsed)) {
      throw new Error(`잘못된 정답 형식: ${answerText}`);
    }
    return [parsed];
  }

  /**
   * 1단계: 메인 페이지에서 과목 링크 목록 추출
   */
  async getSubjectLinks(
    mainUrl: string,
  ): Promise<Array<{ name: string; url: string }>> {
    console.log('📚 과목 목록 수집 중...');

    // HTML 다운로드
    const { data: html } = await axios.get(mainUrl);
    const $ = cheerio.load(html);

    const subjects: Array<{ name: string; url: string }> = [];

    // 제외할 구분 문자들 (가, 나, 다, ...)
    const excludeTexts = [
      '가',
      '나',
      '다',
      '라',
      '마',
      '바',
      '사',
      '아',
      '자',
      '차',
      '카',
      '타',
      '파',
      '하',
      '기타',
    ];

    // ul#allaGmObjectList 안의 모든 li > a 태그 순회
    $('#allaGmObjectList li a').each((_, element) => {
      const $a = $(element);
      const href = $a.attr('href');
      const name = $a.text().trim();

      // href가 있고, 구분 문자가 아닌 경우만 추가
      if (href && !excludeTexts.includes(name)) {
        subjects.push({ name, url: href });
      }
    });

    console.log(`  ✅ ${subjects.length}개 과목 발견`);
    return subjects;
  }
  /**
   * 2단계: 과목 페이지에서 시험지 링크들 추출
   */
  async getExamLinks(subjectUrl: string): Promise<string[]> {
    const { data: html } = await axios.get(subjectUrl);
    const $ = cheerio.load(html);

    const examLinks: string[] = [];

    // Base URL 추출 (예: https://allaclass.tistory.com)
    const urlObj = new URL(subjectUrl);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    // article#content > div.inner > div.post-item > a 순회
    $('article#content div.inner div.post-item a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        // 상대 경로면 절대 경로로 변환
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
        examLinks.push(fullUrl);
      }
    });

    return examLinks;
  }
  /**
   * 3단계: 개별 시험지 크롤링 및 DB 저장
   */
  async crawlExam(url: string, forceRetry: boolean = false) {
    // ========================================
    // 1단계: HTML 다운로드 및 파싱
    // ========================================
    console.log('HTML 다운로드 중...');
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    // ========================================
    // 2단계: 시험 메타 정보 추출
    // ========================================
    console.log('시험 정보 파싱 중...');

    let year: number | null = null;
    let questionCount: number;
    let subjectName: string;
    let examTypeText: string;
    let semester: number | null = null;

    // HTML 구조가 다른 두 가지 버전 지원
    const alla6InfoTable = $('table.alla6TitleTbl tbody');
    if (alla6InfoTable.length > 0) {
      console.log('  📌 alla6TitleTbl 버전 감지');
      const infoText = alla6InfoTable.text();

      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const semesterMatch = infoText.match(/(\d+)\s*학기/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);

      year = yearMatch ? parseInt(yearMatch[1]) : null;
      semester = semesterMatch ? parseInt(semesterMatch[1]) : null;
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;

      subjectName = alla6InfoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = alla6InfoTable
        .find('tr')
        .eq(2)
        .find('td')
        .text()
        .replace('시험종류', '')
        .replace(':', '')
        .trim();
    } else {
      console.log('  📌 기본 tbody 버전 감지');

      let infoTable = $('table.allaTitleTbl tbody');
      if (infoTable.length === 0 || infoTable.find('tr').length === 0) {
        $('table tbody').each((_, elem) => {
          const $elem = $(elem);
          if ($elem.find('tr').length > 0) {
            infoTable = $elem;
            return false;
          }
        });
      }

      const firstRowTd = infoTable.find('tr').first().find('td').first();
      const infoText = firstRowTd.text();

      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const semesterMatch = infoText.match(/(\d+)\s*학기/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);

      year = yearMatch ? parseInt(yearMatch[1]) : null;
      semester = semesterMatch ? parseInt(semesterMatch[1]) : null;
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;

      subjectName = infoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = infoTable.find('tr').eq(2).find('td').text().trim();
    }

    // 시험 타입 변환
    if (semester && !examTypeText.includes('학기')) {
      examTypeText = `${semester}학기 ${examTypeText}`;
    }

    const examType = parseExamType(examTypeText); // enum 함수 사용
    const title = subjectName;

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

    const questions: Array<{
      questionNumber: number;
      questionText: string;
      exampleText: string | null;
      sharedExample: string | null;
      questionImageUrls: string[] | null;
      choices: Array<{
        number: number;
        text: string;
        imageUrls: string[] | null;
      }>;
    }> = [];

    let questionTables = $('table.allaBasicTbl');
    let questionClass = 'allaQuestionNo';
    let questionRowClass = 'allaQuestionTr';
    let answerRowClass = 'allaAnswerTr';

    if (questionTables.length === 0) {
      console.log('  📌 alla6BasicTbl 사용');
      questionTables = $('table.alla6BasicTbl');
      questionClass = 'alla6QuestionNo';
      questionRowClass = 'alla6QuestionTr';
      answerRowClass = 'alla6AnswerTr';
    } else {
      console.log('  📌 allaBasicTbl 사용');
    }

    // 공통 보기 저장용 Map: 문제 번호 → 공통 보기 텍스트
    const sharedExampleMap = new Map<number, string>();

    // 1차: 공통 보기(※) 블록 파싱
    $(`span.alla6QuestionNo, span.allaQuestionNo`).each((_, element) => {
      const $span = $(element);
      const questionNoText = $span.text().trim();

      if (questionNoText === '※') {
        const $parentTbody = $span.closest('tbody');
        const $parentTd = $span.closest('td');
        const fullText = $parentTd.text().trim();

        console.log(
          `  🔍 공통 보기 후보 발견: "${fullText.substring(0, 50)}..."`,
        );

        // "(3~4)", "(3∼4)", "(38∼39)" 등의 구간 패턴 추출 (앞이든 뒤든 상관없이)
        const rangeMatch = fullText.match(/\((\d+)\s*[~∼～\-–—]\s*(\d+)\)/);
        if (rangeMatch) {
          const startNum = parseInt(rangeMatch[1]);
          const endNum = parseInt(rangeMatch[2]);

          // 공통 보기 텍스트 (마커 없이)
          let sharedText = fullText.replace('※', '').trim();

          // 공통 보기의 코드 블록 추출 - pre 태그
          const exampleSrcRow = $parentTbody.find(
            'tr.alla6ExampleTr_Src, tr.allaExampleTr_Src',
          );
          if (exampleSrcRow.length > 0) {
            const $pre = exampleSrcRow.find('td pre');
            const codeText = $pre.text().trim();
            const lang =
              $pre.attr('data-ke-language') ||
              $pre.attr('class')?.split(' ')[0] ||
              '';
            if (codeText) {
              sharedText = `${sharedText}\n\n\`\`\`${lang}\n${codeText}\n\`\`\``;
            }
          }

          // 공통 보기의 내용 추출
          const exampleTxtRow = $parentTbody.find(
            'tr.alla6ExampleTr_Txt, tr.allaExampleTr_Txt',
          );
          if (exampleTxtRow.length > 0) {
            // 방법 1: allaExampleList_p (일반 텍스트)
            const exampleP = exampleTxtRow.find('.allaExampleList_p');
            if (exampleP.length > 0) {
              const txtContent = exampleP.text().trim();
              if (txtContent) {
                sharedText = `${sharedText}\n\n${txtContent}`;
              }
            }

            // 방법 2: allaExampleList_bleft_* (div 코드 형태)
            const exampleDivs = exampleTxtRow.find(
              'div[class^="allaExampleList_bleft"]',
            );
            if (exampleDivs.length > 0) {
              const codeLines: string[] = [];
              exampleDivs.each((_, div) => {
                codeLines.push($(div).text());
              });
              const codeText = codeLines.join('\n').trim();
              if (codeText) {
                sharedText = `${sharedText}\n\n\`\`\`\n${codeText}\n\`\`\``;
              }
            }

            // 방법 3: allaExampleAlign_center (중앙 정렬 텍스트, 흐름도 등)
            const exampleCenter = exampleTxtRow.find(
              '.allaExampleAlign_center',
            );
            if (exampleCenter.length > 0) {
              const centerContent = exampleCenter.text().trim();
              if (centerContent) {
                sharedText = `${sharedText}\n\n${centerContent}`;
              }
            }
          }

          for (let i = startNum; i <= endNum; i++) {
            sharedExampleMap.set(i, sharedText);
          }

          console.log(`  📌 공통 보기 감지: 문제 ${startNum}~${endNum}`);
        } else {
          console.log(
            `  ⚠️  공통 보기 구간 패턴 매칭 실패: "${fullText.substring(0, 80)}"`,
          );
        }
      }
    });

    // 2차: 실제 문제 데이터 추출
    questionTables.each((_, element) => {
      const table = $(element);

      const questionNoText = table.find(`span.${questionClass}`).text().trim();
      const questionNumber = parseInt(questionNoText);

      if (isNaN(questionNumber)) return;

      // 보기문 추출 (텍스트 보기) - 여러 alla6ExampleTr_Txt가 있을 수 있음
      let exampleText: string | null = null;
      const exampleParts: string[] = [];

      table
        .find('tr.alla6ExampleTr_Txt, tr.allaExampleTr_Txt')
        .each((_, row) => {
          const $row = $(row);
          const $td = $row.find('td');

          // 방법 1: allaExampleList_p 클래스 (일반 텍스트 보기)
          const exampleP = $td.find('.allaExampleList_p');
          if (exampleP.length > 0) {
            exampleParts.push(exampleP.text().trim());
          }

          // 방법 2: allaExampleList_bleft_* 클래스 (코드 형태 - div로 들여쓰기된 코드)
          const exampleBleft = $td.find('div[class^="allaExampleList_bleft"]');
          if (exampleBleft.length > 0) {
            const codeLines: string[] = [];
            exampleBleft.each((_, div) => {
              codeLines.push($(div).text());
            });
            const codeText = codeLines.join('\n').trim();
            if (codeText) {
              exampleParts.push(`\`\`\`\n${codeText}\n\`\`\``);
            }
          }

          // 방법 3: allaExampleList_eng 클래스 (영문 보기 목록 - a, b, c, d)
          const exampleEng = $td.find('.allaExampleList_eng');
          if (exampleEng.length > 0) {
            const engLines: string[] = [];
            exampleEng.each((_, div) => {
              engLines.push($(div).text().trim());
            });
            if (engLines.length > 0) {
              exampleParts.push(engLines.join('\n'));
            }
          }

          // 방법 4: allaExampleAlign_center (중앙 정렬 텍스트, 흐름도 등)
          const exampleCenter = $td.find('.allaExampleAlign_center');
          if (exampleCenter.length > 0) {
            const centerContent = exampleCenter.text().trim();
            if (centerContent) {
              exampleParts.push(centerContent);
            }
          }

          // 방법 5: span.ibold (강조 텍스트, 메소드 시그니처 등)
          const exampleBold = $td.find('span.ibold');
          if (
            exampleBold.length > 0 &&
            exampleP.length === 0 &&
            exampleBleft.length === 0 &&
            exampleEng.length === 0 &&
            exampleCenter.length === 0
          ) {
            // 다른 형태가 없을 때만 ibold 추출 (중복 방지)
            exampleParts.push(exampleBold.text().trim());
          }

          // 방법 6: 위 형태가 모두 없으면 td 전체 텍스트
          if (
            exampleP.length === 0 &&
            exampleBleft.length === 0 &&
            exampleEng.length === 0 &&
            exampleCenter.length === 0 &&
            exampleBold.length === 0
          ) {
            const rawText = $td.text().trim();
            if (rawText) {
              exampleParts.push(rawText);
            }
          }
        });

      if (exampleParts.length > 0) {
        exampleText = exampleParts.join('\n\n');
      }

      // 보기 코드 추출 (소스 코드 - pre 태그, 마커 포함)
      const exampleSrcRow = table.find(
        'tr.alla6ExampleTr_Src, tr.allaExampleTr_Src',
      );
      if (exampleSrcRow.length > 0) {
        const $pre = exampleSrcRow.find('td pre');
        const codeText = $pre.text().trim();
        const lang =
          $pre.attr('data-ke-language') ||
          $pre.attr('class')?.split(' ')[0] ||
          '';
        if (codeText) {
          const codeBlock = `\`\`\`${lang}\n${codeText}\n\`\`\``;
          exampleText = exampleText
            ? `${exampleText}\n\n${codeBlock}`
            : codeBlock;
        }
      }

      // 공통 보기는 별도 필드로 저장
      const sharedExample = sharedExampleMap.get(questionNumber) || null;

      const questionRow = table.find(`tr.${questionRowClass} td`);
      const fullText = questionRow.text().trim();
      const questionText = fullText.replace(questionNoText, '').trim();

      const questionImages: string[] = [];
      table.find('img').each((_, img) => {
        const $img = $(img);
        if ($img.closest('tr').hasClass(answerRowClass)) return;
        const src = $img.attr('src');
        if (src) questionImages.push(src);
      });
      const questionImageUrls =
        questionImages.length > 0 ? questionImages : null;

      const choices: Array<{
        number: number;
        text: string;
        imageUrls: string[] | null;
      }> = [];

      table.find(`tr.${answerRowClass}`).each((_, choiceElement) => {
        const choiceRow = $(choiceElement);
        const input = choiceRow.find('input[type=radio]');
        const choiceNumber = parseInt(input.attr('value') || '0');

        if (choiceNumber === 5 || choiceNumber === 0) return;

        const label = choiceRow.find('label');
        const choiceText = label.text().trim();

        const choiceImages: string[] = [];
        label.find('img').each((_, img) => {
          const src = $(img).attr('src');
          if (src) choiceImages.push(src);
        });
        const choiceImageUrls = choiceImages.length > 0 ? choiceImages : null;

        choices.push({
          number: choiceNumber,
          text: choiceText,
          imageUrls: choiceImageUrls,
        });
      });

      questions.push({
        questionNumber,
        questionText,
        exampleText,
        sharedExample,
        questionImageUrls,
        choices,
      });
    });

    console.log(`  ✅ ${questions.length}개 문제 크롤링 완료`);

    // 디버깅: 크롤링된 문제 번호 확인
    if (questions.length > 0) {
      const questionNumbers = questions
        .map((q) => q.questionNumber)
        .sort((a, b) => a - b);
      console.log(
        `  📋 크롤링된 문제 번호: ${questionNumbers.slice(0, 5).join(', ')}${questionNumbers.length > 5 ? ` ... ${questionNumbers[questionNumbers.length - 1]}` : ''}`,
      );
    }

    // ========================================
    // 4단계: 정답표 크롤링
    // ========================================
    console.log('✔️  정답표 파싱 중...');

    const answerMap = new Map<number, number[]>();

    // 방법 1: allaAnswerTableDiv 테이블 형식
    const answerTableDiv = $('.allaAnswerTableDiv table tr');
    if (answerTableDiv.length > 1) {
      console.log('  📌 테이블 형식 정답표 (allaAnswerTableDiv)');

      // 테이블의 첫 번째 문제 번호 확인
      let tableFirstQuestionNo: number | null = null;
      answerTableDiv.each((index, row) => {
        if (index === 0 || tableFirstQuestionNo !== null) return;
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const questionNo = parseInt(cells.eq(0).text().trim());
          if (!isNaN(questionNo)) {
            tableFirstQuestionNo = questionNo;
            return false; // break
          }
        }
      });

      // 크롤링된 문제들의 첫 번째 문제 번호
      const firstQuestionNo =
        questions.length > 0 ? questions[0].questionNumber : 1;

      // 오프셋 계산: 테이블이 1부터 시작하면 오프셋 적용, 이미 실제 번호면 적용 안 함
      const needsOffset = tableFirstQuestionNo === 1;
      const offset = needsOffset ? firstQuestionNo - 1 : 0;

      console.log(
        `  📍 시작 문제 번호: ${firstQuestionNo}, 테이블 첫 번호: ${tableFirstQuestionNo}, 오프셋: ${offset}`,
      );

      answerTableDiv.each((index, row) => {
        if (index === 0) return;

        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const tableQuestionNo = parseInt(cells.eq(0).text().trim());
        const answerText = cells.eq(1).text().trim();

        if (!isNaN(tableQuestionNo) && answerText) {
          // 실제 문제 번호 = 테이블 문제 번호 + 오프셋
          const actualQuestionNo = tableQuestionNo + offset;

          try {
            answerMap.set(
              actualQuestionNo,
              this.parseCorrectAnswers(answerText),
            );
          } catch {
            console.warn(
              `  ⚠️  문제 ${actualQuestionNo} 정답 파싱 실패: ${answerText}`,
            );
          }
        }
      });
    }
    // 방법 2: tbody 테이블 형식 (No, 정답 헤더)
    else {
      const answerTableHeader = $('tbody tr th:contains("정답")');
      if (answerTableHeader.length > 0) {
        console.log('  📌 테이블 형식 정답표 (tbody)');

        // 헤더가 있는 tbody 찾기
        const tbody = answerTableHeader.closest('tbody');
        const rows = tbody.find('tr');

        rows.each((index, row) => {
          const cells = $(row).find('td');
          if (cells.length < 2) return; // td가 2개 미만이면 헤더 행

          const questionNo = parseInt(cells.eq(0).text().trim());
          const answerText = cells.eq(1).text().trim();

          if (!isNaN(questionNo) && answerText) {
            try {
              answerMap.set(questionNo, this.parseCorrectAnswers(answerText));
            } catch {
              console.warn(
                `  ⚠️  문제 ${questionNo} 정답 파싱 실패: ${answerText}`,
              );
            }
          }
        });
      }
      // 방법 3: 문자열 형식
      else {
        console.log('  📌 문자열 형식 정답표');

        const answerStringRow = $('table tbody tr:contains("문제답안")');
        if (answerStringRow.length > 0) {
          const answerString = answerStringRow.next().find('td').text().trim();
          console.log(`  📝 정답 문자열: ${answerString}`);

          // 크롤링된 문제들의 첫 번째 문제 번호 찾기
          const firstQuestionNo =
            questions.length > 0 ? questions[0].questionNumber : 1;
          console.log(`  📍 시작 문제 번호: ${firstQuestionNo}`);

          for (let i = 0; i < answerString.length; i++) {
            const char = answerString[i];
            // 실제 문제 번호 = 시작 문제 번호 + 인덱스
            const questionNo = firstQuestionNo + i;

            try {
              const answers = this.parseCorrectAnswers(char);
              answerMap.set(questionNo, answers);
            } catch {
              console.warn(`  ⚠️  문제 ${questionNo} 정답 파싱 실패: ${char}`);
            }
          }
        }
      }
    }

    console.log(`  ✅ ${answerMap.size}개 정답 파싱 완료`);

    // 디버깅: 정답 맵의 키 확인
    if (answerMap.size > 0) {
      const answerKeys = Array.from(answerMap.keys()).sort((a, b) => a - b);
      console.log(
        `  📋 정답 문제 번호: ${answerKeys.slice(0, 5).join(', ')}${answerKeys.length > 5 ? ` ... ${answerKeys[answerKeys.length - 1]}` : ''}`,
      );
    }

    if (questions.length > 0 && answerMap.size === 0) {
      throw new Error('정답표를 찾을 수 없습니다. HTML 구조를 확인하세요.');
    }

    if (!year) {
      throw new Error(
        '시험 연도를 추출할 수 없습니다. HTML 구조를 확인하세요.',
      );
    }
    if (!subjectName || subjectName.trim() === '') {
      throw new Error('과목명을 추출할 수 없습니다. HTML 구조를 확인하세요.');
    }

    // ========================================
    // 4.5단계: 이미지 R2 처리
    // ========================================
    console.log('☁️ 이미지 다운로드 및 R2 저장 중...');
    await Promise.all(
      questions.map(async (questionData) => {
        // 문제 이미지 다중 처리
        if (
          questionData.questionImageUrls &&
          questionData.questionImageUrls.length > 0
        ) {
          const newUrls = await Promise.all(
            questionData.questionImageUrls.map(async (url, idx) => {
              const newUrl = await this.storageService.processAndUploadImage(
                url,
                `exam_${year}_sub_${subjectName}_q_${questionData.questionNumber}_img${idx}`,
              );
              return newUrl || url; // 실패하면 원본 유지
            }),
          );
          questionData.questionImageUrls = newUrls;
        }

        // 보기 이미지 다중 처리
        await Promise.all(
          questionData.choices.map(async (choice) => {
            if (choice.imageUrls && choice.imageUrls.length > 0) {
              const newUrls = await Promise.all(
                choice.imageUrls.map(async (url, idx) => {
                  const newUrl =
                    await this.storageService.processAndUploadImage(
                      url,
                      `exam_${year}_sub_${subjectName}_q_${questionData.questionNumber}_c_${choice.number}_img${idx}`,
                    );
                  return newUrl || url; // 실패하면 원본 유지
                }),
              );
              choice.imageUrls = newUrls;
            }
          }),
        );
      }),
    );

    // ========================================
    // 5단계: 트랜잭션으로 DB 저장
    // ========================================
    console.log('💾 데이터베이스 저장 중...');

    return await this.dataSource.transaction(async (manager) => {
      const subject =
        await this.subjectsService.findOrCreateByName(subjectName);

      const existingExam = await manager.findOne(Exam, {
        where: {
          subject_id: subject.id,
          year: year,
          exam_type: examType,
        },
      });

      let savedExam: Exam;

      if (existingExam) {
        if (forceRetry) {
          console.log('  ⚠️  기존 시험 업데이트 중...');
          console.log(
            `     ID: ${existingExam.id}, 제목: ${existingExam.title}`,
          );

          await manager.delete(Questsion, { exam_id: existingExam.id });

          existingExam.title = title;
          existingExam.total_questions = questions.length;
          savedExam = await manager.save(existingExam);

          console.log('  ✅ 업데이트 완료');
        } else {
          throw new Error(
            `이미 동일한 시험이 존재합니다. --retry 옵션을 사용하세요.\n` +
              `기존 시험 ID: ${existingExam.id}, 제목: ${existingExam.title}, 년도: ${existingExam.year}, 타입: ${existingExam.exam_type}`,
          );
        }
      } else {
        const exam = manager.create(Exam, {
          subject_id: subject.id,
          year,
          exam_type: examType,
          title,
          total_questions: questions.length,
        });
        savedExam = await manager.save(exam);
        console.log(`  ✅ 시험 저장 완료 (ID: ${savedExam.id})`);
      }

      // 건너뛴 문제 추적
      const skippedQuestions: number[] = [];
      let savedQuestionCount = 0;

      for (const questionData of questions) {
        const correctAnswers = answerMap.get(questionData.questionNumber);

        if (!correctAnswers || correctAnswers.length === 0) {
          console.warn(
            `  ⚠️  문제 ${questionData.questionNumber} 정답 없음, 건너뜀`,
          );
          skippedQuestions.push(questionData.questionNumber);
          continue;
        }

        const question = manager.create(Questsion, {
          exam_id: savedExam.id,
          question_number: questionData.questionNumber,
          question_text: questionData.questionText,
          example_text: questionData.exampleText,
          shared_example: questionData.sharedExample,
          question_image_urls: questionData.questionImageUrls,
          correct_answers: correctAnswers,
          choices: questionData.choices,
        });
        await manager.save(question);
        savedQuestionCount++;
      }

      if (skippedQuestions.length > 0) {
        console.warn(
          `  ⚠️  ${skippedQuestions.length}개 문제 건너뜀: ${skippedQuestions.join(', ')}`,
        );
      }
      console.log(`  ✅ ${savedQuestionCount}개 문제 및 선택지 저장 완료`);

      return {
        examId: savedExam.id,
        title: savedExam.title,
        questionCount: savedQuestionCount,
        totalQuestions: questions.length,
        skippedQuestions:
          skippedQuestions.length > 0 ? skippedQuestions : undefined,
      };
    });
  }

  // 전체 자동 크롤링
  async crawlAll(
    mainUrl: string,
    options: {
      forceRetry?: boolean;
      subjectFilter?: string[]; // 특정 과목만 크롤링
      delay?: number; // 요청 간 딜레이 (ms)
      startIndex?: number; // 시작 과목 인덱스 (0부터 시작)
    } = {},
  ) {
    const {
      forceRetry = false,
      subjectFilter = [],
      delay = 1000,
      startIndex = 0,
    } = options;

    // 1단계: 과목 목록 수집
    let subjects = await this.getSubjectLinks(mainUrl);

    // 필터 적용 (특정 과목만 크롤링하고 싶을 때)
    if (subjectFilter.length > 0) {
      subjects = subjects.filter((s) => subjectFilter.includes(s.name));
      console.log(`🔍 필터 적용: ${subjects.length}개 과목 선택됨`);
    }

    let successCount = 0;
    let failCount = 0;
    const errorLogs: CrawlErrorLog[] = [];
    const failedUrls: string[] = [];

    // 시작 인덱스 적용
    const actualStartIndex = Math.max(
      0,
      Math.min(startIndex, subjects.length - 1),
    );
    if (actualStartIndex > 0) {
      console.log(
        `📍 ${actualStartIndex}번째 과목부터 시작 (${actualStartIndex}개 건너뜀)`,
      );
    }

    // 2단계: 각 과목별로 처리
    for (let i = actualStartIndex; i < subjects.length; i++) {
      const subject = subjects[i];
      console.log(`\n[${i + 1}/${subjects.length}] 📖 과목: ${subject.name}`);

      try {
        // 2-1: 과목 페이지에서 시험지 목록 추출
        const examLinks = await this.getExamLinks(subject.url);
        console.log(`  📄 ${examLinks.length}개 시험지 발견`);

        // 3단계: 각 시험지 크롤링
        for (let j = 0; j < examLinks.length; j++) {
          try {
            console.log(
              `  [${j + 1}/${examLinks.length}] 크롤링: ${examLinks[j]}`,
            );
            const result = await this.crawlExam(examLinks[j], forceRetry);
            successCount++;

            // 건너뛴 문제가 있으면 로그에 기록
            if (result.skippedQuestions && result.skippedQuestions.length > 0) {
              errorLogs.push({
                timestamp: new Date().toISOString(),
                url: examLinks[j],
                subjectName: subject.name,
                errorType: 'missing_answer',
                errorMessage: `정답 없는 문제 ${result.skippedQuestions.length}개 건너뜀`,
                skippedQuestions: result.skippedQuestions,
              });

              // 건너뛴 문제가 있는 URL도 재시도 목록에 추가
              failedUrls.push(examLinks[j]);
            }

            // 서버 부담 감소를 위한 딜레이
            if (j < examLinks.length - 1) {
              await this.sleep(delay);
            }
          } catch (error: any) {
            console.error(`  ❌ 실패: ${error.message}`);
            failCount++;

            // 에러 로그 저장
            errorLogs.push({
              timestamp: new Date().toISOString(),
              url: examLinks[j],
              subjectName: subject.name,
              errorType: 'exam',
              errorMessage: error.message,
              stackTrace: error.stack,
            });

            // 실패한 URL 저장
            failedUrls.push(examLinks[j]);
          }
        }
      } catch (error: any) {
        console.error(`❌ 과목 처리 실패: ${error.message}`);
        failCount++;

        // 에러 로그 저장
        errorLogs.push({
          timestamp: new Date().toISOString(),
          url: subject.url,
          subjectName: subject.name,
          errorType: 'subject',
          errorMessage: error.message,
          stackTrace: error.stack,
        });

        // 실패한 URL 저장
        failedUrls.push(subject.url);
      }
    }

    // 최종 결과 출력
    console.log('\n' + '='.repeat(60));
    console.log('✅ 크롤링 완료!');
    console.log(`   - 성공: ${successCount}개`);
    console.log(`   - 실패: ${failCount}개`);

    // 실패 목록 출력
    if (errorLogs.length > 0) {
      console.log('\n⚠️  실패 목록:');
      errorLogs.forEach((log) => {
        console.log(`   [${log.errorType}] ${log.subjectName || log.url}`);
        console.log(`      사유: ${log.errorMessage}`);
      });

      // 로그 파일 저장
      const errorLogFile = await this.saveErrorLogs(errorLogs);
      const urlLogFile = await this.saveFailedUrls(failedUrls);

      console.log('\n📝 로그 파일 저장:');
      if (errorLogFile) {
        console.log(`   - 상세 에러 로그: ${errorLogFile}`);
      }
      if (urlLogFile) {
        console.log(`   - 실패 URL 목록: ${urlLogFile}`);
        console.log(
          `   💡 재시도: cat ${urlLogFile} | while read url; do yarn crawl "$url" --retry; done`,
        );
      }
    }

    console.log('='.repeat(60));

    return {
      successCount,
      failCount,
      errorLogs,
      failedUrls,
    };
  }
}
