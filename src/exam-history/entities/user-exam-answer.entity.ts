import { Questsion } from 'src/questions/entities/question.entity';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserExamAttempt } from './user-exam-attempt.entity';

@Entity('user_exam_answers')
@Index('IDX_user_exam_answers_attempt_id', ['attempt_id'])
export class UserExamAnswer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  attempt_id: number;

  @Column({ type: 'int', nullable: false })
  question_id: number;

  @Column({ type: 'int', nullable: false })
  question_number: number;

  /** 사용자가 선택한 답 (미선택 시 null). 현재 시험 제출 API가 문항당 단일 선택만 지원. */
  @Column({ type: 'int', nullable: true })
  selected_answer: number | null;

  @Column({ type: 'jsonb', nullable: false })
  correct_answers: number[];

  @Column({ type: 'boolean', nullable: false })
  is_correct: boolean;

  @ManyToOne(() => UserExamAttempt, (attempt) => attempt.answers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attempt_id' })
  attempt: UserExamAttempt;

  @ManyToOne(() => Questsion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Questsion;
}
