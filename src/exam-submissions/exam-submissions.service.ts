import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  ExamSubmission,
  ExamSubmissionStatus,
} from './entities/exam-submission.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { StorageService } from 'src/storage/storage.service';

/** 이 상태들은 "검수 진행 중"이라 같은 조합의 새 업로드를 막아야 함 */
const ACTIVE_STATUSES: ExamSubmissionStatus[] = [
  'pending',
  'processing',
  'parsed',
];

export interface DuplicateCheckResult {
  blocked: boolean;
  reason?: 'already_published' | 'already_in_review';
}

@Injectable()
export class ExamSubmissionsService {
  constructor(
    @InjectRepository(ExamSubmission)
    private submissionRepository: Repository<ExamSubmission>,
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    private storageService: StorageService,
    private dataSource: DataSource,
  ) {}

  /**
   * 업로드 전 사전 확인 (UX 보조용). 최종 중복 방지는 upload()의
   * DB 유니크 인덱스(UQ_exam_submissions_active)가 담당한다.
   */
  async checkDuplicate(
    subjectId: number,
    year: number,
    examType: number,
  ): Promise<DuplicateCheckResult> {
    const publishedExam = await this.examRepository.findOne({
      where: { subject_id: subjectId, year, exam_type: examType },
    });
    if (publishedExam) {
      return { blocked: true, reason: 'already_published' };
    }

    const activeSubmission = await this.submissionRepository.findOne({
      where: {
        subject_id: subjectId,
        year,
        exam_type: examType,
        status: In(ACTIVE_STATUSES),
      },
    });
    if (activeSubmission) {
      return { blocked: true, reason: 'already_in_review' };
    }

    return { blocked: false };
  }

  async upload(
    userId: string,
    file: Express.Multer.File | undefined,
    dto: { subjectId: number; year: number; examType: number },
  ) {
    if (!file) {
      throw new BadRequestException('시험지 파일이 필요합니다.');
    }
    if (!this.isPdf(file.buffer)) {
      throw new BadRequestException('PDF 파일만 업로드할 수 있습니다.');
    }

    const dup = await this.checkDuplicate(
      dto.subjectId,
      dto.year,
      dto.examType,
    );
    if (dup.blocked) {
      throw new BadRequestException(
        dup.reason === 'already_published'
          ? '이미 게시된 시험입니다.'
          : '이미 검수 중인 시험지가 있습니다.',
      );
    }

    const fileUrl = await this.storageService.uploadBuffer(
      file.buffer,
      `exam-submissions/${randomUUID()}.pdf`,
      'application/pdf',
    );

    try {
      const submission = this.submissionRepository.create({
        user_id: userId,
        subject_id: dto.subjectId,
        year: dto.year,
        exam_type: dto.examType,
        file_url: fileUrl,
        status: 'pending',
      });
      await this.submissionRepository.save(submission);

      return {
        id: submission.id,
        status: submission.status,
        createdAt: submission.created_at,
      };
    } catch (error: any) {
      // 사전 확인 이후 동시에 다른 요청이 먼저 접수한 경우 (DB 유니크 인덱스가 최종 방어)
      if (error.code === '23505') {
        throw new BadRequestException('이미 검수 중인 시험지가 있습니다.');
      }
      throw error;
    }
  }

  private isPdf(buffer: Buffer): boolean {
    return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  }

  async listForAdmin(status: string | undefined, page: number, limit: number) {
    const baseQb = this.submissionRepository
      .createQueryBuilder('submission')
      .innerJoin('submission.subject', 'subject')
      .innerJoin('submission.user', 'user');

    if (status) {
      baseQb.where('submission.status = :status', { status });
    }

    const total = await baseQb.getCount();

    const items = await baseQb
      .clone()
      .select('submission.id', 'id')
      .addSelect('user.email', 'uploaderEmail')
      .addSelect('subject.name', 'subjectName')
      .addSelect('submission.year', 'year')
      .addSelect('submission.exam_type', 'examType')
      .addSelect('submission.status', 'status')
      .addSelect('submission.created_at', 'createdAt')
      .orderBy('submission.created_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    return { items, total, page, limit };
  }

  async getDetailForAdmin(id: number) {
    const submission = await this.submissionRepository.findOne({
      where: { id },
    });
    if (!submission) {
      throw new NotFoundException(`등록 id ${id}를 찾을 수 없습니다.`);
    }

    return {
      id: submission.id,
      status: submission.status,
      fileUrl: submission.file_url,
      parsedResult: submission.parsed_result,
      errorMessage: submission.error_message,
      version: submission.version,
    };
  }

  /**
   * 파싱 결과 수정. 낙관적 락(version) + 조건부 UPDATE로 두 관리자가
   * 동시에 수정해도 서로 덮어쓰지 않도록 한다.
   */
  async patchParsedResult(
    id: number,
    parsedResult: ExamSubmission['parsed_result'],
    expectedVersion: number,
  ) {
    const result = await this.submissionRepository
      .createQueryBuilder()
      .update(ExamSubmission)
      .set({ parsed_result: parsedResult, version: () => 'version + 1' })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: 'parsed' })
      .andWhere('version = :expectedVersion', { expectedVersion })
      .execute();

