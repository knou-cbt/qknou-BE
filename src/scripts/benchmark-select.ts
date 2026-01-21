import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { QuestionsService } from '../questions/questions.service';

async function benchmark() {
  console.log('📊 SELECT 성능 벤치마크 시작...\n');
  
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false // 로그 비활성화
  });

  try {
    const questionsService = app.get(QuestionsService);
    
    // 테스트할 exam_id (첫 번째 시험)
    const examId = 4;
    
    // 웜업 (캐시 워밍)
    console.log('🔥 웜업 중...');
    await questionsService.findByExamId(examId);
    await questionsService.findByExamId(examId);
    await questionsService.findByExamId(examId);
    
    // 실제 측정
    const iterations = 100;
    const times: number[] = [];
    
    console.log(`\n⏱️  ${iterations}회 측정 중...\n`);
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const questions = await questionsService.findByExamId(examId);
      const end = performance.now();
      
      times.push(end - start);
      
      // 진행률 표시
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`  ${i + 1}/${iterations} 완료\r`);
      }
      
      // 첫 번째 측정에서 데이터 확인
      if (i === 0) {
        console.log(`  📝 조회된 문제 수: ${questions.length}개`);
        if (questions.length > 0) {
          console.log(`  📝 선택지 수: ${questions[0].choices?.length || 0}개 (JSONB)`);
        }
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
    console.log('📊 === JSONB 방식 SELECT 성능 ===\n');
    console.log(`  평균 (Avg):     ${avg.toFixed(2)}ms`);
    console.log(`  중앙값 (P50):   ${p50.toFixed(2)}ms`);
    console.log(`  P95:            ${p95.toFixed(2)}ms`);
    console.log(`  P99:            ${p99.toFixed(2)}ms`);
    console.log(`  최소 (Min):     ${min.toFixed(2)}ms`);
    console.log(`  최대 (Max):     ${max.toFixed(2)}ms`);
    
    console.log('\n💡 참고:');
    console.log('  - 이 측정은 JSONB 방식의 성능입니다.');
    console.log('  - 별도 choices 테이블 방식과의 비교는 마이그레이션 전 데이터로만 가능합니다.');
    console.log('  - 데이터가 적으면 차이가 크지 않을 수 있습니다.');
    console.log('  - 실제 차이는 대량 데이터 + 네트워크 레이턴시 환경에서 더 두드러집니다.\n');
    
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    if (error.message.includes('relation') || error.message.includes('does not exist')) {
      console.error('\n💡 힌트: 테이블이 존재하지 않거나 데이터가 없을 수 있습니다.');
      console.error('   먼저 크롤링을 실행하세요: yarn crawl <URL>');
    }
  } finally {
    await app.close();
  }
}

benchmark();
