import Anthropic from '@anthropic-ai/sdk';
import { completeWithAnthropic } from './anthropic-chat';

describe('completeWithAnthropic', () => {
  function fakeClient(text: string) {
    const create = jest.fn().mockResolvedValue({
      id: 'msg_1',
      model: 'claude-test',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text }],
    });
    return { client: { messages: { create } } as unknown as Anthropic, create };
  }

  it('system 메시지는 system으로, temperature는 보내지 않고, 응답은 ChatCompletion 모양', async () => {
    const { client, create } = fakeClient('정규화는 ...');
    const result = await completeWithAnthropic(client, 'claude-test', {
      messages: [
        { role: 'system', content: '너는 튜터' },
        { role: 'assistant', content: '맨 앞 assistant는 버림' },
        { role: 'user', content: '정규화가 뭐야?' },
        { role: 'assistant', content: '...' },
        { role: 'user', content: '더 자세히' },
      ],
      temperature: 0.7,
    });

    const params = create.mock.calls[0][0];
    expect(params).toEqual({
      model: 'claude-test',
      max_tokens: expect.any(Number),
      system: '너는 튜터',
      messages: [
        { role: 'user', content: '정규화가 뭐야?' },
        { role: 'assistant', content: '...' },
        { role: 'user', content: '더 자세히' },
      ],
    });
    expect(result.choices[0].message.content).toBe('정규화는 ...');
  });

  it('json_object 모드면 JSON만 출력하라고 지시하고, 코드 블록을 벗겨낸다', async () => {
    const { client, create } = fakeClient(
      '```json\n{"intent":"define","term_candidates":["di"]}\n```',
    );
    const result = await completeWithAnthropic(client, 'claude-test', {
      messages: [{ role: 'user', content: 'DI가 뭐야?' }],
      response_format: { type: 'json_object' },
    });

    expect(create.mock.calls[0][0].system).toContain('JSON');
    expect(JSON.parse(result.choices[0].message.content!)).toEqual({
      intent: 'define',
      term_candidates: ['di'],
    });
  });
});
