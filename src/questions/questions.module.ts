import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Questsion } from './entities/question.entity';
import { BookmarksModule } from 'src/bookmarks/bookmarks.module';

@Module({
  imports: [TypeOrmModule.forFeature([Questsion]), BookmarksModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
