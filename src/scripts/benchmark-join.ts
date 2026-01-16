import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';

async function benchmark() {
  console.log('📊 JOIN 방식 TypeORM 성능 벤치마크 시작...\n');
  
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false
  });

  try {
    const dataSource = app.get(DataSource);
    
    // choices_test 테이블 존재 확인
    const tableExists = await dataSource.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'choices_test'
      );
    `);
    
    if (!tableExists[0].exists) {
      console.error('❌ choices_test 테이블이 없습니다.');
      console.error('\n💡 먼저 다음 SQL을 실행하세요:');
      console.error(`
CREATE TABLE choices_test (
  id SERIAL PRIMARY KEY,
  question_id INT,
  choice_number INT,
  choice_text TEXT,
  choice_image_url TEXT
);

INSERT INTO choices_test (question_id, choice_number, choice_text, choice_image_url)
SELECT 
  q.id,
  (choice->>'choiceNumber')::int,
  choice->>'choiceText',
  choice->>'choiceImageUrl'
FROM questions q,
jsonb_array_elements(q.choices) AS choice;
      `);
      await app.close();
      return;
    }
    
    const examId = 1;
    
    // 웜업
    console.log('🔥 웜업 중...');
    await dataSource.query(`
      SELECT q.*, c.* 
      FROM questions q
      LEFT JOIN choices_test c ON c.question_id = q.id
      WHERE q.exam_id = $1
    `, [examId]);
    await dataSource.query(`
      SELECT q.*, c.* 
      FROM questions q
      LEFT JOIN choices_test c ON c.question_id = q.id
      WHERE q.exam_id = $1
    `, [examId]);
    await dataSource.query(`
      SELECT q.*, c.* 
      FROM questions q
      LEFT JOIN choices_test c ON c.question_id = q.id
      WHERE q.exam_id = $1
    `, [examId]);
    
    // 실제 측정
    const iterations = 100;
    const times: number[] = [];
    
    console.log(`\n⏱️  ${iterations}회 측정 중...\n`);
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const result = await dataSource.query(`
        SELECT q.*, c.* 
        FROM questions q
        LEFT JOIN choices_test c ON c.question_id = q.id
        WHERE q.exam_id = $1
      `, [examId]);
      const end = performance.now();
      
      times.push(end - start);
      
      // 진행률 표시
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  ${i + 1}/${iterations} 완료\r`);
      }
      
      // 첫 번째 측정에서 데이터 확인
      if (i === 0) {
        console.log(`  📝 조회된 총 rows: ${result.length}개`);
        console.log('');
      }
    }
    
    console.log('\n');
    
    // 통계 계산
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const sorted = times.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(iterations * 0.5)];
    const p95 = sorted[Math.floor(iterations * 0.95)];
    const p99 = sorted[Math.floor(iterations * 0.99)];
    
    // 결과 출력
    console.log('📊 === JOIN 방식 TypeORM 성능 ===\n');
    console.log(`  평균 (Avg):     ${avg.toFixed(2)}ms`);
    console.log(`  중앙값 (P50):   ${p50.toFixed(2)}ms`);
    console.log(`  P95:            ${p95.toFixed(2)}ms`);
    console.log(`  P99:            ${p99.toFixed(2)}ms`);
    console.log(`  최소 (Min):     ${min.toFixed(2)}ms`);
    console.log(`  최대 (Max):     ${max.toFixed(2)}ms`);
    
    console.log('\n💡 참고:');
    console.log('  - 이 측정은 JOIN 방식의 성능입니다.');
    console.log('  - JSONB 방식과 비교하려면 yarn benchmark도 실행하세요.\n');
    
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
  } finally {
    await app.close();
  }
}

benchmark();
