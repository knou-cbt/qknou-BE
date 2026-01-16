import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { SubjectsModule } from 'src/subjects/subjects.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exam } from './entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Exam, Questsion]),SubjectsModule
  ],
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService]
})
export class ExamsModule {}
