import { Module } from '@nestjs/common';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';
import { SubjectsModule } from 'src/subjects/subjects.module';

@Module({
  imports: [SubjectsModule],
  controllers: [ExamsController],
  providers: [ExamsService],
  exports: [ExamsService]
})
export class ExamsModule {}
