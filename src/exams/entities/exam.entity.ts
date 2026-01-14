import { Questsion } from "src/questions/entities/question.entity";
import { Subject  } from "src/subjects/entities/subject.entity";
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity('exams')
export class Exam{
  @PrimaryGeneratedColumn()
  id: number;

  @Column({type: 'int', nullable: false})
  subject_id: number;

  @Column({type:'int', nullable: false})
  year: number;
  
  @Column({type:'smallint', nullable: true})
  exam_type: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'int', nullable: false })
  total_questions: number;

  @CreateDateColumn({type: 'timestamp'})
  created_at: Date

  //여러 시험이 하나의 과목에 속함
  @ManyToOne(() => Subject )
  @JoinColumn({ name: 'subject_id' }) //외래키 컬럼명 지정
  subject: Subject;
  
  @OneToMany(() => Questsion, (question) => question.exam)
  questions: Questsion[]
}