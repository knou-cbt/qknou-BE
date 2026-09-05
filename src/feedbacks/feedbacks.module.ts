import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeedbacksController } from './feedbacks.controller';
import { FeedbacksService } from './feedbacks.service';
import { GithubIssuesService } from './github-issues.service';
import { DiscordNotifyModule } from 'src/notifications/discord-notify.module';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Feedback, Questsion]),
    DiscordNotifyModule,
  ],
  controllers: [FeedbacksController],
  providers: [FeedbacksService, GithubIssuesService],
})
export class FeedbacksModule {}
