import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Questsion } from '../questions/entities/question.entity';
import { Repository } from 'typeorm';

process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const questionId = parseInt(process.argv[2]);
  if (!questionId) {
    console.error('사용법: yarn ts-node src/scripts/clear-explanation.ts <question_id>');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const questionRepo = app.get<Repository<Questsion>>(getRepositoryToken(Questsion));
    await questionRepo.update(questionId, { explanation: null as any, concept_tags: [] });
    console.log(`✅ 문제 ID ${questionId} 해설 삭제 완료`);
  } catch (error: any) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
