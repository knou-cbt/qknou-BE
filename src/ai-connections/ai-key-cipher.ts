import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 사용자 AI API Key 암호화 (AES-256-GCM).
 * 마스터 키는 AI_KEY_ENCRYPTION_KEY(32바이트, base64 또는 hex 64자)로 받는다.
 * AAD에 "user_id:provider"를 넣어, 암호문을 다른 사용자/제공사 행으로 옮겨 붙이면
 * 복호화가 실패하게 한다.
 * 키를 잃어버리면 저장된 API Key를 복호화할 수 없으니 운영 시크릿과 함께 백업할 것.
 */
export const KEY_VERSION = 1;
const IV_LENGTH = 12;

export interface EncryptedApiKey {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export class AiKeyCipher {
  private constructor(private readonly key: Buffer) {}

  /** 환경변수 값이 없거나 형식이 틀리면 null (기능 비활성화) */
  static fromEnv(raw: string | undefined): AiKeyCipher | null {
    if (!raw) return null;
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    return key.length === 32 ? new AiKeyCipher(key) : null;
  }

  static aad(userId: string, provider: string): Buffer {
    return Buffer.from(`${userId}:${provider}`, 'utf8');
  }

  encrypt(plain: string, aad: Buffer): EncryptedApiKey {
    // iv는 저장할 때마다 새로 생성 (GCM에서 iv 재사용은 금지)
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    return {
      encrypted,
      iv,
      authTag: cipher.getAuthTag(),
      keyVersion: KEY_VERSION,
    };
  }

  decrypt(stored: Omit<EncryptedApiKey, 'keyVersion'>, aad: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, stored.iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(stored.authTag);
    return Buffer.concat([
      decipher.update(stored.encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
