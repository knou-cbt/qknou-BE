import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserExamAttempt } from './entities/user-exam-attempt.entity';
import { UserExamAnswer } from './entities/user-exam-answer.entity';

export interface SubmitResultForHistory {
  totalQuestions: number;
  correctCount: number;
  results: Array<{
    questionId: number;
    questionNumber: number;
    userAnswer: number | null;
    correctAnswers: number[];
    isCorrect: boolean;
  }>;
}

@Injectable()
export class ExamHistoryService {
  constructor(
    @InjectRepository(UserExamAttempt)
    private attemptRepository: Repository<UserExamAttempt>,
    @InjectRepository(UserExamAnswer)
    private answerRepository: Repository<UserExamAnswer>,
    private dataSource: DataSource,
  ) {}

  /**
   * 시험 제출 결과를 풀이 기록으로 저장. 같은 과목(subject) + 같은 연도(year)의
   * 기존 기록은 지우고 이번 기록만 남긴다 (마이페이지 히스토리엔 과목-연도 조합당
   * 최신 응시 결과만 노출됨. 같은 과목이라도 연도가 다른 시험 기록은 유지됨).
   * 채점 자체는 이미 끝난 상태라, 여기서 실패해도 호출부(submitExam)에서
   * 응답 자체를 실패시키지 않도록 try/catch로 감싸서 호출해야 한다.
   */
  async saveAttempt(
    userId: string,
    examId: number,
    subjectId: number,
    year: number,
    result: SubmitResultForHistory,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const previousAttempts = await manager
        .createQueryBuilder(UserExamAttempt, 'attempt')
        .innerJoin('attempt.exam', 'exam')
        .where('attempt.user_id = :userId', { userId })
        .andWhere('exam.subject_id = :subjectId', { subjectId })
        .andWhere('exam.year = :year', { year })
        .getMany();

      if (previousAttempts.length > 0) {
        await manager.delete(
          UserExamAttempt,
          previousAttempts.map((a) => a.id),
        );
      }

      const attempt = manager.create(UserExamAttempt, {
        user_id: userId,
        exam_id: examId,
        total_questions: result.totalQuestions,
        correct_count: result.correctCount,
        wrong_count: result.totalQuestions - result.correctCount,
      });
      await manager.save(attempt);

      const answers = result.results.map((r) =>
        manager.create(UserExamAnswer, {
          attempt_id: attempt.id,
          question_id: r.questionId,
          question_number: r.questionNumber,
          selected_answer: r.userAnswer,
          correct_answers: r.correctAnswers,
          is_correct: r.isCorrect,
        }),
      );
      await manager.save(answers);
    });
  }

  /**
   * 사용자의 풀이 기록 목록 조회 (최신순, 시험 제목 검색 + 페이지네이션).
   * "풀었던 문제 N회" 같은 통계는 여기 total을 그대로 쓰면 된다.
   */
  async getHistoryForUser(
    userId: string,
    options: { search?: string; page: number; limit: number },
  ) {
    const { search, page, limit } = options;

    const baseQb = this.attemptRepository
      .createQueryBuilder('attempt')
      .innerJoin('attempt.exam', 'exam')
      .leftJoin('exam.subject', 'subject')
      .where('attempt.user_id = :userId', { userId });

    if (search) {
      baseQb.andWhere('exam.title ILIKE :search', { search: `%${search}%` });
    }

    const total = await baseQb.getCount();

    const items = await baseQb
      .clone()
      .select('attempt.id', 'id')
      .addSelect('exam.id', 'examId')
      .addSelect('exam.title', 'examTitle')
      .addSelect('subject.name', 'subjectName')
      .addSelect('exam.year', 'year')
      .addSelect('exam.exam_type', 'examType')
      .addSelect('attempt.total_questions', 'totalQuestions')
      .addSelect('attempt.correct_count', 'correctCount')
      .addSelect('attempt.wrong_count', 'wrongCount')
      .addSelect('attempt.submitted_at', 'submittedAt')
      .orderBy('attempt.submitted_at', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany();

    return { items, total, page, limit };
  }

  /**
   * 풀이 기록 1건 상세(문항별 정오답 포함) 조회.
   * 본인 기록이 아니면(다른 사용자 것이면) 404로 취급해서 존재 여부를 숨긴다.
   */
  async getAttemptDetailForUser(userId: string, attemptId: number) {
    const attempt = await this.attemptRepository.findOne({
      where: { id: attemptId },
      relations: ['exam', 'exam.subject'],
    });
    if (!attempt || attempt.user_id !== userId) {
      throw new NotFoundException(
        `풀이 기록 id ${attemptId}를 찾을 수 없습니다.`,
      );
    }

    const answers = await this.answerRepository
      .createQueryBuilder('answer')
      .innerJoin('answer.question', 'question')
      .where('answer.attempt_id = :attemptId', { attemptId: attempt.id })
      .select('answer.question_id', 'questionId')
      .addSelect('answer.question_number', 'questionNumber')
      .addSelect('question.question_text', 'questionText')
      .addSelect('answer.selected_answer', 'userAnswer')
      .addSelect('answer.correct_answers', 'correctAnswers')
      .addSelect('answer.is_correct', 'isCorrect')
      .orderBy('answer.question_number', 'ASC')
      .getRawMany();

    return {
      id: attempt.id,
      exam: {
        id: attempt.exam.id,
        title: attempt.exam.title,
        subject: attempt.exam.subject?.name ?? null,
        year: attempt.exam.year,
        examType: attempt.exam.exam_type,
      },
      totalQuestions: attempt.total_questions,
      correctCount: attempt.correct_count,
      wrongCount: attempt.wrong_count,
      submittedAt: attempt.submitted_at,
      answers,
    };
  }
}
