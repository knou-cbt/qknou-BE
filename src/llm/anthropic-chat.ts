import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

/**
 * 튜터는 OpenAI Chat Completions 형식으로 LLM을 호출하므로, Anthropic 키 사용자를 위해
 * 같은 형식의 요청을 Anthropic Messages API로 바꿔 보내고 응답을 ChatCompletion
 * 모양으로 돌려준다. 튜터가 쓰는 필드(messages, response_format, max_tokens)만 변환함.
 * temperature는 보내지 않음 — 최신 Claude 모델은 기본값이 아닌 sampling 값을 거부한다.
 */
const DEFAULT_MAX_TOKENS = 16_000;
const JSON_INSTRUCTION =
  '응답은 다른 설명이나 코드 블록 없이 유효한 JSON 객체 하나만 출력하세요.';

type ChatParams = Omit<
  OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  'model'
>;

export async function completeWithAnthropic(
  client: Anthropic,
  model: string,
  params: ChatParams,
): Promise<OpenAI.Chat.ChatCompletion> {
  const jsonMode = params.response_format?.type === 'json_object';
  const system: string[] = [];
  const messages: Anthropic.MessageParam[] = [];

  for (const message of params.messages) {
    const text = textOf(message.content);
    if (message.role === 'system' || message.role === 'developer') {
      system.push(text);
    } else if (message.role === 'user' || message.role === 'assistant') {
      // 첫 메시지는 user여야 함
      if (messages.length === 0 && message.role === 'assistant') continue;
      messages.push({ role: message.role, content: text });
    }
  }
  if (jsonMode) system.push(JSON_INSTRUCTION);

  const response = await client.messages.create({
    model,
    max_tokens:
      params.max_completion_tokens ?? params.max_tokens ?? DEFAULT_MAX_TOKENS,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    messages,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: jsonMode ? extractJsonObject(text) : text,
          refusal: null,
        },
        finish_reason:
          response.stop_reason === 'max_tokens' ? 'length' : 'stop',
        logprobs: null,
      },
    ],
  };
}

function textOf(
  content: OpenAI.Chat.ChatCompletionMessageParam['content'],
): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content
    .map((part) =>
      'text' in part && typeof part.text === 'string' ? part.text : '',
    )
    .join('');
}

/** 모델이 ```json 블록으로 감싸거나 앞뒤에 말을 붙여도 JSON.parse가 되도록 객체 부분만 꺼냄 */
function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
