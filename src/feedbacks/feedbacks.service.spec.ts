import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { FeedbacksService } from './feedbacks.service';
import { Feedback } from './entities/feedback.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { GithubFeedbackFilesService } from './github-feedback-files.service';
import { DiscordNotifyService } from 'src/notifications/discord-notify.service';

describe('FeedbacksService', () => {
  let service: FeedbacksService;
  let feedbackRepository: { create: jest.Mock; save: jest.Mock };
  let questionRepository: { findOne: jest.Mock };
  let githubFeedbackFilesService: { createFile: jest.Mock };
  let discordNotifyService: { notify: jest.Mock };

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
    };
    questionRepository = { findOne: jest.fn() };
    githubFeedbackFilesService = { createFile: jest.fn() };
    discordNotifyService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbacksService,
        { provide: getRepositoryToken(Feedback), useValue: feedbackRepository },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        {
          provide: GithubFeedbackFilesService,
          useValue: githubFeedbackFilesService,
        },
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
    expect(githubFeedbackFilesService.createFile).not.toHaveBeenCalled();
  });

  it('md 파일을 만들고 URL을 저장한 뒤 Discord로 알린다 (created)', async () => {
    questionRepository.findOne.mockResolvedValue({ id: 101 });
    githubFeedbackFilesService.createFile.mockResolvedValue({
      url: 'https://github.com/x/y/blob/main/feedback/2026-11/2026-11-01-1-question_bug.md',
    });

    const result = await service.submit('user-1', {
      type: 'question_bug',
      content: '3번 오류',
      questionId: 101,
    } as any);

    expect(result.integrationStatus).toBe('created');
    expect(result.githubIssueUrl).toContain('/feedback/2026-11/');
    expect(githubFeedbackFilesService.createFile).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, question_id: 101 }),
    );
    expect(feedbackRepository.save).toHaveBeenCalledTimes(2);
    expect(discordNotifyService.notify).toHaveBeenCalledTimes(1);
  });

  it('GitHub 연동이 실패하면 failed, DB 저장은 그대로 성공한다', async () => {
    githubFeedbackFilesService.createFile.mockResolvedValue(null);

    const result = await service.submit('user-1', {
      type: 'other',
      content: '기타 의견',
    } as any);

    expect(result.integrationStatus).toBe('failed');
    expect(result.githubIssueUrl).toBeNull();
    expect(result.id).toBeDefined();
    expect(feedbackRepository.save).toHaveBeenCalledTimes(1);
    expect(discordNotifyService.notify).not.toHaveBeenCalled();
  });
});
