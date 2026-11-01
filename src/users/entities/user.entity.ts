import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AiProvider } from 'src/ai-connections/ai-providers';

/**
 * provider, providerId를 저장해야 나중에 '이 사용자가 어떤걸로 로그인했는지' 알 수 있다.
 * email이 nullable인 이유: 카카오는 이메일 제공을 거부할 수 있기 때문
 */

//테이블 구조 정의
@Entity('users')
export class User {
  //UUID를 기본키로 사용
  @PrimaryGeneratedColumn('uuid')
  id: string;

  //중복 x , OAuth 로그인은 이메일이 없을 수도 있어서 nullable:true
  @Column({ unique: true, nullable: true })
  email: string;

  //사용자 이름(구글/카카오에서 가져옴)
  @Column({ nullable: true })
  name: string;

  //프로필 이미지 URL (구글/카카오에서 가져옴)
  @Column({ nullable: true })
  profileImage: string;

  //어떤 방법으로 가입했는지(google, kakao)
  @Column({ type: 'varchar', length: 50 })
  provider: string;
  // OAuth 제공자의 사용자 고유 ID
  @Column({ nullable: true })
  providerId: string;

  // 튜터가 쓸 AI 제공사. null이면 큐노 기본 AI (src/ai-connections)
  // 값이 있으면 user_ai_connections에 같은 provider 행이 반드시 있어야 함
  @Column({
    name: 'active_ai_provider',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  activeAiProvider: AiProvider | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
