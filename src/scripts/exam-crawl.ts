import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CrawlerService } from '../crawlers/crawler.service';

process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const args = process.argv.slice(2);
  const url = args[0];
  const mode = args.includes('--all') ? 'all' : 'single';
  const forceRetry = args.includes('--retry') || args.includes('-r');
  const skipAnswers = args.includes('--no-answers');
  const delayArg = args.find((arg) => arg.startsWith('--delay='));
  const delay = delayArg ? parseInt(delayArg.split('=')[1]) : 1000;
  const startArg = args.find((arg) => arg.startsWith('--start='));
  const startIndex = startArg ? parseInt(startArg.split('=')[1]) : 0;
  const gradeArg = args.find((arg) => arg.startsWith('--grade='));
  const grade = gradeArg ? gradeArg.split('=')[1] : undefined;

  if (!url) {
    console.error('사용법:');
    console.error('  단일 크롤링: yarn crawl <URL> [--retry] [--no-answers]');
    console.error(
      '  전체 크롤링: yarn crawl <메인URL> --all [--retry] [--no-answers] [--delay=1000] [--start=0]',
    );
    console.error('');
    console.error('예시:');
    console.error('  yarn crawl https://allaclass.tistory.com/855');
    console.error(
      '  yarn crawl https://allaclass.tistory.com/855 --no-answers  # 정답 저장 생략',
    );
    console.error(
      '  yarn crawl https://allaclass.tistory.com/2365 --all --delay=2000',
    );
    console.error(
      '  yarn crawl https://allaclass.tistory.com/2365 --all --retry --start=50  # 50번째 과목부터 시작',
    );
    process.exit(1);
  }

  console.log('NestJS 애플리케이션 초기화 중...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const crawler = app.get(CrawlerService);

    if (mode === 'all') {
      console.log(`🔍 전체 크롤링 시작: ${url}`);
      console.log(`⏱️  딜레이: ${delay}ms`);
      if (forceRetry) console.log('⚠️  --retry 활성화');
      if (skipAnswers) console.log('📭 --no-answers: 정답 저장 생략');
      if (startIndex > 0) {
        console.log(`📍 시작 인덱스: ${startIndex}번째 과목부터`);
      }
      console.log('');

      if (grade) console.log(`📝 --grade: 시험 title에 "${grade}" 표시`);
      await crawler.crawlAll(url, {
        forceRetry,
        delay,
        startIndex,
        skipAnswers,
        grade,
      });
    } else {
      console.log(`🔍 단일 크롤링 시작: ${url}`);
      if (forceRetry) console.log('⚠️  --retry 활성화');
      if (skipAnswers) console.log('📭 --no-answers: 정답 저장 생략');
      if (grade) console.log(`📝 --grade: 과목명 → "${grade}"`);
      console.log('');

      const result = await crawler.crawlExam(
        url,
        forceRetry,
        skipAnswers,
        grade,
      );

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
        console.log(
          '   💡 정답표와 문제 번호가 일치하지 않을 수 있습니다. 수동 확인이 필요합니다.',
        );
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
