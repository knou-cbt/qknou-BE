import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExamHistoryController } from './exam-history.controller';
import { ExamHistoryService } from './exam-history.service';
import { UserExamAttempt } from './entities/user-exam-attempt.entity';
import { UserExamAnswer } from './entities/user-exam-answer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserExamAttempt, UserExamAnswer])],
  controllers: [ExamHistoryController],
  providers: [ExamHistoryService],
  exports: [ExamHistoryService],
})
export class ExamHistoryModule {}
