import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ExamHistoryService } from './exam-history.service';
import { UserExamAttempt } from './entities/user-exam-attempt.entity';
import { UserExamAnswer } from './entities/user-exam-answer.entity';

describe('ExamHistoryService', () => {
  let service: ExamHistoryService;
  let attemptRepository: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let answerRepository: { createQueryBuilder: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    attemptRepository = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
    answerRepository = { createQueryBuilder: jest.fn() };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamHistoryService,
        {
          provide: getRepositoryToken(UserExamAttempt),
          useValue: attemptRepository,
        },
        {
          provide: getRepositoryToken(UserExamAnswer),
          useValue: answerRepository,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ExamHistoryService);
  });

  describe('saveAttempt', () => {
    function mockManagerWithPreviousAttempts(previousAttempts: any[]) {
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(previousAttempts),
      };
      return {
        createQueryBuilder: jest.fn().mockReturnValue(qb),
        delete: jest.fn().mockResolvedValue(undefined),
        create: jest.fn((_entity, data) => data),
        save: jest.fn().mockImplementation((entity) => {
          if (!Array.isArray(entity)) entity.id = 100;
          return Promise.resolve(entity);
        }),
        qb,
      };
    }

    const sampleResult = {
      totalQuestions: 2,
      correctCount: 1,
      results: [
        {
          questionId: 10,
          questionNumber: 1,
          userAnswer: 2,
          correctAnswers: [2],
          isCorrect: true,
        },
        {
          questionId: 11,
          questionNumber: 2,
          userAnswer: 1,
          correctAnswers: [3],
          isCorrect: false,
        },
      ],
    };

    it('같은 과목+연도의 기존 기록이 없으면 삭제 없이 새 기록만 저장한다', async () => {
      const mockManager = mockManagerWithPreviousAttempts([]);
      dataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

      await service.saveAttempt('user-1', 1, 7, 2024, sampleResult);

      expect(mockManager.qb.andWhere).toHaveBeenCalledWith(
        'exam.subject_id = :subjectId',
        { subjectId: 7 },
      );
      expect(mockManager.qb.andWhere).toHaveBeenCalledWith(
        'exam.year = :year',
        { year: 2024 },
      );
      expect(mockManager.delete).not.toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalledTimes(2);
      const answersArg = mockManager.save.mock.calls[1][0];
      expect(answersArg).toHaveLength(2);
    });

    it('같은 과목+연도의 기존 기록이 있으면 지우고 새 기록만 남긴다', async () => {
      const mockManager = mockManagerWithPreviousAttempts([
        { id: 50 },
        { id: 51 },
      ]);
      dataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

      await service.saveAttempt('user-1', 1, 7, 2024, sampleResult);

      expect(mockManager.delete).toHaveBeenCalledWith(
        UserExamAttempt,
        [50, 51],
      );
      expect(mockManager.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('getHistoryForUser', () => {
    function mockQueryBuilder(total: number, items: any[]) {
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(total),
        getRawMany: jest.fn().mockResolvedValue(items),
      };
      qb.clone = jest.fn().mockReturnValue(qb);
      return qb;
    }

    it('검색어 없이 최신순으로 목록을 반환한다', async () => {
      const items = [{ id: 1, examTitle: '데이터베이스 기말고사' }];
      const qb = mockQueryBuilder(3, items);
      attemptRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getHistoryForUser('user-1', {
        page: 1,
        limit: 10,
      });

      expect(result).toEqual({ items, total: 3, page: 1, limit: 10 });
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('검색어가 있으면 시험 제목으로 필터링한다', async () => {
      const qb = mockQueryBuilder(0, []);
      attemptRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getHistoryForUser('user-1', {
        search: '데이터베이스',
        page: 1,
        limit: 10,
      });

      expect(qb.andWhere).toHaveBeenCalledWith('exam.title ILIKE :search', {
        search: '%데이터베이스%',
      });
    });
  });

  describe('getAttemptDetailForUser', () => {
    it('기록이 없으면 NotFoundException', async () => {
      attemptRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getAttemptDetailForUser('user-1', 999),
      ).rejects.toThrow(NotFoundException);
    });

    it('다른 사용자의 기록이면 NotFoundException (존재 여부를 숨김)', async () => {
      attemptRepository.findOne.mockResolvedValue({
        id: 1,
        user_id: 'other-user',
      });

      await expect(
        service.getAttemptDetailForUser('user-1', 1),
      ).rejects.toThrow(NotFoundException);
    });

    it('본인 기록이면 문항별 정오답을 포함해 반환한다', async () => {
      attemptRepository.findOne.mockResolvedValue({
        id: 1,
        user_id: 'user-1',
        total_questions: 1,
        correct_count: 1,
        wrong_count: 0,
        submitted_at: new Date('2026-01-01'),
        exam: {
          id: 5,
          title: '데이터베이스 기말고사',
          year: 2025,
          exam_type: 1,
          subject: { name: '데이터베이스' },
        },
      });
      const rawAnswers = [
        {
          questionId: 10,
          questionNumber: 1,
          questionText: 'Q1',
          userAnswer: 2,
          correctAnswers: [2],
          isCorrect: true,
        },
      ];
      const mockQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawAnswers),
      };
      answerRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getAttemptDetailForUser('user-1', 1);

      expect(result).toEqual({
        id: 1,
        exam: {
          id: 5,
          title: '데이터베이스 기말고사',
          subject: '데이터베이스',
          year: 2025,
          examType: 1,
        },
        totalQuestions: 1,
        correctCount: 1,
        wrongCount: 0,
        submittedAt: new Date('2026-01-01'),
        answers: rawAnswers,
      });
    });
  });
});
