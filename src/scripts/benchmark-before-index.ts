import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

async function benchmark() {
  console.log('📊 인덱스 추가 전 성능 벤치마크\n');
  console.log('='.repeat(60));
  
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false
  });

  try {
    const dataSource = app.get(DataSource);
    const results: any = {
      timestamp: new Date().toISOString(),
      phase: 'BEFORE_INDEX',
      tests: []
    };

    // ========================================
    // 1. 현재 인덱스 확인
    // ========================================
    console.log('\n📌 1. 현재 인덱스 상태 확인\n');
    
    const indexes = await dataSource.query(`
      SELECT 
        tablename, 
        indexname, 
        indexdef 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND tablename IN ('subjects', 'exams', 'questions')
      ORDER BY tablename, indexname;
    `);
    
    console.log('현재 인덱스 목록:');
    if (indexes.length === 0) {
      console.log('  ⚠️  인덱스 없음 (PK 제외)');
    } else {
      indexes.forEach((idx: any) => {
        console.log(`  - ${idx.tablename}.${idx.indexname}`);
      });
    }
    
    results.indexes = indexes;

    // ========================================
    // 2. 데이터 개수 확인
    // ========================================
    console.log('\n📌 2. 데이터 개수\n');
    
    const counts = await dataSource.query(`
      SELECT 
        (SELECT COUNT(*) FROM subjects) as subjects,
        (SELECT COUNT(*) FROM exams) as exams,
        (SELECT COUNT(*) FROM questions) as questions
    `);
    
    console.log(`  - Subjects:  ${counts[0].subjects.toLocaleString()}개`);
    console.log(`  - Exams:     ${counts[0].exams.toLocaleString()}개`);
    console.log(`  - Questions: ${counts[0].questions.toLocaleString()}개`);
    
    results.dataCounts = counts[0];

    // ========================================
    // 3. 쿼리 성능 테스트
    // ========================================
    console.log('\n📌 3. 쿼리 성능 테스트\n');

    // 3-1. questions WHERE exam_id (가장 중요!)
    console.log('테스트 1: SELECT * FROM questions WHERE exam_id = ?');
    const questionsTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT * FROM questions WHERE exam_id = 1;
    `);
    
    const questionsPlan = questionsTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(questionsPlan);
    
    results.tests.push({
      name: 'questions_by_exam_id',
      query: 'SELECT * FROM questions WHERE exam_id = 1',
      plan: questionsPlan,
      scanType: questionsPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // 3-2. exams WHERE subject_id
    console.log('\n테스트 2: SELECT * FROM exams WHERE subject_id = ?');
    const examsTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT * FROM exams WHERE subject_id = 1;
    `);
    
    const examsPlan = examsTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(examsPlan);
    
    results.tests.push({
      name: 'exams_by_subject_id',
      query: 'SELECT * FROM exams WHERE subject_id = 1',
      plan: examsPlan,
      scanType: examsPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // 3-3. subjects LIKE 검색
    console.log('\n테스트 3: SELECT * FROM subjects WHERE name LIKE ?');
    const subjectsTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT * FROM subjects WHERE name LIKE '컴퓨터%';
    `);
    
    const subjectsPlan = subjectsTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(subjectsPlan);
    
    results.tests.push({
      name: 'subjects_like_search',
      query: "SELECT * FROM subjects WHERE name LIKE '컴퓨터%'",
      plan: subjectsPlan,
      scanType: subjectsPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // 3-4. exams WHERE year AND exam_type (중복 체크)
    console.log('\n테스트 4: SELECT * FROM exams WHERE year = ? AND exam_type = ?');
    const examsYearTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT * FROM exams WHERE year = 2024 AND exam_type = 1;
    `);
    
    const examsYearPlan = examsYearTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(examsYearPlan);
    
    results.tests.push({
      name: 'exams_by_year_and_type',
      query: 'SELECT * FROM exams WHERE year = 2024 AND exam_type = 1',
      plan: examsYearPlan,
      scanType: examsYearPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // 3-5. subjects COUNT (과목 목록 페이지 - 전체 개수)
    console.log('\n테스트 5: SELECT COUNT(*) FROM subjects');
    const subjectsCountTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT COUNT(*) FROM subjects;
    `);
    
    const subjectsCountPlan = subjectsCountTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(subjectsCountPlan);
    
    results.tests.push({
      name: 'subjects_count',
      query: 'SELECT COUNT(*) FROM subjects',
      plan: subjectsCountPlan,
      scanType: subjectsCountPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // 3-6. subjects ORDER BY + LIMIT (과목 목록 페이지 - 실제 조회)
    console.log('\n테스트 6: SELECT * FROM subjects ORDER BY name LIMIT 10');
    const subjectsPaginationTest = await dataSource.query(`
      EXPLAIN ANALYZE 
      SELECT * FROM subjects 
      ORDER BY name ASC 
      LIMIT 10 OFFSET 0;
    `);
    
    const subjectsPaginationPlan = subjectsPaginationTest.map((r: any) => r['QUERY PLAN']).join('\n');
    console.log(subjectsPaginationPlan);
    
    results.tests.push({
      name: 'subjects_pagination',
      query: 'SELECT * FROM subjects ORDER BY name ASC LIMIT 10 OFFSET 0',
      plan: subjectsPaginationPlan,
      scanType: subjectsPaginationPlan.includes('Seq Scan') ? 'SEQ_SCAN' : 'INDEX_SCAN'
    });

    // ========================================
    // 4. TypeORM 레벨 성능 테스트 (실제 사용 패턴)
    // ========================================
    console.log('\n📌 4. TypeORM 레벨 성능 (100회 반복)\n');

    const questionRepo = dataSource.getRepository('Questsion');
    const examRepo = dataSource.getRepository('Exam');
    const subjectRepo = dataSource.getRepository('Subject');

    // 웜업
    await questionRepo.find({ where: { exam_id: 1 } });
    await examRepo.find({ where: { subject_id: 1 } });

    // 4-1. Questions 조회
    const questionTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await questionRepo.find({ where: { exam_id: 1 }, order: { question_number: 'ASC' } });
      questionTimes.push(performance.now() - start);
    }

    const qAvg = questionTimes.reduce((a, b) => a + b, 0) / questionTimes.length;
    const qP50 = questionTimes.sort((a, b) => a - b)[50];
    const qP95 = questionTimes.sort((a, b) => a - b)[95];

    console.log('Questions 조회 (exam_id = 1):');
    console.log(`  평균: ${qAvg.toFixed(2)}ms`);
    console.log(`  P50:  ${qP50.toFixed(2)}ms`);
    console.log(`  P95:  ${qP95.toFixed(2)}ms`);

    results.typeorm = {
      questions: { avg: qAvg, p50: qP50, p95: qP95 }
    };

    // 4-2. Exams 조회
    const examTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      await examRepo.find({ where: { subject_id: 1 }, order: { year: 'DESC' } });
      examTimes.push(performance.now() - start);
    }

    const eAvg = examTimes.reduce((a, b) => a + b, 0) / examTimes.length;
    const eP50 = examTimes.sort((a, b) => a - b)[50];
    const eP95 = examTimes.sort((a, b) => a - b)[95];

    console.log('\nExams 조회 (subject_id = 1):');
    console.log(`  평균: ${eAvg.toFixed(2)}ms`);
    console.log(`  P50:  ${eP50.toFixed(2)}ms`);
    console.log(`  P95:  ${eP95.toFixed(2)}ms`);

    results.typeorm.exams = { avg: eAvg, p50: eP50, p95: eP95 };

    // ========================================
    // 5. 결과 저장
    // ========================================
    const resultDir = path.join(process.cwd(), 'benchmark-results');
    if (!fs.existsSync(resultDir)) {
      fs.mkdirSync(resultDir, { recursive: true });
    }

    const filename = path.join(resultDir, `before-index-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(results, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ 벤치마크 완료! 결과 저장됨: ${filename}`);
    console.log('\n💡 다음 단계:');
    console.log('   1. 인덱스 추가');
    console.log('   2. 앱 재시작 (yarn start:dev)');
    console.log('   3. yarn benchmark:after 실행');
    console.log('   4. 결과 비교\n');

  } catch (error) {
    console.error('❌ 에러:', error);
  } finally {
    await app.close();
  }
}

benchmark();