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

/** 일일 피드백 제출 횟수 제한용 (user_chat_limits와 동일한 패턴) */
@Entity('user_feedback_limits')
@Index('IDX_user_feedback_limits_user_date', ['user_id', 'date'], {
  unique: true,
})
export class UserFeedbackLimit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'date', nullable: false })
  date: Date;

  @Column({ type: 'int', default: 0 })
  count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
