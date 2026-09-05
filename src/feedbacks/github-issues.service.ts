import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Feedback, FeedbackType } from './entities/feedback.entity';

/** 피드백 유형 → GitHub 라벨 매핑. 레포에 미리 만들어둬야 함(없으면 422 에러). */
const LABELS: Record<FeedbackType, string> = {
  question_bug: '문항-버그',
  site_bug: '사이트-버그',
  suggestion: '기능-제안',
  other: '기타',
};

type FeedbackForIssue = Pick<
  Feedback,
  'type' | 'content' | 'question_id' | 'page_url'
>;

@Injectable()
export class GithubIssuesService {
  private readonly logger = new Logger(GithubIssuesService.name);

  constructor(private configService: ConfigService) {}

  private get baseUrl(): string {
    const owner = this.configService.get('GITHUB_OWNER');
    const repo = this.configService.get('GITHUB_REPO');
    return `https://api.github.com/repos/${owner}/${repo}`;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.configService.get('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
    };
  }

  /**
   * 새 GitHub Issue 생성. 실패해도 throw하지 않고 null 반환
   * (피드백 접수 자체가 GitHub 장애 때문에 실패하면 안 되므로)
   */
  async createIssue(
    feedback: FeedbackForIssue,
    userEmail: string,
  ): Promise<{ number: number; url: string } | null> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/issues`,
        {
          title: this.buildTitle(feedback),
          body: this.buildBody(feedback, userEmail),
          labels: [LABELS[feedback.type] ?? LABELS.other],
        },
        { headers: this.headers, timeout: 5000 },
      );
      return { number: res.data.number, url: res.data.html_url };
    } catch (error: any) {
      this.logger.error(
        'GitHub Issue 생성 실패',
        error?.response?.data ?? error?.message ?? error,
      );
      return null;
    }
  }

  /**
   * 이슈의 현재 open/closed 상태 조회. 실패하면 null (판단 불가로 취급)
   */
  async getIssueState(issueNumber: number): Promise<'open' | 'closed' | null> {
    try {
      const res = await axios.get(`${this.baseUrl}/issues/${issueNumber}`, {
        headers: this.headers,
        timeout: 5000,
      });
      return res.data.state;
    } catch (error: any) {
      this.logger.error(
        'GitHub Issue 상태 조회 실패',
        error?.response?.data ?? error?.message ?? error,
      );
      return null;
    }
  }

  /**
   * 기존 이슈에 댓글 추가 (동일 문항 중복 제보 병합용)
   */
  async addComment(issueNumber: number, body: string): Promise<boolean> {
    try {
      await axios.post(
        `${this.baseUrl}/issues/${issueNumber}/comments`,
        { body },
        { headers: this.headers, timeout: 5000 },
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        'GitHub Issue 댓글 추가 실패',
        error?.response?.data ?? error?.message ?? error,
      );
      return false;
    }
  }

  private buildTitle(feedback: Pick<Feedback, 'type' | 'question_id'>): string {
    const typeLabel = LABELS[feedback.type] ?? LABELS.other;
    return feedback.question_id
      ? `[${typeLabel}] 문항 #${feedback.question_id}`
      : `[${typeLabel}] 피드백`;
  }

  private buildBody(feedback: FeedbackForIssue, userEmail: string): string {
    return [
      `**제보자**: ${userEmail}`,
      feedback.question_id ? `**문항 ID**: ${feedback.question_id}` : null,
      feedback.page_url ? `**페이지**: ${feedback.page_url}` : null,
      '',
      feedback.content,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  /**
   * 동일 문항 중복 제보를 기존 이슈에 합칠 때 다는 댓글 본문.
   * 신고자마다 의견/지적 내용이 다를 수 있으니 원문 content를 반드시 그대로 포함한다.
   */
  buildCommentBody(feedback: FeedbackForIssue, userEmail: string): string {
    return [
      `**추가 제보** (${new Date().toISOString()})`,
      `- 제보자: ${userEmail}`,
      `- 내용: ${feedback.content}`,
      feedback.page_url ? `- 페이지: ${feedback.page_url}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
