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
 * 사용자별 시험 풀이 기록. 같은 과목(subject) + 같은 연도(year)의 시험을
 * 다시 풀면(재응시) 그 조합의 이전 기록은 삭제되고 최신 기록 1건만 남는다
 * (연도가 다르면 별도 기록으로 유지됨. ExamHistoryService.saveAttempt 참고).
 */
@Entity('user_exam_attempts')
@Index('IDX_user_exam_attempts_user_id', ['user_id'])
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
