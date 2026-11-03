import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { GithubFeedbackFilesService } from './github-feedback-files.service';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

export type IntegrationStatus = 'created' | 'failed';

@Injectable()
export class FeedbacksService {
  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    private githubFeedbackFilesService: GithubFeedbackFilesService,
    private discordNotifyService: DiscordNotifyService,
  ) {}

  async submit(userId: string, dto: CreateFeedbackDto) {
    if (dto.questionId) {
      const question = await this.questionRepository.findOne({
        where: { id: dto.questionId },
      });
      if (!question) {
        throw new NotFoundException(
          `문항 id ${dto.questionId}를 찾을 수 없습니다.`,
        );
      }
    }

    const feedback = this.feedbackRepository.create({
      user_id: userId,
      type: dto.type,
      content: dto.content,
      question_id: dto.questionId ?? null,
      page_url: dto.pageUrl ?? null,
    });
    await this.feedbackRepository.save(feedback);

    // GitHub 저장소에 md 파일로 커밋. 실패해도 접수는 성공으로 처리한다.
    const file = await this.githubFeedbackFilesService.createFile(feedback);
    const status: IntegrationStatus = file ? 'created' : 'failed';

    if (file) {
      // 컬럼 이름은 이슈 연동 시절 그대로 두고 md 파일 URL을 저장한다.
      feedback.github_issue_url = file.url;
      await this.feedbackRepository.save(feedback);

      await this.discordNotifyService.notify(
        `🆕 새 피드백 (${feedback.type})\n${file.url}`,
      );
    }

    return {
      id: feedback.id,
      type: feedback.type,
      githubIssueUrl: feedback.github_issue_url,
      integrationStatus: status,
      createdAt: feedback.created_at,
    };
  }
}
