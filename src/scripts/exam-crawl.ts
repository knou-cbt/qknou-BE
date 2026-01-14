import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ExamsService } from '../exams/exams.service';

// 한국 시간대 설정
process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  // 명령줄 인자 파싱
  const url = process.argv[2];
  const forceRetry = process.argv.includes('--retry') || process.argv.includes('-r');

  if (!url) {
    console.error('❌ 사용법: npm run crawl <URL> [--retry]');
    console.error('예시: npm run crawl https://allaclass.tistory.com/855');
    console.error('     npm run crawl https://allaclass.tistory.com/855 --retry  (부분 저장된 경우 재시도)');
    process.exit(1);
  }

  // NestJS 애플리케이션 컨텍스트 생성 (서버는 띄우지 않음)
  console.log('🚀 NestJS 애플리케이션 초기화 중...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    console.log(`🔍 크롤링 시작: ${url}`);
    if (forceRetry) {
      console.log('⚠️ --retry 옵션 활성화: 부분 저장된 데이터가 있으면 삭제하고 다시 시도합니다.');
    }
    console.log('');

    // ExamsService를 DI 컨테이너에서 가져오기
    const examsService = app.get(ExamsService);

    // 크롤링 실행
    const result = await examsService.saveExamFromUrl(url, forceRetry);

    console.log('');
    console.log('✅ 크롤링 완료!');
    console.log(`   - 시험 ID: ${result.examId}`);
    console.log(`   - 제목: ${result.title}`);
    console.log(`   - 문제 수: ${result.questionCount}`);
  } catch (error: any) {
    console.log('');
    console.error('❌ 크롤링 실패:', error.message);
    if (error.message.includes('부분적으로 저장된')) {
      console.error('');
      console.error('💡 해결 방법: --retry 옵션을 사용하여 다시 시도하세요.');
      console.error('   예시: npm run crawl ' + url + ' --retry');
    }
    process.exit(1);
  } finally {
    // NestJS 앱 종료 (TypeORM 연결도 자동으로 닫힘)
    await app.close();
  }
}

bootstrap();
