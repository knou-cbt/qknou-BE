import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { GithubIssuesService } from './github-issues.service';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

export type IntegrationStatus = 'created' | 'merged' | 'failed';

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

    const { issueNumber, issueUrl, status } =
      await this.linkGithubIssue(feedback);

    if (issueNumber && issueUrl) {
      feedback.github_issue_number = issueNumber;
      feedback.github_issue_url = issueUrl;
      await this.feedbackRepository.save(feedback);

      await this.discordNotifyService.notify(
        this.buildDiscordMessage(feedback, issueUrl, status),
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

  /**
   * GitHub Issue 연결. 같은 문항에 대해 이미 열려있는 이슈가 있으면
   * 새로 만들지 않고 댓글로 합친다. GitHub 쪽 장애가 나도 여기서 삼키고
   * status: 'failed'를 반환해 피드백 접수 자체는 항상 성공하도록 한다.
   *
   * 알려진 한계: 같은 문항에 대한 두 제보가 동시에 들어오면 "기존 열린
   * 이슈 조회"가 서로를 못 보고 이슈가 중복 생성될 수 있다. 이 경합은
   * DB 트랜잭션만으로 막기 어렵고(외부 HTTP 호출을 트랜잭션 안에 넣게
   * 되므로), 이슈 하나가 중복 생성되는 정도의 낮은 빈도/낮은 피해로 보고
   * 지금은 허용한다.
   */
  private async linkGithubIssue(feedback: Feedback): Promise<{
    issueNumber: number | null;
    issueUrl: string | null;
    status: IntegrationStatus;
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
              this.githubIssuesService.buildCommentBody(
                feedback,
                feedback.user_id,
              ),
            );
            if (commented) {
              return {
                issueNumber: previous.github_issue_number,
                issueUrl: previous.github_issue_url,
                status: 'merged',
              };
            }
          }
        }
      }

      const created = await this.githubIssuesService.createIssue(
        feedback,
        feedback.user_id,
      );
      if (created) {
        return {
          issueNumber: created.number,
          issueUrl: created.url,
          status: 'created',
        };
      }
      return { issueNumber: null, issueUrl: null, status: 'failed' };
    } catch {
      return { issueNumber: null, issueUrl: null, status: 'failed' };
    }
  }

  private buildDiscordMessage(
    feedback: Feedback,
    issueUrl: string,
    status: IntegrationStatus,
  ): string {
    const prefix =
      status === 'created' ? '🆕 새 피드백' : '➕ 기존 이슈에 추가 제보';
    return `${prefix} (${feedback.type})\n${issueUrl}`;
  }
}
