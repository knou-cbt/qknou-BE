import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Feedback, FeedbackType } from './entities/feedback.entity';

/** 피드백 유형 → 파일 제목/이름에 쓰는 한글 라벨 */
const LABELS: Record<FeedbackType, string> = {
  question_bug: '문항-버그',
  site_bug: '사이트-버그',
  suggestion: '기능-제안',
  other: '기타',
};

type FeedbackForFile = Pick<
  Feedback,
  | 'id'
  | 'user_id'
  | 'type'
  | 'content'
  | 'question_id'
  | 'page_url'
  | 'created_at'
>;

/**
 * 사용자가 적은 원문은 코드 블록으로 감싸서 GitHub 화면에서 마크다운/HTML로
 * 해석되지 않게 한다. 원문에 ```가 있으면 더 긴 펜스를 쓴다.
 */
function fenceUserContent(content: string): string {
  const fence = content.includes('```') ? '````' : '```';
  return `${fence}\n${content}\n${fence}`;
}

/** 한국시간 기준 YYYY-MM-DD */
function kstDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(
    date,
  );
}

/**
 * 피드백 1건을 GitHub 저장소에 md 파일 1개로 커밋한다 (Contents API).
 * 경로는 feedback/<YYYY-MM>/<YYYY-MM-DD>-<id>-<type>.md 로 피드백 id가
 * 들어가므로 동시에 들어와도 파일이 겹치지 않는다.
 * 토큰 권한: 해당 저장소 Contents: Read and write.
 */
@Injectable()
export class GithubFeedbackFilesService {
  private readonly logger = new Logger(GithubFeedbackFilesService.name);

  constructor(private configService: ConfigService) {}

  /**
   * md 파일 생성. 실패해도 throw하지 않고 null 반환
   * (피드백 접수 자체가 GitHub 장애 때문에 실패하면 안 되므로)
   */
  async createFile(feedback: FeedbackForFile): Promise<{ url: string } | null> {
    const owner = this.configService.get('GITHUB_OWNER');
    const repo = this.configService.get('GITHUB_REPO');
    const branch = this.configService.get('GITHUB_BRANCH');
    const path = this.buildPath(feedback);

    try {
      const res = await axios.put(
        `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
        {
          message: `feedback: #${feedback.id} ${feedback.type}`,
          content: Buffer.from(this.buildMarkdown(feedback), 'utf8').toString(
            'base64',
          ),
          ...(branch ? { branch } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${this.configService.get('GITHUB_TOKEN')}`,
            Accept: 'application/vnd.github+json',
          },
          timeout: 5000,
        },
      );
      return { url: res.data.content.html_url };
    } catch (error: any) {
      this.logger.error(
        'GitHub 피드백 파일 생성 실패',
        error?.response?.data ?? error?.message ?? error,
      );
      return null;
    }
  }

  buildPath(feedback: Pick<Feedback, 'id' | 'type' | 'created_at'>): string {
    const date = kstDate(feedback.created_at ?? new Date());
    return `feedback/${date.slice(0, 7)}/${date}-${feedback.id}-${feedback.type}.md`;
  }

  /**
   * 제보자는 이메일이 아닌 내부 userId로만 표시한다. 실제 신원 확인이
   * 필요하면 관리자가 DB에서 userId로 조회한다 (private 저장소여도
   * 이메일 같은 PII를 외부 서비스에 그대로 보관하지 않기 위함).
   * frontmatter 값은 JSON 문자열로 넣어 줄바꿈 등이 섞여도 YAML이 깨지지 않게 한다.
   */
  buildMarkdown(feedback: FeedbackForFile): string {
    const label = LABELS[feedback.type] ?? LABELS.other;
    const title = feedback.question_id
      ? `[${label}] 문항 #${feedback.question_id}`
      : `[${label}] 피드백 #${feedback.id}`;

    return [
      '---',
      `id: ${feedback.id}`,
      `type: ${feedback.type}`,
      `reporter_id: ${JSON.stringify(feedback.user_id)}`,
      feedback.question_id ? `question_id: ${feedback.question_id}` : null,
      feedback.page_url
        ? `page_url: ${JSON.stringify(feedback.page_url)}`
        : null,
      `created_at: ${(feedback.created_at ?? new Date()).toISOString()}`,
      '---',
      '',
      `# ${title}`,
      '',
      fenceUserContent(feedback.content),
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }
}
