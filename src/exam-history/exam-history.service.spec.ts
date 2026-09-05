import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ExamHistoryService } from './exam-history.service';
import { UserExamAttempt } from './entities/user-exam-attempt.entity';
import { UserExamAnswer } from './entities/user-exam-answer.entity';
import { Exam } from 'src/exams/entities/exam.entity';

describe('ExamHistoryService', () => {
  let service: ExamHistoryService;
  let attemptRepository: { findOne: jest.Mock };
  let answerRepository: { createQueryBuilder: jest.Mock };
  let examRepository: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    attemptRepository = { findOne: jest.fn() };
    answerRepository = { createQueryBuilder: jest.fn() };
    examRepository = { findOne: jest.fn() };
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
        { provide: getRepositoryToken(Exam), useValue: examRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ExamHistoryService);
  });

  describe('saveAttempt', () => {
    it('user_id 기준 advisory lock을 건 뒤 기존 기록을 지우고 새로 저장한다', async () => {
      const mockManager = {
        query: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
        create: jest.fn((_entity, data) => data),
        save: jest.fn().mockImplementation((entity) => {
          if (!Array.isArray(entity)) {
            entity.id = 100; // attempt 저장 시 id 부여
          }
          return Promise.resolve(entity);
        }),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(mockManager));

      await service.saveAttempt('user-1', 1, {
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
      });

      expect(mockManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['user-1'],
      );
      expect(mockManager.delete).toHaveBeenCalledWith(UserExamAttempt, {
        user_id: 'user-1',
      });
      // save(attempt) 1번 + save(answers 배열) 1번 = 총 2번
      expect(mockManager.save).toHaveBeenCalledTimes(2);
      const answersArg = mockManager.save.mock.calls[1][0];
      expect(answersArg).toHaveLength(2);
      expect(answersArg[0]).toMatchObject({
        question_id: 10,
        selected_answer: 2,
        is_correct: true,
      });
    });
  });

  describe('getLatestForUser', () => {
    it('기록이 없으면 null을 반환한다', async () => {
      attemptRepository.findOne.mockResolvedValue(null);

      const result = await service.getLatestForUser('user-1');

      expect(result).toBeNull();
      expect(examRepository.findOne).not.toHaveBeenCalled();
    });

    it('기록이 있으면 시험/문항 정보를 조합해서 반환한다', async () => {
      attemptRepository.findOne.mockResolvedValue({
        exam_id: 1,
        total_questions: 2,
        correct_count: 1,
        wrong_count: 1,
        submitted_at: new Date('2026-01-01'),
      });
      examRepository.findOne.mockResolvedValue({
        id: 1,
        year: 2025,
        exam_type: 1,
        subject: { name: '경영학원론' },
      });
      const rawAnswers = [
        {
          questionId: 10,
          questionNumber: 1,
          questionText: '문제1',
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

      const result = await service.getLatestForUser('user-1');

      expect(result).toEqual({
        exam: { id: 1, subject: '경영학원론', year: 2025, examType: 1 },
        totalQuestions: 2,
        correctCount: 1,
        wrongCount: 1,
        submittedAt: new Date('2026-01-01'),
        answers: rawAnswers,
      });
    });
  });
});
