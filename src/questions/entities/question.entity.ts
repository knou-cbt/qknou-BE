import { Exam } from 'src/exams/entities/exam.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('questions')
@Index('IDX_questions_exam_id', ['exam_id'])
export class Questsion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  exam_id: number;

  @Column({ type: 'int', nullable: false })
  question_number: number;

  @Column({ type: 'text', nullable: false })
  question_text: string;

  @Column({ type: 'text', nullable: true })
  example_text: string;

  @Column({ type: 'text', nullable: true })
  shared_example: string;

  @Column({ type: 'jsonb', nullable: true })
  question_image_urls: string[];

  @Column({ type: 'jsonb', nullable: false })
  correct_answers: number[];

  @Column({ type: 'jsonb', nullable: false })
  choices: Array<{
    number: number;
    text: string;
    imageUrls: string[] | null;
  }>;

  @Column({ type: 'text', nullable: true })
  explanation: string;

  @Column({ type: 'jsonb', nullable: true })
  concept_tags: string[];

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Exam, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;
}
