import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { Questsion } from '../questions/entities/question.entity';

async function bootstrap() {
  console.log('NestJS 애플리케이션 초기화 중...');
  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const dataSource = app.get(DataSource);

    console.log('데이터베이스에서 이미지가 포함된 문제들을 검색하는 중...');

    const publicDomain = process.env.R2_PUBLIC_DOMAIN;
    if (!publicDomain)
      throw new Error('R2_PUBLIC_DOMAIN 환경변수가 설정되지 않았습니다.');

    const questions = await dataSource.getRepository(Questsion).find({
      relations: ['exam', 'exam.subject'],
    });

    // 이미지가 외부(R2 아님) 링크인 문제들의 시험 ID 수집
    const targetExamIds = new Set<number>();

    for (const q of questions) {
      // 문제에 이미지가 있고 R2 링크가 아닌 경우
      if (
        q.question_image_urls &&
        q.question_image_urls.some((url) => !url.includes(publicDomain))
      ) {
        targetExamIds.add(q.exam_id);
      }
      // 보기에 이미지가 있고 R2 링크가 아닌 경우
      else if (q.choices && Array.isArray(q.choices)) {
        const hasExternalChoiceImage = q.choices.some(
          (c) =>
            c.imageUrls &&
            c.imageUrls.some((url) => !url.includes(publicDomain)),
        );
        if (hasExternalChoiceImage) {
          targetExamIds.add(q.exam_id);
        }
      }
    }

    if (targetExamIds.size === 0) {
      console.log(
        '🎉 재크롤링이 필요한 시험(이미지가 포함된 시험)이 없습니다!',
      );
      return;
    }

    console.log('');
    console.log(
      `⚠️  총 ${targetExamIds.size}개의 시험(exam_id)에 만료된 이미지 링크가 포함되어 있습니다.`,
    );
    console.log(
      `   아래의 시험 ID들을 사용하여 사이트에서 다시 '--retry' 옵션으로 크롤링해야 합니다.\n`,
    );

    // 해당 시험 정보 자세히 출력 (제목 등등)
    for (const examId of targetExamIds) {
      const firstQuestionOfExam = questions.find((q) => q.exam_id === examId);
      const exam = firstQuestionOfExam?.exam;
      const subjectName = (exam as any)?.subject?.name || 'unknown';

      console.log(
        `- 시험 ID: ${examId} | 과목: ${subjectName} | 제목: ${exam?.title || '알 수 없음'} | 연도: ${exam?.year}`,
      );
    }

    console.log('');
    console.log('💡 안내:');
    console.log(
      '이 시험들만 실제 Tistory 웹사이트 URL을 찾아 다음과 같이 명령어를 실행하세요:',
    );
    console.log(
      'yarn crawl <https://allaclass.tistory.com/포스팅번호> --retry',
    );
  } catch (error: any) {
    console.log('');
    console.error('❌ 검색 중 에러 발생:', error.message);
  } finally {
    await app.close();
  }
}

bootstrap();
