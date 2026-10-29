import { User } from 'src/users/entities/user.entity';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const USER_LLM_PROVIDERS = ['openai', 'gemini', 'custom'] as const;
export type UserLlmProvider = (typeof USER_LLM_PROVIDERS)[number];

/** 사용자 개인 LLM 설정 (사용자당 1개). AI 튜터 챗봇에서만 사용 */
@Entity('user_llm_settings')
@Index('UQ_user_llm_settings_user_id', ['user_id'], { unique: true })
export class UserLlmSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'varchar', length: 20 })
  provider: UserLlmProvider;

  // provider=custom일 때만 사용. openai/gemini는 서버에 고정된 주소를 씀
  @Column({ type: 'varchar', length: 500, nullable: true })
  base_url: string | null;

  @Column({ type: 'varchar', length: 200 })
  model: string;

  // AES-256-GCM 암호문 (LlmKeyCipher). 평문 저장 금지
  @Column({ type: 'text', nullable: true })
  api_key_encrypted: string | null;

  // 화면 표시용 마스킹(…abcd)에만 사용
  @Column({ type: 'varchar', length: 4, nullable: true })
  api_key_last4: string | null;

  // false면 기본 LLM 사용 (설정은 유지)
  @Column({ type: 'boolean', default: true })
  is_enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
