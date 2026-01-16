import { Exam } from "src/exams/entities/exam.entity";
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity('subjects')
export class Subject{
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type:'varchar', length: 255, nullable: false})
  name: string;

  @CreateDateColumn({type: 'timestamptz'})
  created_at: Date;

  @OneToMany(() => Exam, (exam) => exam.subject, { cascade: true })
  exams: Exam[]
}