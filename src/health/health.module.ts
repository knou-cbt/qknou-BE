import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ExamsModule } from '../exams/exams.module';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({
  imports: [ExamsModule, SubjectsModule],
  controllers: [HealthController],
})
export class HealthModule {}
