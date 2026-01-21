import { Questsion } from "src/questions/entities/question.entity";
import { Subject  } from "src/subjects/entities/subject.entity";
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { ExamType } from "../enums/exam-type.enum";

@Entity('exams')
@Index('IDX_exams_subject_id', ['subject_id'])
@Index('IDX_exams_year_exam_type', ['year', 'exam_type'])
export class Exam{
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type: 'int', nullable: false})
  subject_id: number;

  @Column({type:'int', nullable: false})
  year: number;
  
  @Column({type:'smallint', nullable: true})
  exam_type: ExamType;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'int', nullable: false })
  total_questions: number;

  @CreateDateColumn({type: 'timestamptz'})
  created_at: Date

  //여러 시험이 하나의 과목에 속함
  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' }) //외래키 컬럼명 지정
  subject: Subject;
  
  @OneToMany(() => Questsion, (question) => question.exam, { cascade: true })
  questions: Questsion[]
}