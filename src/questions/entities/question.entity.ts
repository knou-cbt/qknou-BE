import { Choice } from "src/choices/entities/choice.entity";
import { Exam } from "src/exams/entities/exam.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity('questions')
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
  question_image_url: string;

  @Column({type:'int', nullable: false})
  correct_answer: number;

  @CreateDateColumn({type: 'timestamp'})
  created_at: Date;

  @ManyToOne(() => Exam)
  @JoinColumn({ name: 'exam_id' })
  exam: Exam;

  @OneToMany(() => Choice, (choice) => choice.question)
  choices: Choice[]
}