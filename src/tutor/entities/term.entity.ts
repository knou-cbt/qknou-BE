import { Subject } from "src/subjects/entities/subject.entity";
import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";

@Entity('terms')
@Index('IDX_terms_subject_term', ['subject_id', 'term'], { unique: true })
export class Term {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: false })
  subject_id: number;

  @Column({ type: 'varchar', length: 100, nullable: false })
  term: string;

  @Column({ type: 'text', nullable: false })
  explanation: string;

  @Column({ type: 'varchar', length: 50, nullable: false })
  model: string;

  @Column({ type: 'varchar', length: 20, nullable: false })
  prompt_version: string;

  @Column({ type: 'int', default: 0 })
  hit_count: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => Subject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subject_id' })
  subject: Subject;
}
