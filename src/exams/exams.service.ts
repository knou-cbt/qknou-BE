import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Exam } from './entities/exam.entity';
import { DataSource, Repository } from 'typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Choice } from 'src/choices/entities/choice.entity';
import { SubjectsService } from 'src/subjects/subjects.service';
import axios from 'axios';
import * as cheerio from 'cheerio';

// 중복 답안 매핑
const MULTIPLE_ANSWER_MAP: Record<string, number[]> = {
  'A': [1, 2], 'B': [1, 3], 'C': [1, 4], 'D': [2, 3],
  'E': [2, 4], 'F': [3, 4], 'G': [1, 2, 3], 'H': [1, 2, 4],
  'I': [1, 3, 4], 'J': [2, 3, 4], 'K': [1, 2, 3, 4]
};

@Injectable()
export class ExamsService {
  constructor(
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>,

    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,

    @InjectRepository(Choice)
    private choiceRepository: Repository<Choice>,

    private subjectsService: SubjectsService,
    private dataSource: DataSource
  ) { }

  // 정답을 배열로 변환 (중복 답안 처리)
  private parseCorrectAnswers(answerText: string): number[] {
    const trimmed = answerText.trim();
    if (MULTIPLE_ANSWER_MAP[trimmed]) {
      return MULTIPLE_ANSWER_MAP[trimmed];
    }
    const parsed = parseInt(trimmed);
    if (isNaN(parsed)) {
      throw new Error(`잘못된 정답 형식: ${answerText}`);
    }
    return [parsed];
  }

  // 시험 타입 파싱
  private parseExamType(examTypeText: string): number {
    if (examTypeText.includes('기말')) return 1;
    if (examTypeText.includes('중간')) return 2;
    if (examTypeText.includes('계절')) return 3;
    return 1; // 기본값
  }

  async saveExamFromUrl(url: string, forceRetry: boolean = false) {
    // 1. URL에서 HTML 가져오기
    console.log('📥 HTML 다운로드 중...');
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    // 2. 시험 정보 추출 (두 가지 버전 지원)
    console.log('📋 시험 정보 파싱 중...');
    
    let year: number, questionCount: number, subjectName: string, examTypeText: string;
    
    // 버전 1: alla6TitleTbl 시도
    const alla6InfoTable = $('table.alla6TitleTbl tbody');
    if (alla6InfoTable.length > 0) {
      console.log('  📌 alla6 버전 감지');
      const infoText = alla6InfoTable.text();
      
      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);
      
      year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;
      
      subjectName = alla6InfoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = alla6InfoTable.find('tr').eq(2).find('td').text().replace('시험종류', '').replace(':', '').trim();
    } else {
      // 버전 2: 기본 tbody 방식
      console.log('  📌 기본 버전 감지');
      const infoTable = $('table tbody').first();
      const infoText = infoTable.text();
      
      const yearMatch = infoText.match(/(\d{4})\s*학년도/);
      const questionCountMatch = infoText.match(/학년\s*(\d+)\s*문항/);
      
      year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
      questionCount = questionCountMatch ? parseInt(questionCountMatch[1]) : 0;
      
      subjectName = infoTable.find('tr').eq(1).find('td').text().trim();
      examTypeText = infoTable.find('tr').eq(2).find('td').text().trim();
    }
    
    const examType = this.parseExamType(examTypeText);
    const title = `${subjectName} ${examTypeText} ${year}년도`;
    
    console.log(`  - 과목: ${subjectName}`);
    console.log(`  - 시험 종류: ${examTypeText} (타입: ${examType})`);
    console.log(`  - 년도: ${year}`);
    console.log(`  - 예상 문제 수: ${questionCount}`);

    // 3. 문제 크롤링 (두 가지 버전 지원)
    console.log('❓ 문제 크롤링 중...');
    const questions: Array<{
      questionNumber: number;
      questionText: string;
      exampleText: string | null;
      questionImageUrl: string | null;
      choices: Array<{
        choiceNumber: number;
        choiceText: string;
        choiceImageUrl: string | null;
      }>;
    }> = [];

    // allaBasicTbl 시도
    let questionTables = $('table.allaBasicTbl');
    let questionClass = 'allaQuestionNo';
    let questionRowClass = 'allaQuestionTr';
    let answerRowClass = 'allaAnswerTr';
    
    // alla6BasicTbl 시도 (allaBasicTbl이 없으면)
    if (questionTables.length === 0) {
      console.log('  📌 alla6BasicTbl 사용');
      questionTables = $('table.alla6BasicTbl');
      questionClass = 'alla6QuestionNo';
      questionRowClass = 'alla6QuestionTr';
      answerRowClass = 'alla6AnswerTr';
    } else {
      console.log('  📌 allaBasicTbl 사용');
    }

