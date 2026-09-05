import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UpdateEntry } from './update-entry.entity';

/**
 * 사용자에게 노출되는 업데이트 공지 (여러 update_entries를 묶어서 발행)
 */
@Entity('update_notices')
@Index('IDX_update_notices_expose_window', ['expose_start_at', 'expose_end_at'])
export class UpdateNotice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, nullable: false })
  title: string;

  @Column({ type: 'text', nullable: false })
  content: string;

  @CreateDateColumn({ type: 'timestamptz' })
  published_at: Date;

  @Column({ type: 'timestamptz', nullable: false })
  expose_start_at: Date;

  @Column({ type: 'timestamptz', nullable: false })
  expose_end_at: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @OneToMany(() => UpdateEntry, (entry) => entry.notice)
  entries: UpdateEntry[];
}
