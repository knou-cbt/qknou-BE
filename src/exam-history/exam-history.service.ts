import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserExamAttempt } from './entities/user-exam-attempt.entity';
import { UserExamAnswer } from './entities/user-exam-answer.entity';
import { Exam } from 'src/exams/entities/exam.entity';

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
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>,
    private dataSource: DataSource,
  ) {}

  /**
   * 시험 제출 결과를 "최근 풀이 기록"으로 저장.
   * 기존 기록이 있으면 지우고 새로 저장(누적하지 않음).
   * 채점 자체는 이미 끝난 상태라, 여기서 실패해도 호출부(submitExam)에서
   * 응답 자체를 실패시키지 않도록 try/catch로 감싸서 호출해야 한다.
   */
  async saveAttempt(
    userId: string,
    examId: number,
    result: SubmitResultForHistory,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // 같은 사용자가 동시에 두 번 제출해도(중복 클릭/재시도) delete→insert가
      // 서로 겹치지 않도록 트랜잭션 범위의 advisory lock으로 직렬화한다.
      // (트랜잭션 커밋/롤백 시 자동 해제되므로 별도 unlock 불필요)
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        userId,
      ]);

      await manager.delete(UserExamAttempt, { user_id: userId });

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
   * 사용자의 최근 시험 풀이 기록 조회 (없으면 null)
   */
  async getLatestForUser(userId: string) {
    const attempt = await this.attemptRepository.findOne({
      where: { user_id: userId },
    });
    if (!attempt) {
      return null;
    }

    const exam = await this.examRepository.findOne({
      where: { id: attempt.exam_id },
      relations: ['subject'],
    });

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
      exam: {
        id: exam?.id ?? attempt.exam_id,
        subject: exam?.subject?.name ?? null,
        year: exam?.year ?? null,
        examType: exam?.exam_type ?? null,
      },
      totalQuestions: attempt.total_questions,
      correctCount: attempt.correct_count,
      wrongCount: attempt.wrong_count,
      submittedAt: attempt.submitted_at,
      answers,
    };
  }
}
