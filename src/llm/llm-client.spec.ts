import { ConfigService } from '@nestjs/config';
import { resolveDefaultLlmConnection } from './llm-client';

function resolve(config: Record<string, string>) {
  return resolveDefaultLlmConnection({
    get: (key: string) => config[key],
  } as unknown as ConfigService);
}

describe('resolveDefaultLlmConnection', () => {
  it('아무것도 없으면 기존처럼 OpenAI + OPENAI_* 를 쓴다', () => {
    expect(resolve({ OPENAI_API_KEY: 'sk-1', OPENAI_MODEL: 'gpt-x' })).toEqual({
      provider: 'openai',
      baseURL: undefined,
      apiKey: 'sk-1',
      model: 'gpt-x',
    });
  });

  it('기존 VLLM_URL 설정은 vLLM으로 그대로 동작한다', () => {
    expect(
      resolve({
        VLLM_URL: 'http://vllm:8000/v1',
        VLLM_MODEL: 'qwen',
        OPENAI_API_KEY: 'sk-1',
      }),
    ).toEqual({
      provider: 'vllm',
      baseURL: 'http://vllm:8000/v1',
      apiKey: 'not-needed',
      model: 'qwen',
    });
  });

  it('LLM_* 공통 변수가 기존 변수보다 우선한다', () => {
    expect(
      resolve({
        LLM_BASE_URL: 'https://new-llm.example.com/v1',
        LLM_API_KEY: 'k',
        LLM_MODEL: 'new-model',
        VLLM_URL: 'http://vllm:8000/v1',
        OPENAI_API_KEY: 'sk-1',
      }),
    ).toEqual({
      provider: 'openai-compatible',
      baseURL: 'https://new-llm.example.com/v1',
      apiKey: 'k',
      model: 'new-model',
    });
  });

  it('LLM_PROVIDER로 명시하면 그 값을 쓴다', () => {
    expect(
      resolve({ LLM_BASE_URL: 'http://x/v1', LLM_PROVIDER: 'vllm' }).provider,
    ).toBe('vllm');
  });
});
