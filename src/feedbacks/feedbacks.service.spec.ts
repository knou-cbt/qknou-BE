import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { FeedbacksService } from './feedbacks.service';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { GithubIssuesService } from './github-issues.service';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

describe('FeedbacksService', () => {
  let service: FeedbacksService;
  let feedbackRepository: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let questionRepository: { findOne: jest.Mock };
  let githubIssuesService: {
    createIssue: jest.Mock;
    getIssueState: jest.Mock;
    addComment: jest.Mock;
    buildCommentBody: jest.Mock;
  };
  let discordNotifyService: { notify: jest.Mock };

  function mockPreviousLookup(previous: any) {
    feedbackRepository.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(previous),
    });
  }

  beforeEach(async () => {
    feedbackRepository = {
      create: jest.fn((data) => ({
        id: 1,
        created_at: new Date(),
        github_issue_number: null,
        github_issue_url: null,
        ...data,
      })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };
    questionRepository = { findOne: jest.fn() };
    githubIssuesService = {
      createIssue: jest.fn(),
      getIssueState: jest.fn(),
      addComment: jest.fn(),
      buildCommentBody: jest.fn().mockReturnValue('comment body'),
    };
    discordNotifyService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbacksService,
        { provide: getRepositoryToken(Feedback), useValue: feedbackRepository },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        { provide: GithubIssuesService, useValue: githubIssuesService },
        { provide: DiscordNotifyService, useValue: discordNotifyService },
      ],
    }).compile();

    service = module.get(FeedbacksService);
  });

  it('questionId가 있는데 문항이 없으면 NotFoundException', async () => {
    questionRepository.findOne.mockResolvedValue(null);

    await expect(
      service.submit('user-1', {
        type: 'question_bug',
        content: '내용',
        questionId: 999,
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('site_bug처럼 문항 무관 피드백은 바로 새 이슈를 생성한다 (created)', async () => {
    githubIssuesService.createIssue.mockResolvedValue({
      number: 1,
      url: 'https://github.com/x/y/issues/1',
    });

    const result = await service.submit('user-1', {
      type: 'site_bug',
      content: '사이트가 이상해요',
    } as any);

    expect(result.integrationStatus).toBe('created');
    expect(result.githubIssueUrl).toBe('https://github.com/x/y/issues/1');
    expect(feedbackRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(discordNotifyService.notify).toHaveBeenCalledTimes(1);
  });

  it('동일 문항에 기존 open 이슈가 있으면 새로 만들지 않고 댓글로 병합한다 (merged)', async () => {
    questionRepository.findOne.mockResolvedValue({ id: 101 });
    mockPreviousLookup({
      github_issue_number: 42,
      github_issue_url: 'https://github.com/x/y/issues/42',
    });
    githubIssuesService.getIssueState.mockResolvedValue('open');
    githubIssuesService.addComment.mockResolvedValue(true);

    const result = await service.submit('user-1', {
      type: 'question_bug',
      content: '3번 오류',
      questionId: 101,
    } as any);

    expect(result.integrationStatus).toBe('merged');
    expect(result.githubIssueUrl).toBe('https://github.com/x/y/issues/42');
    expect(githubIssuesService.createIssue).not.toHaveBeenCalled();
    expect(discordNotifyService.notify).toHaveBeenCalledTimes(1);
  });

  it('기존 이슈가 닫혀있으면 새 이슈를 만든다 (created)', async () => {
    questionRepository.findOne.mockResolvedValue({ id: 101 });
    mockPreviousLookup({
      github_issue_number: 42,
      github_issue_url: 'https://github.com/x/y/issues/42',
    });
    githubIssuesService.getIssueState.mockResolvedValue('closed');
    githubIssuesService.createIssue.mockResolvedValue({
      number: 99,
      url: 'https://github.com/x/y/issues/99',
    });

    const result = await service.submit('user-1', {
      type: 'question_bug',
      content: '또 다른 오류',
      questionId: 101,
    } as any);

    expect(result.integrationStatus).toBe('created');
    expect(result.githubIssueUrl).toBe('https://github.com/x/y/issues/99');
    expect(githubIssuesService.addComment).not.toHaveBeenCalled();
  });

  it('GitHub 연동이 완전히 실패하면 failed, DB 저장은 그대로 성공한다', async () => {
    githubIssuesService.createIssue.mockResolvedValue(null);

    const result = await service.submit('user-1', {
      type: 'other',
      content: '기타 의견',
    } as any);

    expect(result.integrationStatus).toBe('failed');
    expect(result.githubIssueUrl).toBeNull();
    expect(discordNotifyService.notify).not.toHaveBeenCalled();
  });

  it('GitHub 상태 조회 중 예외가 나도 접수 자체는 실패하지 않고 failed로 처리된다', async () => {
    questionRepository.findOne.mockResolvedValue({ id: 101 });
    feedbackRepository.createQueryBuilder.mockImplementation(() => {
      throw new Error('DB 커넥션 오류');
    });

    const result = await service.submit('user-1', {
      type: 'question_bug',
      content: '오류',
      questionId: 101,
    } as any);

    expect(result.integrationStatus).toBe('failed');
    expect(result.id).toBeDefined();
  });
});
