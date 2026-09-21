import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BookmarksService } from './bookmarks.service';
import { Bookmark } from './entities/bookmark.entity';
import { Questsion } from 'src/questions/entities/question.entity';

describe('BookmarksService', () => {
  let service: BookmarksService;
  let bookmarkRepository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let questionRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    bookmarkRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    questionRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookmarksService,
        { provide: getRepositoryToken(Bookmark), useValue: bookmarkRepository },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
      ],
    }).compile();

    service = module.get(BookmarksService);
  });

  describe('create', () => {
    it('문항이 없으면 NotFoundException', async () => {
      questionRepository.findOne.mockResolvedValue(null);

      await expect(service.create('user-1', 999)).rejects.toThrow(
        NotFoundException,
      );
      expect(bookmarkRepository.save).not.toHaveBeenCalled();
    });

    it('처음 등록이면 새로 만들고 created:true', async () => {
      questionRepository.findOne.mockResolvedValue({ id: 1 });
      bookmarkRepository.findOne.mockResolvedValue(null);
      bookmarkRepository.save.mockResolvedValue(undefined);

      const result = await service.create('user-1', 1);

      expect(result.created).toBe(true);
      expect(bookmarkRepository.save).toHaveBeenCalledTimes(1);
    });

    it('이미 등록돼 있으면 새로 만들지 않고 created:false (idempotent)', async () => {
      questionRepository.findOne.mockResolvedValue({ id: 1 });
      const existing = { id: 5, user_id: 'user-1', question_id: 1 };
      bookmarkRepository.findOne.mockResolvedValue(existing);

      const result = await service.create('user-1', 1);

      expect(result).toEqual({ bookmark: existing, created: false });
      expect(bookmarkRepository.save).not.toHaveBeenCalled();
    });

    it('동시 요청으로 유니크 제약 위반이 나면 기존 것을 조회해 created:false로 처리', async () => {
      questionRepository.findOne.mockResolvedValue({ id: 1 });
      bookmarkRepository.findOne.mockResolvedValue(null); // 처음엔 없다고 봤지만
      const uniqueViolation = Object.assign(new Error('duplicate key'), {
        code: '23505',
      });
      bookmarkRepository.save.mockRejectedValue(uniqueViolation);
      const raceWinner = { id: 7, user_id: 'user-1', question_id: 1 };
      bookmarkRepository.findOneOrFail.mockResolvedValue(raceWinner);

      const result = await service.create('user-1', 1);

      expect(result).toEqual({ bookmark: raceWinner, created: false });
    });

    it('알 수 없는 DB 에러는 그대로 던진다', async () => {
      questionRepository.findOne.mockResolvedValue({ id: 1 });
      bookmarkRepository.findOne.mockResolvedValue(null);
      const unknownError = new Error('connection lost');
      bookmarkRepository.save.mockRejectedValue(unknownError);

      await expect(service.create('user-1', 1)).rejects.toThrow(unknownError);
    });
  });

  describe('findAllByUser', () => {
    it('시험의 year/examType을 포함해 북마크 목록을 반환한다', async () => {
      const rows = [
        {
          questionId: 1,
          questionNumber: 3,
          questionText: 'Q1',
          examId: 10,
          examTitle: '253-데이터베이스-3학년-1교시-(3p)2019',
          year: 2019,
          examType: 1,
          subjectName: '데이터베이스',
          bookmarkedAt: new Date('2026-01-01'),
        },
      ];
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      bookmarkRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllByUser('user-1');

      expect(qb.addSelect).toHaveBeenCalledWith('exam.year', 'year');
      expect(qb.addSelect).toHaveBeenCalledWith('exam.exam_type', 'examType');
      expect(result).toEqual(rows);
    });
  });

  describe('remove', () => {
    it('북마크가 없어도 에러 없이 delete를 호출한다', async () => {
      bookmarkRepository.delete.mockResolvedValue({ affected: 0 });

      await expect(service.remove('user-1', 1)).resolves.toBeUndefined();
      expect(bookmarkRepository.delete).toHaveBeenCalledWith({
        user_id: 'user-1',
        question_id: 1,
      });
    });
  });
});
