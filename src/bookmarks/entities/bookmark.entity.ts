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

@Entity('bookmarks')
@Index('UQ_bookmarks_user_question', ['user_id', 'question_id'], {
  unique: true,
})
@Index('IDX_bookmarks_question_id', ['question_id'])
export class Bookmark {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'int', nullable: false })
  question_id: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Questsion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'question_id' })
  question: Questsion;
}
