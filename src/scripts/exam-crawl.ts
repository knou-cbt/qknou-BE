import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CrawlerService } from '../crawlers/crawler.service';

process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const args = process.argv.slice(2);
  const url = args[0];
  const mode = args.includes('--all') ? 'all' : 'single';
  const forceRetry = args.includes('--retry') || args.includes('-r');
  const delayArg = args.find(arg => arg.startsWith('--delay='));
  const delay = delayArg ? parseInt(delayArg.split('=')[1]) : 1000;
  
  if (!url) {
    console.error('사용법:');
    console.error('  단일 크롤링: yarn crawl <URL> [--retry]');
    console.error('  전체 크롤링: yarn crawl <메인URL> --all [--retry] [--delay=1000]');
    console.error('');
    console.error('예시:');
    console.error('  yarn crawl https://allaclass.tistory.com/855');
    console.error('  yarn crawl https://allaclass.tistory.com/2365 --all --delay=2000');
    process.exit(1);
  }

  console.log('NestJS 애플리케이션 초기화 중...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const crawler = app.get(CrawlerService);

    if (mode === 'all') {
      console.log(`🔍 전체 크롤링 시작: ${url}`);
      console.log(`⏱️  딜레이: ${delay}ms`);
      if (forceRetry) {
        console.log('⚠️  --retry 활성화');
      }
      console.log('');
      
      await crawler.crawlAll(url, { forceRetry, delay });
    } else {
      console.log(`🔍 단일 크롤링 시작: ${url}`);
      if (forceRetry) {
        console.log('⚠️  --retry 활성화');
      }
      console.log('');
      
      const result = await crawler.crawlExam(url, forceRetry);
      
      console.log('');
      console.log('✅ 크롤링 완료!');
      console.log(`   - 시험 ID: ${result.examId}`);
      console.log(`   - 제목: ${result.title}`);
      console.log(`   - 저장된 문제 수: ${result.questionCount}`);
      if (result.totalQuestions) {
        console.log(`   - 전체 문제 수: ${result.totalQuestions}`);
      }
      if (result.skippedQuestions && result.skippedQuestions.length > 0) {
        console.log('');
        console.log('⚠️  건너뛴 문제:');
        console.log(`   - 개수: ${result.skippedQuestions.length}개`);
        console.log(`   - 문제 번호: ${result.skippedQuestions.join(', ')}`);
        console.log('   💡 정답표와 문제 번호가 일치하지 않을 수 있습니다. 수동 확인이 필요합니다.');
      }
    }
  } catch (error: any) {
    console.log('');
    console.error('❌ 크롤링 실패:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();