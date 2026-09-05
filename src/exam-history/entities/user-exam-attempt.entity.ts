import { Exam } from 'src/exams/entities/exam.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserExamAnswer } from './user-exam-answer.entity';

/**
 * 사용자별 최근 시험 풀이 기록.
 * 여러 건 누적하지 않고 user_id당 1건만 유지한다 (새로 제출하면 이전 기록 대체).
 */
@Entity('user_exam_attempts')
@Index('UQ_user_exam_attempts_user', ['user_id'], { unique: true })
export class UserExamAttempt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int', nullable: false })
  total_questions: number;

  @Column({ type: 'int', nullable: false })
  correct_count: number;

  @Column({ type: 'int', nullable: false })
  wrong_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  submitted_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Exam, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @OneToMany(() => UserExamAnswer, (answer) => answer.attempt, {
    cascade: true,
  })
  answers: UserExamAnswer[];
}
