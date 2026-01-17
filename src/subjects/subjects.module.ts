import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subject } from './entities/subject.entity';
import { Exam } from 'src/exams/entities/exam.entity';


@Module({
  imports: [TypeOrmModule.forFeature([Subject,Exam])],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports:[SubjectsService]
})
export class SubjectsModule {}
