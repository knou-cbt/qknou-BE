import { randomBytes } from 'node:crypto';
import { LlmKeyCipher } from './llm-key-cipher';

describe('LlmKeyCipher', () => {
  const key = randomBytes(32);

  it('암호화한 값을 복호화하면 원문이 나오고, 암호문에 원문이 없다', () => {
    const cipher = LlmKeyCipher.fromEnv(key.toString('base64'))!;
    const stored = cipher.encrypt('sk-test-1234567890');

    expect(stored).not.toContain('sk-test');
    expect(stored.startsWith('v1:')).toBe(true);
    expect(cipher.decrypt(stored)).toBe('sk-test-1234567890');
  });

  it('같은 값도 매번 다른 암호문이 된다 (IV 랜덤)', () => {
    const cipher = LlmKeyCipher.fromEnv(key.toString('hex'))!;
    expect(cipher.encrypt('a')).not.toBe(cipher.encrypt('a'));
  });

  it('암호문이 변조되면 복호화에 실패한다', () => {
    const cipher = LlmKeyCipher.fromEnv(key.toString('base64'))!;
    const [v, iv, tag, data] = cipher.encrypt('secret').split(':');
    const tampered = [v, iv, tag, Buffer.from('xxxxxx').toString('base64')];
    expect(() => cipher.decrypt(tampered.join(':'))).toThrow();
    expect(data).toBeTruthy();
  });

  it('다른 키로는 복호화할 수 없다', () => {
    const stored = LlmKeyCipher.fromEnv(key.toString('base64'))!.encrypt('s');
    const other = LlmKeyCipher.fromEnv(randomBytes(32).toString('base64'))!;
    expect(() => other.decrypt(stored)).toThrow();
  });

  it('키가 없거나 32바이트가 아니면 null', () => {
    expect(LlmKeyCipher.fromEnv(undefined)).toBeNull();
    expect(LlmKeyCipher.fromEnv('short')).toBeNull();
  });
});