    questionTables.each((_, element) => {
      const table = $(element);
      
      // 문제 번호 추출
      const questionNoText = table.find(`span.${questionClass}`).text().trim();
      const questionNumber = parseInt(questionNoText);
      
      if (isNaN(questionNumber)) return;

      // 보기문 추출 (있을 수도, 없을 수도 있음)
      let exampleText: string | null = null;
      const exampleRow = table.find('tr.alla6ExampleTr_Txt .allaExampleList_p, tr.allaExampleTr_Txt .allaExampleList_p');
      if (exampleRow.length > 0) {
        exampleText = exampleRow.text().trim();
      }

      // 문제 텍스트 추출 (문제 번호 제외)
      const questionRow = table.find(`tr.${questionRowClass} td`);
      const fullText = questionRow.text().trim();
      const questionText = fullText.replace(questionNoText, '').trim();

      // 문제 이미지 URL 추출
      const questionImageUrl = questionRow.find('img').first().attr('src') || null;

      // 선택지 크롤링
      const choices: Array<{
        choiceNumber: number;
        choiceText: string;
        choiceImageUrl: string | null;
      }> = [];

      table.find(`tr.${answerRowClass}`).each((_, choiceElement) => {
        const choiceRow = $(choiceElement);
        const input = choiceRow.find('input[type=radio]');
        const choiceNumber = parseInt(input.attr('value') || '0');
        
        if (choiceNumber === 5 || choiceNumber === 0) return; // "모름" 또는 잘못된 값 제외

        // 선택지 텍스트 추출 (label 전체 텍스트)
        const label = choiceRow.find('label');
        const choiceText = label.text().trim();

        // 선택지 이미지 URL 추출
        const choiceImageUrl = label.find('img').first().attr('src') || null;

        choices.push({
          choiceNumber,
          choiceText,
          choiceImageUrl
        });
      });

      questions.push({
        questionNumber,
        questionText,
        exampleText,
        questionImageUrl,
        choices
      });
    });

    console.log(`  ✅ ${questions.length}개 문제 크롤링 완료`);

    // 4. 정답표 크롤링 (두 가지 형식 지원)
    console.log('✔️  정답표 파싱 중...');
    const answerMap = new Map<number, number[]>();
    
    // 방법 1: 테이블 형식 (.allaAnswerTableDiv)
    const answerTableDiv = $('.allaAnswerTableDiv table tr');
    if (answerTableDiv.length > 1) {
      console.log('  📌 테이블 형식 정답표');
      answerTableDiv.each((index, row) => {
        if (index === 0) return; // 헤더 행 제외
        
        const cells = $(row).find('td');
        if (cells.length < 2) return;
        
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
      // 방법 2: 문자열 형식 (예: K2343433211144434123221442133211341)
      console.log('  📌 문자열 형식 정답표');
      const answerStringRow = $('table tbody tr:contains("문제답안")');
      if (answerStringRow.length > 0) {
        const answerString = answerStringRow.next().find('td').text().trim();
        console.log(`  📝 정답 문자열: ${answerString}`);
        
        // 각 문자를 순회하면서 정답 매핑
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

    // 검증: 문제 수와 정답 수 확인
    if (questions.length > 0 && answerMap.size === 0) {
      throw new Error('정답표를 찾을 수 없습니다. HTML 구조를 확인하세요.');
    }

    // 5. 트랜잭션으로 DB 저장
    console.log('💾 데이터베이스 저장 중...');
    
    return await this.dataSource.transaction(async (manager) => {
      // 5-1. forceRetry 처리
      if (forceRetry) {
        const existingExam = await manager.findOne(Exam, { where: { title } });
        if (existingExam) {
          console.log('  ⚠️  기존 시험 삭제 중...');
          await manager.delete(Exam, existingExam.id);
          console.log('  ✅ 삭제 완료');
        }
      } else {
        // 중복 체크
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

      // 5-3. 시험 생성
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
      for (const questionData of questions) {
        const correctAnswers = answerMap.get(questionData.questionNumber);
        
        if (!correctAnswers || correctAnswers.length === 0) {
          console.warn(`  ⚠️  문제 ${questionData.questionNumber} 정답 없음, 건너뜀`);
          continue;
        }

        const question = manager.create(Questsion, {
          exam_id: savedExam.id,
          question_number: questionData.questionNumber,
          question_text: questionData.questionText,
          example_text: questionData.exampleText,
          question_image_url: questionData.questionImageUrl,
          correct_answers: correctAnswers
        });
        const savedQuestion = await manager.save(question);

        // 선택지 저장
        for (const choiceData of questionData.choices) {
          const choice = manager.create(Choice, {
            question_id: savedQuestion.id,
            choice_number: choiceData.choiceNumber,
            choice_text: choiceData.choiceText,
            choice_image_url: choiceData.choiceImageUrl
          });
          await manager.save(choice);
        }
      }

      console.log(`  ✅ ${questions.length}개 문제 및 선택지 저장 완료`);

      return {
        examId: savedExam.id,
        title: savedExam.title,
        questionCount: questions.length
      };
    });
  }
}
