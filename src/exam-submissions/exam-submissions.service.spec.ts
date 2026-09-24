import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ExamSubmissionsService } from './exam-submissions.service';
import { ExamSubmission } from './entities/exam-submission.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { StorageService } from 'src/storage/storage.service';

const PDF_BUFFER = Buffer.from('%PDF-1.4\n%mock pdf content');
const NOT_PDF_BUFFER = Buffer.from('this is not a pdf');

describe('ExamSubmissionsService', () => {
  let service: ExamSubmissionsService;
  let submissionRepository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let examRepository: { findOne: jest.Mock };
  let questionRepository: Record<string, jest.Mock>;
  let storageService: { uploadBuffer: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    submissionRepository = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };
    examRepository = { findOne: jest.fn() };
    questionRepository = {};
    storageService = {
      uploadBuffer: jest
        .fn()
        .mockResolvedValue('https://cdn.example.com/x.pdf'),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamSubmissionsService,
        {
          provide: getRepositoryToken(ExamSubmission),
          useValue: submissionRepository,
        },
        { provide: getRepositoryToken(Exam), useValue: examRepository },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        { provide: StorageService, useValue: storageService },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(ExamSubmissionsService);
  });

  describe('checkDuplicate', () => {
    it('이미 게시된 시험이면 already_published', async () => {
      examRepository.findOne.mockResolvedValue({ id: 1 });

      const result = await service.checkDuplicate(1, 2025, 1);

      expect(result).toEqual({ blocked: true, reason: 'already_published' });
    });

    it('검수 진행 중인 제출이 있으면 already_in_review', async () => {
      examRepository.findOne.mockResolvedValue(null);
      submissionRepository.findOne.mockResolvedValue({
        id: 5,
        status: 'parsed',
      });

      const result = await service.checkDuplicate(1, 2025, 1);

      expect(result).toEqual({ blocked: true, reason: 'already_in_review' });
    });

    it('둘 다 없으면 업로드 가능', async () => {
      examRepository.findOne.mockResolvedValue(null);
      submissionRepository.findOne.mockResolvedValue(null);

      const result = await service.checkDuplicate(1, 2025, 1);

      expect(result).toEqual({ blocked: false });
    });
  });

  describe('upload', () => {
    const dto = { subjectId: 1, year: 2025, examType: 1 };

    it('파일이 없으면 BadRequestException', async () => {
      await expect(service.upload('user-1', undefined, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('PDF 매직바이트가 아니면 BadRequestException', async () => {
      await expect(
        service.upload('user-1', { buffer: NOT_PDF_BUFFER } as any, dto),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('중복이면 BadRequestException (파일 업로드 전에 걸러짐)', async () => {
      examRepository.findOne.mockResolvedValue({ id: 1 }); // already_published

      await expect(
        service.upload('user-1', { buffer: PDF_BUFFER } as any, dto),
      ).rejects.toThrow(BadRequestException);
      expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    });

    it('정상 업로드 시 pending 상태로 접수한다', async () => {
      examRepository.findOne.mockResolvedValue(null);
      submissionRepository.findOne.mockResolvedValue(null);

      const result = await service.upload(
        'user-1',
        { buffer: PDF_BUFFER } as any,
        dto,
      );

      expect(result.status).toBe('pending');
      expect(storageService.uploadBuffer).toHaveBeenCalledWith(
        PDF_BUFFER,
        expect.stringContaining('exam-submissions/'),
        'application/pdf',
      );
    });

    it('사전확인 통과 후 동시에 다른 요청이 먼저 접수했으면(유니크 위반) BadRequestException', async () => {
      examRepository.findOne.mockResolvedValue(null);
      submissionRepository.findOne.mockResolvedValue(null);
      submissionRepository.save.mockRejectedValue(
        Object.assign(new Error('duplicate'), { code: '23505' }),
      );

      await expect(
        service.upload('user-1', { buffer: PDF_BUFFER } as any, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('patchParsedResult', () => {
    const parsedResult = {
      examTitle: '경영학원론 2025',
      questions: [],
    } as any;

    it('parsed 상태이고 version이 맞으면 성공한다', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOneOrFail.mockResolvedValue({
        id: 1,
        version: 2,
      });

      const result = await service.patchParsedResult(1, parsedResult, 1);

      expect(result).toEqual({ id: 1, version: 2 });
    });

    it('version이 다르면(동시 수정) ConflictException', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'parsed',
        version: 3,
      });

      await expect(
        service.patchParsedResult(1, parsedResult, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('parsed 상태가 아니면 ConflictException', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'published',
        version: 1,
      });

      await expect(
        service.patchParsedResult(1, parsedResult, 1),
      ).rejects.toThrow(ConflictException);
    });

    it('존재하지 않는 건이면 NotFoundException', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOne.mockResolvedValue(null);

      await expect(
        service.patchParsedResult(999, parsedResult, 1),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publish', () => {
    function mockTransactionManager(overrides: Partial<any> = {}) {
      return {
        query: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn(),
        create: jest.fn((_entity, data) => data),
        save: jest.fn().mockImplementation((entity) => {
          if (!Array.isArray(entity)) entity.id = entity.id ?? 500;
          return Promise.resolve(entity);
        }),
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('존재하지 않는 건이면 NotFoundException', async () => {
      submissionRepository.findOne.mockResolvedValue(null);

      await expect(service.publish(1, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('이미 published면 기존 examId를 그대로 반환한다 (멱등)', async () => {
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        subject_id: 1,
        year: 2025,
        exam_type: 1,
      });
      const manager = mockTransactionManager();
      manager.findOne.mockResolvedValue({
        id: 1,
        status: 'published',
        published_exam_id: 777,
      });
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      const result = await service.publish(1, 'admin-1');

      expect(result).toEqual({ examId: 777 });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('parsed 상태가 아니면 ConflictException', async () => {
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        subject_id: 1,
        year: 2025,
        exam_type: 1,
      });
      const manager = mockTransactionManager();
      manager.findOne.mockResolvedValue({ id: 1, status: 'pending' });
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      await expect(service.publish(1, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('parsedResult가 비어있으면 BadRequestException', async () => {
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        subject_id: 1,
        year: 2025,
        exam_type: 1,
      });
      const manager = mockTransactionManager();
      manager.findOne.mockResolvedValue({
        id: 1,
        status: 'parsed',
        parsed_result: { examTitle: 't', questions: [] },
      });
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      await expect(service.publish(1, 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('동일 조합의 시험이 이미 존재하면 ConflictException', async () => {
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        subject_id: 1,
        year: 2025,
        exam_type: 1,
      });
      const manager = mockTransactionManager();
      manager.findOne
        .mockResolvedValueOnce({
          id: 1,
          status: 'parsed',
          parsed_result: {
            examTitle: 't',
            questions: [{ questionNumber: 1 }],
          },
        }) // ExamSubmission 재조회
        .mockResolvedValueOnce({ id: 42 }); // 이미 존재하는 Exam
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      await expect(service.publish(1, 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('정상 게시 시 exam/questions를 만들고 submission을 published로 갱신한다', async () => {
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        subject_id: 1,
        year: 2025,
        exam_type: 1,
      });
      const manager = mockTransactionManager();
      manager.findOne
        .mockResolvedValueOnce({
          id: 1,
          status: 'parsed',
          parsed_result: {
            examTitle: '경영학원론 2025',
            questions: [
              {
                questionNumber: 1,
                questionText: 'Q1',
                correctAnswers: [1],
                choices: [{ number: 1, text: 'A', imageUrls: null }],
              },
            ],
          },
        }) // ExamSubmission 재조회
        .mockResolvedValueOnce(null); // 기존 Exam 없음
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));

      const result = await service.publish(1, 'admin-1');

      expect(result.examId).toBe(500);
      expect(manager.update).toHaveBeenCalledWith(
        ExamSubmission,
        { id: 1 },
        expect.objectContaining({
          status: 'published',
          published_exam_id: 500,
          reviewed_by: 'admin-1',
        }),
      );
    });
  });

  describe('reject', () => {
    it('parsed/failed 상태면 반려에 성공한다', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.reject(1, '스캔 품질 낮음', 'admin-1');

      expect(result).toEqual({ id: 1, status: 'rejected' });
    });

    it('이미 반려된 건이면 멱등하게 그대로 반환한다', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'rejected',
      });

      const result = await service.reject(1, '사유', 'admin-1');

      expect(result).toEqual({ id: 1, status: 'rejected' });
    });

    it('published 상태면 반려할 수 없다 (ConflictException)', async () => {
      const mockQb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      submissionRepository.createQueryBuilder.mockReturnValue(mockQb);
      submissionRepository.findOne.mockResolvedValue({
        id: 1,
        status: 'published',
      });

      await expect(service.reject(1, '사유', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
