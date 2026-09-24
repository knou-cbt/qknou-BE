import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamSubmissionsController } from './exam-submissions.controller';
import { ExamSubmissionsService } from './exam-submissions.service';
import { ExamSubmission } from './entities/exam-submission.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExamSubmission, Exam, Questsion]),
    StorageModule,
  ],
  controllers: [ExamSubmissionsController],
  providers: [ExamSubmissionsService],
})
export class ExamSubmissionsModule {}
