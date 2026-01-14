import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { Exam } from './entities/exam.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Choice } from 'src/choices/entities/choice.entity';
import { SubjectsModule } from 'src/subjects/subjects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Exam, Questsion, Choice]),
    SubjectsModule
  ],
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService]
})
export class ExamsModule {}
