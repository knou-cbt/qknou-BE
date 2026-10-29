import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 사용자 LLM API Key 암호화 (AES-256-GCM).
 * 저장 형식: "v1:<iv>:<authTag>:<ciphertext>" (각 base64).
 * 키는 LLM_KEY_ENCRYPTION_KEY(32바이트, base64 또는 hex 64자)로 받는다.
 * 키를 잃어버리면 저장된 API Key를 복호화할 수 없으니 운영 시크릿과 함께 백업할 것.
 */
const VERSION = 'v1';
const IV_LENGTH = 12;

export class LlmKeyCipher {
  private constructor(private readonly key: Buffer) {}

  /** 환경변수 값이 없거나 형식이 틀리면 null (기능 비활성화) */
  static fromEnv(raw: string | undefined): LlmKeyCipher | null {
    if (!raw) return null;
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    return key.length === 32 ? new LlmKeyCipher(key) : null;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== VERSION || !iv || !tag || !data) {
      throw new Error('지원하지 않는 암호문 형식');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
