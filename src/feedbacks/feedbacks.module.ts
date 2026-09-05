import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbacksController } from './feedbacks.controller';
import { FeedbacksService } from './feedbacks.service';
import { GithubIssuesService } from './github-issues.service';
import { DiscordNotifyService } from './discord-notify.service';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Feedback, Questsion])],
  controllers: [FeedbacksController],
  providers: [FeedbacksService, GithubIssuesService, DiscordNotifyService],
})
export class FeedbacksModule {}
