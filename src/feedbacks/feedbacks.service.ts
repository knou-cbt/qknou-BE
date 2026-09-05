import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { GithubIssuesService } from './github-issues.service';
import { DiscordNotifyService } from './discord-notify.service';

@Injectable()
export class FeedbacksService {
  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    private githubIssuesService: GithubIssuesService,
    private discordNotifyService: DiscordNotifyService,
  ) {}

  async submit(userId: string, userEmail: string, dto: CreateFeedbackDto) {
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

    const { issueNumber, issueUrl, isNewIssue } = await this.linkGithubIssue(
      feedback,
      userEmail,
    );

    if (issueNumber && issueUrl) {
      feedback.github_issue_number = issueNumber;
      feedback.github_issue_url = issueUrl;
      await this.feedbackRepository.save(feedback);

      await this.discordNotifyService.notify(
        this.buildDiscordMessage(feedback, issueUrl, isNewIssue),
      );
    }

    return {
      id: feedback.id,
      type: feedback.type,
      githubIssueUrl: feedback.github_issue_url,
      isNewIssue,
      createdAt: feedback.created_at,
    };
  }

  /**
   * GitHub Issue 연결. 같은 문항에 대해 이미 열려있는 이슈가 있으면
   * 새로 만들지 않고 댓글로 합친다. GitHub 쪽 장애가 나도 여기서 삼키고
   * null을 반환해 피드백 접수 자체는 항상 성공하도록 한다.
   */
  private async linkGithubIssue(
    feedback: Feedback,
    userEmail: string,
  ): Promise<{
    issueNumber: number | null;
    issueUrl: string | null;
    isNewIssue: boolean;
  }> {
    try {
      if (feedback.type === 'question_bug' && feedback.question_id) {
        const previous = await this.feedbackRepository
          .createQueryBuilder('f')
          .where('f.question_id = :qid', { qid: feedback.question_id })
          .andWhere('f.id != :id', { id: feedback.id })
          .andWhere('f.github_issue_number IS NOT NULL')
          .orderBy('f.created_at', 'DESC')
          .getOne();

        if (previous?.github_issue_number && previous.github_issue_url) {
          const state = await this.githubIssuesService.getIssueState(
            previous.github_issue_number,
          );
          if (state === 'open') {
            const commented = await this.githubIssuesService.addComment(
              previous.github_issue_number,
              this.githubIssuesService.buildCommentBody(feedback, userEmail),
            );
            if (commented) {
              return {
                issueNumber: previous.github_issue_number,
                issueUrl: previous.github_issue_url,
                isNewIssue: false,
              };
            }
          }
        }
      }

      const created = await this.githubIssuesService.createIssue(
        feedback,
        userEmail,
      );
      if (created) {
        return {
          issueNumber: created.number,
          issueUrl: created.url,
          isNewIssue: true,
        };
      }
      return { issueNumber: null, issueUrl: null, isNewIssue: false };
    } catch {
      return { issueNumber: null, issueUrl: null, isNewIssue: false };
    }
  }

  private buildDiscordMessage(
    feedback: Feedback,
    issueUrl: string,
    isNewIssue: boolean,
  ): string {
    const prefix = isNewIssue ? '🆕 새 피드백' : '➕ 기존 이슈에 추가 제보';
    return `${prefix} (${feedback.type})\n${issueUrl}`;
  }
}
