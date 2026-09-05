import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UpdateNotice } from './update-notice.entity';

/**
 * 문제 수정/시험 추가 등 개별 업데이트 내역 (내부용, 누적 저장)
 * notice_id가 채워지면 어떤 공지로 발행됐는지 알 수 있음
 */
@Entity('update_entries')
@Index('IDX_update_entries_notice_id', ['notice_id'])
export class UpdateEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, nullable: false })
  type: string;

  @Column({ type: 'text', nullable: false })
  content: string;

  @Column({ type: 'int', nullable: true })
  notice_id: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @ManyToOne(() => UpdateNotice, (notice) => notice.entries, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'notice_id' })
  notice: UpdateNotice | null;
}
