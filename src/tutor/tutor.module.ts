import { Module } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { TutorController } from './tutor.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Term } from './entities/term.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { UserChatLimit } from './entities/chat-limit.entity';
import { LlmModule } from 'src/llm/llm.module';
import { LlmSettingsModule } from 'src/llm-settings/llm-settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Questsion, Term, Exam, UserChatLimit]),
    LlmModule,
    LlmSettingsModule,
  ],
  controllers: [TutorController],
  providers: [TutorService],
  exports: [TutorService],
})
export class TutorModule {}
