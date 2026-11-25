import { AiKeyVerifier } from './ai-key-verifier';

describe('AiKeyVerifier (fetch 기반 제공사)', () => {
  const verifier = new AiKeyVerifier();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const respond = (status: number) =>
    fetchMock.mockResolvedValue(new Response(null, { status }));

  it('200이면 valid, 요청은 목록 조회 엔드포인트로 키 헤더를 붙여 보낸다', async () => {
    respond(200);
    await expect(verifier.verify('openai', 'sk-test-key')).resolves.toBe(
      'valid',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.headers.Authorization).toBe('Bearer sk-test-key');
  });

  it('401은 invalid, Gemini는 400·403도 invalid', async () => {
    respond(401);
    await expect(verifier.verify('openrouter', 'k')).resolves.toBe('invalid');
    respond(400);
    await expect(verifier.verify('gemini', 'k')).resolves.toBe('invalid');
    respond(403);
    await expect(verifier.verify('gemini', 'k')).resolves.toBe('invalid');
    expect(fetchMock.mock.calls[2][1].headers['x-goog-api-key']).toBe('k');
  });

  it('5xx·429·네트워크 오류는 무효로 단정하지 않고 unavailable', async () => {
    respond(500);
    await expect(verifier.verify('openai', 'k')).resolves.toBe('unavailable');
    respond(429);
    await expect(verifier.verify('openai', 'k')).resolves.toBe('unavailable');
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(verifier.verify('openai', 'k')).resolves.toBe('unavailable');
  });
});
