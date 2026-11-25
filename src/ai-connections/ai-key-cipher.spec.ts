import { randomBytes } from 'node:crypto';
import { AiKeyCipher } from './ai-key-cipher';

describe('AiKeyCipher', () => {
  const key = randomBytes(32);
  const aad = AiKeyCipher.aad('u1', 'openai');

  it('암호화한 값을 복호화하면 원문이 나오고, 암호문에 원문이 없다', () => {
    const cipher = AiKeyCipher.fromEnv(key.toString('base64'))!;
    const stored = cipher.encrypt('sk-test-1234567890', aad);

    expect(stored.encrypted.toString('utf8')).not.toContain('sk-test');
    expect(stored.iv).toHaveLength(12);
    expect(stored.authTag).toHaveLength(16);
    expect(cipher.decrypt(stored, aad)).toBe('sk-test-1234567890');
  });

  it('같은 값도 매번 다른 iv·암호문이 된다', () => {
    const cipher = AiKeyCipher.fromEnv(key.toString('hex'))!;
    const a = cipher.encrypt('a', aad);
    const b = cipher.encrypt('a', aad);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.encrypted.equals(b.encrypted)).toBe(false);
  });

  it('다른 사용자·제공사 행으로 옮긴 암호문은 복호화에 실패한다 (AAD)', () => {
    const cipher = AiKeyCipher.fromEnv(key.toString('base64'))!;
    const stored = cipher.encrypt('secret-key', aad);
    expect(() =>
      cipher.decrypt(stored, AiKeyCipher.aad('u2', 'openai')),
    ).toThrow();
    expect(() =>
      cipher.decrypt(stored, AiKeyCipher.aad('u1', 'gemini')),
    ).toThrow();
  });

  it('암호문이 변조되면 복호화에 실패한다', () => {
    const cipher = AiKeyCipher.fromEnv(key.toString('base64'))!;
    const stored = cipher.encrypt('secret', aad);
    stored.encrypted[0] ^= 0xff;
    expect(() => cipher.decrypt(stored, aad)).toThrow();
  });

  it('다른 마스터 키로는 복호화할 수 없다', () => {
    const stored = AiKeyCipher.fromEnv(key.toString('base64'))!.encrypt(
      's',
      aad,
    );
    const other = AiKeyCipher.fromEnv(randomBytes(32).toString('base64'))!;
    expect(() => other.decrypt(stored, aad)).toThrow();
  });

  it('키가 없거나 32바이트가 아니면 null', () => {
    expect(AiKeyCipher.fromEnv(undefined)).toBeNull();
    expect(AiKeyCipher.fromEnv('short')).toBeNull();
  });
});