    if (result.affected === 0) {
      const submission = await this.submissionRepository.findOne({
        where: { id },
      });
      if (!submission) {
        throw new NotFoundException(`등록 id ${id}를 찾을 수 없습니다.`);
      }
      if (submission.status !== 'parsed') {
        throw new ConflictException(
          `현재 상태(${submission.status})에서는 수정할 수 없습니다. parsed 상태만 수정 가능합니다.`,
        );
      }
      throw new ConflictException(
        '다른 관리자가 먼저 수정했습니다. 최신 내용을 다시 조회한 뒤 다시 시도해주세요.',
      );
    }

    const updated = await this.submissionRepository.findOneOrFail({
      where: { id },
    });
    return { id: updated.id, version: updated.version };
  }

  /**
   * 파싱 결과를 실제 exams/questions에 반영. 같은 (subject_id, year,
   * exam_type) 조합으로 동시에 게시되는 걸 advisory lock으로 직렬화하고,
   * 이미 게시된 건을 다시 호출하면 기존 examId를 그대로 반환한다(멱등).
   */
  async publish(id: number, adminUserId: string) {
    const submission = await this.submissionRepository.findOne({
      where: { id },
    });
    if (!submission) {
      throw new NotFoundException(`등록 id ${id}를 찾을 수 없습니다.`);
    }

    const { subject_id, year, exam_type } = submission;

    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `exam-submission-publish:${subject_id}:${year}:${exam_type}`,
      ]);

      // 락 획득 후 최신 상태로 다시 확인 (동시 publish 대비)
      const fresh = await manager.findOne(ExamSubmission, {
        where: { id },
      });
      if (!fresh) {
        throw new NotFoundException(`등록 id ${id}를 찾을 수 없습니다.`);
      }

      if (fresh.status === 'published') {
        return { examId: fresh.published_exam_id };
      }
      if (fresh.status !== 'parsed') {
        throw new ConflictException(
          `현재 상태(${fresh.status})에서는 게시할 수 없습니다. parsed 상태만 게시 가능합니다.`,
        );
      }
      if (!fresh.parsed_result || fresh.parsed_result.questions.length === 0) {
        throw new BadRequestException(
          '파싱 결과가 비어있어 게시할 수 없습니다.',
        );
      }

      const existingExam = await manager.findOne(Exam, {
        where: { subject_id, year, exam_type },
      });
      if (existingExam) {
        throw new ConflictException(
          '동일 조합(subjectId/year/examType)의 시험이 이미 존재합니다.',
        );
      }

      const exam = manager.create(Exam, {
        subject_id,
        year,
        exam_type,
        title: fresh.parsed_result.examTitle,
        total_questions: fresh.parsed_result.questions.length,
      });
      const savedExam = await manager.save(exam);

      for (const q of fresh.parsed_result.questions) {
        const question = manager.create(Questsion, {
          exam_id: savedExam.id,
          question_number: q.questionNumber,
          question_text: q.questionText,
          example_text: q.exampleText ?? null,
          shared_example: q.sharedExample ?? null,
          shared_example_image_urls: q.sharedExampleImageUrls ?? null,
          question_image_urls: q.questionImageUrls ?? null,
          correct_answers: q.correctAnswers,
          choices: q.choices,
          explanation: q.explanation ?? null,
        });
        await manager.save(question);
      }

      await manager.update(
        ExamSubmission,
        { id: fresh.id },
        {
          status: 'published',
          published_exam_id: savedExam.id,
          reviewed_by: adminUserId,
          reviewed_at: new Date(),
        },
      );

      return { examId: savedExam.id };
    });

    return result;
  }

  /**
   * parsed/failed 상태만 반려 가능. 이미 반려된 건은 멱등하게 그대로 반환.
   */
  async reject(id: number, reason: string, adminUserId: string) {
    const result = await this.submissionRepository
      .createQueryBuilder()
      .update(ExamSubmission)
      .set({
        status: 'rejected',
        reject_reason: reason,
        reviewed_by: adminUserId,
        reviewed_at: new Date(),
      })
      .where('id = :id', { id })
      .andWhere('status IN (:...statuses)', { statuses: ['parsed', 'failed'] })
      .execute();

    if (result.affected === 0) {
      const submission = await this.submissionRepository.findOne({
        where: { id },
      });
      if (!submission) {
        throw new NotFoundException(`등록 id ${id}를 찾을 수 없습니다.`);
      }
      if (submission.status === 'rejected') {
        return { id: submission.id, status: submission.status };
      }
      throw new ConflictException(
        `현재 상태(${submission.status})에서는 반려할 수 없습니다.`,
      );
    }

    return { id, status: 'rejected' as const };
  }
}
