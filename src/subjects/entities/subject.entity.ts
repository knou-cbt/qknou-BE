import { Department } from "src/departments/entities/department.entity";
import { Exam } from "src/exams/entities/exam.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity('subjects')
export class Subject{
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type:'varchar', length: 255, nullable: false})
  name: string;

  @CreateDateColumn({type: 'timestamptz'})
  created_at: Date;

  @ManyToOne(()=>Department, {onDelete: 'SET NULL',nullable: true })
  @JoinColumn({name: 'department_id'})
  department: Department;

  @OneToMany(() => Exam, (exam) => exam.subject, { cascade: true })
  exams: Exam[]
}