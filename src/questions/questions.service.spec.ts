import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { Questsion } from './entities/question.entity';
import { BookmarksService } from 'src/bookmarks/bookmarks.service';

describe('QuestionsService', () => {
  let service: QuestionsService;
  let questionRepository: { findOne: jest.Mock };
  let bookmarksService: { isBookmarked: jest.Mock };

  beforeEach(async () => {
    questionRepository = { findOne: jest.fn() };
    bookmarksService = { isBookmarked: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        { provide: BookmarksService, useValue: bookmarksService },
      ],
    }).compile();

    service = module.get(QuestionsService);
  });

  describe('findOnePublic', () => {
    it('문항이 없으면 NotFoundException', async () => {
      questionRepository.findOne.mockResolvedValue(null);

      await expect(service.findOnePublic(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('userId가 없으면 isBookmarked는 null이고 북마크 여부를 조회하지 않는다', async () => {
      questionRepository.findOne.mockResolvedValue({
        id: 1,
        question_number: 1,
        question_text: 'Q',
        example_text: null,
        shared_example: null,
        question_image_urls: null,
        choices: [],
        correct_answers: [1],
        explanation: null,
        exam: { id: 10, title: 'exam title', subject: { name: '과목' } },
      });

      const result = await service.findOnePublic(1);

      expect(result.isBookmarked).toBeNull();
      expect(bookmarksService.isBookmarked).not.toHaveBeenCalled();
    });

    it('userId가 있으면 북마크 여부를 채워서 반환한다', async () => {
      questionRepository.findOne.mockResolvedValue({
        id: 1,
        question_number: 1,
        question_text: 'Q',
        example_text: null,
        shared_example: null,
        question_image_urls: null,
        choices: [],
        correct_answers: [1],
        explanation: null,
        exam: { id: 10, title: 'exam title', year: 2019, subject: { name: '과목' } },
      });
      bookmarksService.isBookmarked.mockResolvedValue(true);

      const result = await service.findOnePublic(1, 'user-1');

      expect(result.isBookmarked).toBe(true);
      expect(bookmarksService.isBookmarked).toHaveBeenCalledWith('user-1', 1);
      expect(result.exam).toEqual({
        id: 10,
        title: 'exam title',
        year: 2019,
        subject: '과목',
      });
    });
  });
});
