import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ExplanationReportStatus = 'processing' | 'regenerated' | 'failed';

@Entity('explanation_reports')
// unique 제약은 SQL 마이그레이션의 UQ_explanation_reports_question_user로 관리
@Index('IDX_explanation_reports_user_id', ['user_id'])
export class ExplanationReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  question_id: number;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 30, default: 'processing' })
  status: ExplanationReportStatus;

  @Column({ type: 'text', nullable: true })
  previous_explanation: string | null;

  @Column({ type: 'text', nullable: true })
  regenerated_explanation: string | null;

  @Column({ type: 'jsonb' })
  correct_answers: number[];

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
