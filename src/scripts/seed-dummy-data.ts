import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { Exam } from '../exams/entities/exam.entity';
import { Questsion } from '../questions/entities/question.entity';
import { Subject } from '../subjects/entities/subject.entity';

/**
 * 대량 더미 데이터 생성 스크립트
 * 성능 테스트를 위한 대량 데이터 생성
 */
async function seed() {
  console.log('📊 더미 데이터 생성 시작...\n');
  
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false
  });

  try {
    const dataSource = app.get(DataSource);
    
    // 커맨드라인 인자로 생성할 개수 받기 (기본값: 시험 100개)
    const examCount = parseInt(process.argv[2]) || 100;
    const questionsPerExam = 35;  // 시험당 문제 수
    
    console.log(`📝 생성할 데이터:`);
    console.log(`  - 시험: ${examCount}개`);
    console.log(`  - 문제: ${examCount * questionsPerExam}개 (${questionsPerExam}개/시험)`);
    console.log(`  - 선택지: ${examCount * questionsPerExam * 4}개 (JSONB 포함)\n`);
    
    // 과목 목록 (방송대 실제 과목들)
    const subjectNames = [
      '미적분학', '선형대수', '확률통계', '이산수학',
      '자료구조', '알고리즘', '운영체제', '데이터베이스',
      '컴퓨터구조', '컴퓨터네트워크', '소프트웨어공학', '인공지능',
      '간호학개론', '성인간호학', '아동간호학', '정신간호학',
      '경영학원론', '재무관리', '마케팅원론', '생산관리',
      '거시경제학', '미시경제학', '국제경제학', '경제학원론',
      '행정학개론', '정책학개론', '조직론', '인사행정론'
    ];
    
    // 시험 타입 (1: 1학기 기말, 2: 2학기 기말, 3: 하계, 4: 동계)
    const examTypes = [1, 2, 3, 4];
    const examTypeNames = ['1학기 기말', '2학기 기말', '하계 계절학기', '동계 계절학기'];
    
    // 샘플 문제 텍스트
    const sampleQuestions = [
      '다음 중 옳은 설명을 고르시오.',
      '다음 중 틀린 설명을 고르시오.',
      '다음 개념에 대한 설명으로 가장 적절한 것은?',
      '다음 중 가장 중요한 요소는 무엇인가?',
      '다음 설명에 해당하는 것을 모두 고르시오.',
      '아래 보기에서 설명하는 개념은?',
      '다음 중 관련 없는 것을 고르시오.',
      '다음 중 순서가 올바른 것은?',
      '다음 내용의 핵심 개념은?',
      '다음 중 가장 적절한 설명은?'
    ];
    
    // 샘플 선택지 텍스트
    const sampleChoices = [
      '첫 번째 개념을 설명하는 내용입니다.',
      '두 번째 개념에 대한 설명으로 맞는 내용입니다.',
      '세 번째 옵션으로 제시되는 내용입니다.',
      '네 번째 선택지에 대한 설명입니다.',
      '올바른 이론적 배경을 가진 설명입니다.',
      '실무에서 자주 사용되는 방법론입니다.',
      '학술적으로 검증된 내용을 포함합니다.',
      '일반적으로 통용되는 개념 설명입니다.'
    ];
    
    await dataSource.transaction(async (manager) => {
      console.log('🔄 트랜잭션 시작...\n');
      
      // 1단계: 과목 생성 또는 조회
      console.log('📚 과목 처리 중...');
      const subjects: Subject[] = [];
      
      for (const subjectName of subjectNames) {
        let subject = await manager.findOne(Subject, { where: { name: subjectName } });
        
        if (!subject) {
          subject = manager.create(Subject, { name: subjectName });
          subject = await manager.save(subject);
        }
        
        subjects.push(subject);
      }
      
      console.log(`  ✅ ${subjects.length}개 과목 준비 완료\n`);
      
      // 2단계: 시험 및 문제 생성 (배치 처리)
      console.log('📝 시험 및 문제 생성 중...');
      
      const startYear = 2015;
      const endYear = 2024;
      
      let createdExams = 0;
      let createdQuestions = 0;
      
      // 배치 단위로 처리 (메모리 효율)
      const batchSize = 10;
      
      for (let batch = 0; batch < Math.ceil(examCount / batchSize); batch++) {
        const examsInBatch = Math.min(batchSize, examCount - batch * batchSize);
        
        for (let i = 0; i < examsInBatch; i++) {
          // 랜덤 과목, 연도, 시험 타입 선택
          const subject = subjects[Math.floor(Math.random() * subjects.length)];
          const year = startYear + Math.floor(Math.random() * (endYear - startYear + 1));
          const examType = examTypes[Math.floor(Math.random() * examTypes.length)];
          const examTypeName = examTypeNames[examType - 1];
          
          // 시험 생성
          const exam = manager.create(Exam, {
            subject_id: subject.id,
            year,
            exam_type: examType,
            title: `${subject.name} ${examTypeName} ${year}년도`,
            total_questions: questionsPerExam
          });
          const savedExam = await manager.save(exam);
          createdExams++;
          
          // 해당 시험의 문제 생성
          const questionsToInsert: Questsion[] = [];
          
          for (let qNum = 1; qNum <= questionsPerExam; qNum++) {
            // 랜덤 문제 텍스트
            const questionText = sampleQuestions[Math.floor(Math.random() * sampleQuestions.length)];
            
            // 보기문 (30% 확률로 포함)
            const hasExample = Math.random() < 0.3;
            const exampleText = hasExample ? '【보기】\nㄱ. 첫 번째 보기\nㄴ. 두 번째 보기\nㄷ. 세 번째 보기' : null;
            
            // 선택지 생성 (4개)
            const choices = [];
            for (let cNum = 1; cNum <= 4; cNum++) {
              const choiceText = sampleChoices[Math.floor(Math.random() * sampleChoices.length)];
              choices.push({
                number: cNum,
                text: `${cNum}. ${choiceText}`,
                imageUrl: null
              });
            }
            
            // 정답 생성 (80% 단일 정답, 20% 복수 정답)
            let correctAnswers: number[];
            if (Math.random() < 0.8) {
              // 단일 정답
              correctAnswers = [Math.floor(Math.random() * 4) + 1];
            } else {
              // 복수 정답 (2~4개)
              const count = Math.floor(Math.random() * 3) + 2; // 2, 3, 4
              const answers = new Set<number>();
              while (answers.size < count) {
                answers.add(Math.floor(Math.random() * 4) + 1);
              }
              correctAnswers = Array.from(answers).sort();
            }
            
            const question = manager.create(Questsion, {
              exam_id: savedExam.id,
              question_number: qNum,
              question_text: `${qNum}. ${questionText}`,
              example_text: exampleText,
              question_image_url: null,
              correct_answers: correctAnswers,
              choices: choices
            });
            
            questionsToInsert.push(question);
          }
          
          // 문제 배치 저장 (Bulk INSERT)
          await manager.save(questionsToInsert);
          createdQuestions += questionsToInsert.length;
        }
        
        // 진행률 표시
        const progress = Math.min(((batch + 1) * batchSize), examCount);
        const percentage = Math.round((progress / examCount) * 100);
        process.stdout.write(`  진행: ${progress}/${examCount} 시험 (${percentage}%) - ${createdQuestions}개 문제\r`);
      }
      
      console.log('\n');
      console.log(`  ✅ ${createdExams}개 시험 생성 완료`);
      console.log(`  ✅ ${createdQuestions}개 문제 생성 완료`);
      console.log(`  ✅ ${createdQuestions * 4}개 선택지 생성 완료 (JSONB 포함)\n`);
    });
    
    console.log('🎉 더미 데이터 생성 완료!');
    
    // 최종 통계 출력
    const stats = await dataSource.query(`
      SELECT 
        (SELECT COUNT(*) FROM subjects) as subject_count,
        (SELECT COUNT(*) FROM exams) as exam_count,
        (SELECT COUNT(*) FROM questions) as question_count
    `);
    
    console.log('\n📊 전체 데이터 통계:');
    console.log(`  - 과목: ${stats[0].subject_count}개`);
    console.log(`  - 시험: ${stats[0].exam_count}개`);
    console.log(`  - 문제: ${stats[0].question_count}개`);
    console.log(`  - 선택지: ${stats[0].question_count * 4}개 (JSONB)\n`);
    
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    console.error(error.stack);
  } finally {
    await app.close();
  }
}

seed();
