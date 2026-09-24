import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Questsion } from '../questions/entities/question.entity';
import { Exam } from '../exams/entities/exam.entity';
import { Repository } from 'typeorm';

process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const args = process.argv.slice(2);

  // 모드 1: question_id로 단건 삭제
  // 모드 2: --subject "과목명" --year 2013 으로 일괄 삭제
  const subjectIndex = args.indexOf('--subject');
  const yearIndex = args.indexOf('--year');

  const isBulk = subjectIndex !== -1 && yearIndex !== -1;
  const isSingle = !isBulk && args[0] && !isNaN(parseInt(args[0]));

  if (!isBulk && !isSingle) {
    console.error('사용법:');
    console.error(
      '  단건: yarn ts-node src/scripts/clear-explanation.ts <question_id>',
    );
    console.error(
      '  일괄: yarn ts-node src/scripts/clear-explanation.ts --subject "C++ 프로그래밍" --year 2013',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const questionRepo = app.get<Repository<Questsion>>(
      getRepositoryToken(Questsion),
    );

    if (isSingle) {
      const questionId = parseInt(args[0]);
      await questionRepo.update(questionId, {
        explanation: null as any,
        concept_tags: [],
      });
      console.log(`✅ 문제 ID ${questionId} 해설 삭제 완료`);
    } else {
      const subjectName = args[subjectIndex + 1];
      const year = parseInt(args[yearIndex + 1]);

      const examRepo = app.get<Repository<Exam>>(getRepositoryToken(Exam));
      const exams = await examRepo
        .createQueryBuilder('exam')
        .innerJoin('exam.subject', 'subject')
        .where('subject.name ILIKE :name', { name: `%${subjectName}%` })
        .andWhere('exam.year = :year', { year })
        .select(['exam.id', 'exam.title'])
        .getMany();

      if (exams.length === 0) {
        console.error(`❌ "${subjectName}" ${year}년 시험을 찾을 수 없습니다.`);
        process.exit(1);
      }

      for (const exam of exams) {
        const result = await questionRepo
          .createQueryBuilder()
          .update()
          .set({ explanation: null as any, concept_tags: [] })
          .where('exam_id = :examId', { examId: exam.id })
          .execute();
        console.log(
          `✅ [${exam.title}] 문제 ${result.affected}개 해설 삭제 완료`,
        );
      }
    }
  } catch (error: any) {
    console.error('❌ 오류:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
