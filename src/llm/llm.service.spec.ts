import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { LlmService } from './llm.service';
import { LlmTarget } from './llm-client';

function makeService(config: Record<string, string>) {
  return new LlmService({
    get: (key: string) => config[key],
  } as unknown as ConfigService);
}

function makeTarget(create: jest.Mock, overrides: Partial<LlmTarget> = {}) {
  return {
    client: { chat: { completions: { create } } } as unknown as OpenAI,
    model: 'm',
    provider: 'openai',
    isPersonal: false,
    ...overrides,
  } as LlmTarget;
}

const ok = { choices: [{ message: { content: 'ok' } }] };

describe('LlmService', () => {
  it('동시 호출 상한과 대기열이 모두 차면 503을 던지고, 끝나면 대기자에게 슬롯을 넘긴다', async () => {
    const service = makeService({
      LLM_MAX_CONCURRENCY: '1',
      LLM_MAX_QUEUE: '1',
    });
    const releases: (() => void)[] = [];
    const create = jest.fn(
      () => new Promise((resolve) => releases.push(() => resolve(ok))),
    );
    const target = makeTarget(create);

    const running = service.complete(target, { messages: [] });
    const queued = service.complete(target, { messages: [] });
    await expect(
      service.complete(target, { messages: [] }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    releases[0]();
    await running;
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(2);
    releases[1]();
    await expect(queued).resolves.toBe(ok);
  });

  it('vLLM일 때만 thinking 끄는 옵션을 붙이고, 모델은 타깃 값을 쓴다', async () => {
    const service = makeService({});
    const create = jest.fn().mockResolvedValue(ok);

    await service.complete(makeTarget(create, { provider: 'vllm' }), {
      messages: [],
    });
    await service.complete(
      makeTarget(create, { provider: 'openai-compatible' }),
      { messages: [] },
    );

    expect(create.mock.calls[0][0]).toMatchObject({
      model: 'm',
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(create.mock.calls[1][0]).not.toHaveProperty('chat_template_kwargs');
  });

  it('개인 LLM 오류는 키/본문 노출 없이 502로 바꾼다', async () => {
    const service = makeService({});
    const create = jest
      .fn()
      .mockRejectedValue(new Error('sk-secret 포함 응답'));

    const error = await service
      .complete(makeTarget(create, { isPersonal: true }), { messages: [] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(error.message).not.toContain('sk-secret');
  });

  it('기본 LLM 오류는 그대로 던진다', async () => {
    const service = makeService({});
    const original = new Error('boom');
    const create = jest.fn().mockRejectedValue(original);

    await expect(
      service.complete(makeTarget(create), { messages: [] }),
    ).rejects.toBe(original);
  });
});
