import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AiProvider } from '../ai-providers';

/** 사용자가 등록한 AI 제공사 API Key (사용자·제공사당 1개). AI 튜터 챗봇에서만 사용 */
@Entity('user_ai_connections')
@Unique('uq_user_ai_connections', ['user_id', 'provider'])
export class UserAiConnection {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: AiProvider;

  // AES-256-GCM 암호문 (AiKeyCipher, AAD = "user_id:provider"). 평문 저장 금지
  @Column({ type: 'bytea' })
  encrypted_key: Buffer;

  @Column({ type: 'bytea' })
  iv: Buffer;

  @Column({ type: 'bytea' })
  auth_tag: Buffer;

  // 마스터 키 교체 대비
  @Column({ type: 'smallint', default: 1 })
  key_version: number;

  // 화면 표시용 (예: "sk-p...1234")
  @Column({ type: 'varchar', length: 32 })
  masked_key: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
