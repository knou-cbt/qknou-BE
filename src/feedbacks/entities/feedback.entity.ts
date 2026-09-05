import { Questsion } from 'src/questions/entities/question.entity';
import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type FeedbackType = 'question_bug' | 'site_bug' | 'suggestion' | 'other';

/**
 * 피드백 접수 로그. 상태/담당자 관리는 GitHub Issue가 기준이라
 * 여기서는 "접수 내역 + 어떤 이슈에 연결됐는지"만 들고 있는다.
 */
@Entity('feedbacks')
@Index('IDX_feedbacks_question_id', ['question_id'])
export class Feedback {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 30, nullable: false })
  type: FeedbackType;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({ type: 'int', nullable: true })
  question_id: number | null;

  @Column({ type: 'text', nullable: true })
  page_url: string | null;

  @Column({ type: 'int', nullable: true })
  github_issue_number: number | null;

  @Column({ type: 'text', nullable: true })
  github_issue_url: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Questsion, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'question_id' })
  question: Questsion | null;
}
