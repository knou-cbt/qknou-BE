import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  LlmConnection,
  LlmTarget,
  createLlmClient,
  resolveDefaultLlmConnection,
  withProviderParams,
} from './llm-client';

// 동시에 LLM으로 나가는 요청 수 상한과, 그걸 넘었을 때 대기열 길이.
// 대기열까지 차면 즉시 503으로 돌려보내 서버가 밀린 요청을 쌓아두지 않게 함.
// 기본 LLM과 개인 LLM 호출이 같은 상한을 공유한다(둘 다 이 서버의 커넥션을 씀).
const DEFAULT_LLM_MAX_CONCURRENCY = 5;
const DEFAULT_LLM_MAX_QUEUE = 20;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  readonly defaultTarget: LlmTarget;
  private readonly maxConcurrency: number;
  private readonly maxQueue: number;
  private activeCount = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly configService: ConfigService) {
    const connection = resolveDefaultLlmConnection(configService);
    this.defaultTarget = {
      client: createLlmClient(connection, configService),
      model: connection.model,
      provider: connection.provider,
      isPersonal: false,
    };
    this.logger.log(
      `기본 LLM: ${connection.provider} / ${connection.model}${connection.baseURL ? ` (${connection.baseURL})` : ''}`,
    );

    this.maxConcurrency = Number(
      configService.get('LLM_MAX_CONCURRENCY') ?? DEFAULT_LLM_MAX_CONCURRENCY,
    );
    this.maxQueue = Number(
      configService.get('LLM_MAX_QUEUE') ?? DEFAULT_LLM_MAX_QUEUE,
    );
  }

  /** 사용자 개인 LLM용 타깃. 재시도 없이 바로 실패하고, 리다이렉트는 따라가지 않음(SSRF 방지) */
  createPersonalTarget(connection: LlmConnection): LlmTarget {
    return {
      client: createLlmClient(connection, this.configService, {
        maxRetries: 0,
        fetchOptions: { redirect: 'error' },
      }),
      model: connection.model,
      provider: connection.provider,
      isPersonal: true,
    };
  }

  async complete(
    target: LlmTarget,
    params: Omit<OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, 'model'>,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    await this.acquireSlot();
    try {
      return await target.client.chat.completions.create(
        withProviderParams(target.provider, {
          ...params,
          model: target.model,
        }),
      );
    } catch (error) {
      // 개인 LLM 오류(키 만료·모델명 오타 등)는 서버 장애가 아니라 사용자 설정 문제라
      // 500 대신 502 + 원인을 알려줌. 응답 본문/키는 노출하지 않음.
      if (target.isPersonal) {
        const status =
          error instanceof OpenAI.APIError && error.status
            ? ` (응답 코드 ${error.status})`
            : '';
        throw new BadGatewayException(
          `등록한 개인 LLM 호출에 실패했습니다${status}. 설정을 확인해주세요.`,
        );
      }
      throw error;
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount++;
      return;
    }
    if (this.waiters.length >= this.maxQueue) {
      this.logger.warn(
        `LLM 요청 대기열 초과 (동시 ${this.activeCount}, 대기 ${this.waiters.length})`,
      );
      throw new ServiceUnavailableException(
        'AI 튜터 요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      );
    }
    // 슬롯은 releaseSlot에서 대기자에게 그대로 넘겨지므로 여기서 카운트를 올리지 않음
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.activeCount--;
    }
  }
}
