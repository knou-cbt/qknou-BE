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

/**
 * GitHub는 `@사용자명` 멘션이나 마크다운을 그대로 해석하므로, 사용자가
 * 적은 원문을 코드 블록으로 감싸서 멘션 핑/마크다운 인젝션을 막는다.
 */
function fenceUserContent(content: string): string {
  const fence = content.includes('```') ? '````' : '```';
  return `${fence}\n${content}\n${fence}`;
}

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
    reporterId: string,
  ): Promise<{ number: number; url: string } | null> {
    try {
      const res = await axios.post(
        `${this.baseUrl}/issues`,
        {
          title: this.buildTitle(feedback),
          body: this.buildBody(feedback, reporterId),
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

  /**
   * 제보자는 이메일이 아닌 내부 userId로만 표시한다. 실제 신원 확인이
   * 필요하면 관리자가 DB에서 userId로 조회한다 (GitHub는 private 레포여도
   * 이메일 같은 PII를 외부 서비스에 그대로 보관하지 않기 위함).
   */
  private buildBody(feedback: FeedbackForIssue, reporterId: string): string {
    return [
      `**제보자 ID**: ${reporterId}`,
      feedback.question_id ? `**문항 ID**: ${feedback.question_id}` : null,
      feedback.page_url ? `**페이지**: ${feedback.page_url}` : null,
      '',
      fenceUserContent(feedback.content),
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  /**
   * 동일 문항 중복 제보를 기존 이슈에 합칠 때 다는 댓글 본문.
   * 신고자마다 의견/지적 내용이 다를 수 있으니 원문 content를 반드시 그대로 포함한다.
   */
  buildCommentBody(feedback: FeedbackForIssue, reporterId: string): string {
    return [
      `**추가 제보** (${new Date().toISOString()})`,
      `- 제보자 ID: ${reporterId}`,
      `- 내용:\n${fenceUserContent(feedback.content)}`,
      feedback.page_url ? `- 페이지: ${feedback.page_url}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
