import { Exam } from "src/exams/entities/exam.entity";
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity('questions')
@Index('IDX_questions_exam_id', ['exam_id'])
export class Questsion{
  @PrimaryGeneratedColumn()
  id: number;
  
  @Column({type:'int', nullable: false})
  exam_id: number;

  @Column({type:'int', nullable: false})
  question_number: number;

  @Column({type:'text', nullable: false})
  question_text: string;

  @Column({type:'text', nullable: true})
  example_text: string;

  @Column({type:'text', nullable: true})
  question_image_url: string;

  @Column({type:'jsonb', nullable: false})
  correct_answers: number[];

  @Column({type:'jsonb', nullable: false})
  choices: Array<{
    number: number;
    text: string;
    imageUrl: string | null;
  }>;

  @Column({type:'text', nullable: true})
  explanation: string;

  @CreateDateColumn({type: 'timestamptz'})
  created_at: Date;

  @ManyToOne(() => Exam, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;
}