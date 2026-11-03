import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { GithubFeedbackFilesService } from './github-feedback-files.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GithubFeedbackFilesService', () => {
  const env: Record<string, string | undefined> = {
    GITHUB_TOKEN: 'token',
    GITHUB_OWNER: 'owner',
    GITHUB_REPO: 'feedback-repo',
  };
  const service = new GithubFeedbackFilesService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);

  // 2026-10-31T16:30Z = 한국시간 11/01 01:30
  const feedback = {
    id: 7,
    user_id: 'user-uuid',
    type: 'question_bug' as const,
    content: '정답이 ```3번``` 이에요\n@someone',
    question_id: 101,
    page_url: 'https://www.qknou.kr/exams/1\nx: y',
    created_at: new Date('2026-10-31T16:30:00Z'),
  };

  beforeEach(() => jest.resetAllMocks());

  it('경로는 한국시간 날짜 + 피드백 id', () => {
    expect(service.buildPath(feedback)).toBe(
      'feedback/2026-11/2026-11-01-7-question_bug.md',
    );
  });

  it('원문은 더 긴 펜스로 감싸고 frontmatter 값은 JSON 문자열로 넣는다', () => {
    const md = service.buildMarkdown(feedback);

    expect(md).toContain('````\n정답이 ```3번``` 이에요\n@someone\n````');
    expect(md).toContain('page_url: "https://www.qknou.kr/exams/1\\nx: y"');
    expect(md).toContain('reporter_id: "user-uuid"');
    expect(md).toContain('# [문항-버그] 문항 #101');
  });

  it('Contents API로 base64 파일을 PUT하고 html_url을 돌려준다', async () => {
    mockedAxios.put.mockResolvedValue({
      data: {
        content: {
          html_url: 'https://github.com/owner/feedback-repo/blob/main/x.md',
        },
      },
    });

    const result = await service.createFile(feedback);

    expect(result).toEqual({
      url: 'https://github.com/owner/feedback-repo/blob/main/x.md',
    });
    const [url, body, config] = mockedAxios.put.mock.calls[0] as any[];
    expect(url).toBe(
      'https://api.github.com/repos/owner/feedback-repo/contents/feedback/2026-11/2026-11-01-7-question_bug.md',
    );
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(
      service.buildMarkdown(feedback),
    );
    expect(body.branch).toBeUndefined();
    expect(config.headers.Authorization).toBe('Bearer token');
  });

  it('GitHub 오류는 삼키고 null', async () => {
    mockedAxios.put.mockRejectedValue(new Error('404'));
    await expect(service.createFile(feedback)).resolves.toBeNull();
  });
});
