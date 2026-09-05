import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TutorService } from '../tutor/tutor.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Questsion } from '../questions/entities/question.entity';
import { Repository } from 'typeorm';

process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const questionId = parseInt(process.argv[2]);
  if (!questionId) {
    console.error(
      '사용법: yarn ts-node src/scripts/regenerate-explanation.ts <question_id>',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const tutorService = app.get(TutorService);
    const questionRepo = app.get<Repository<Questsion>>(
      getRepositoryToken(Questsion),
    );

    const question = await questionRepo.findOne({ where: { id: questionId } });
    if (!question) {
      console.error(`문제 ID ${questionId}를 찾을 수 없습니다.`);
      process.exit(1);
    }

    console.log(`문제 ID: ${question.id}`);
    console.log(`문제: ${question.question_text}`);
    console.log(`정답: ${question.correct_answers}`);
    console.log('');
    console.log('해설 재생성 중...');

    const { explanation, conceptTags } =
      await tutorService.generateExplanation(question);

    console.log('');
    console.log('✅ 해설 재생성 완료!');
    console.log(`해설: ${explanation}`);
    console.log(`태그: ${conceptTags.join(', ')}`);
  } catch (error: any) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
