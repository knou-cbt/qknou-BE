import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { LlmService } from 'src/llm/llm.service';
import { LlmConnection, LlmTarget } from 'src/llm/llm-client';
import { userKeyError } from 'src/llm/user-key-error';
import { UserAiConnection } from './entities/user-ai-connection.entity';
import { AiKeyCipher } from './ai-key-cipher';
import { AiKeyVerifier, FETCH_CHECKS } from './ai-key-verifier';
import {
  API_KEY_MAX_LENGTH,
  API_KEY_MIN_LENGTH,
  AiProvider,
  DEFAULT_MODEL_ENV,
  OPENAI_COMPATIBLE_BASE_URLS,
  OPENROUTER_APP_HEADERS,
  maskApiKey,
} from './ai-providers';

export interface AiConnectionView {
  provider: AiProvider;
  /** 예: "sk-p...1234". 키 원문은 어떤 API로도 돌려주지 않음 */
  maskedKey: string;
  connectedAt: Date;
}

export interface AiConnectionsView {
  /** null이면 큐노 기본 AI */
  activeProvider: AiProvider | null;
  connections: AiConnectionView[];
}

@Injectable()
export class AiConnectionsService {
  private readonly logger = new Logger(AiConnectionsService.name);
  private readonly cipher: AiKeyCipher | null;

  constructor(
    @InjectRepository(UserAiConnection)
    private readonly connectionRepository: Repository<UserAiConnection>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly keyVerifier: AiKeyVerifier,
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {
    // 10/29 개인 LLM 기능용으로 만든 LLM_KEY_ENCRYPTION_KEY를 이미 넣어둔 서버도 그대로 동작
    this.cipher = AiKeyCipher.fromEnv(
      configService.get<string>('AI_KEY_ENCRYPTION_KEY') ||
        configService.get<string>('LLM_KEY_ENCRYPTION_KEY'),
    );
    if (!this.cipher) {
      this.logger.warn(
        'AI_KEY_ENCRYPTION_KEY 미설정/형식 오류 → AI 연결(사용자 키) 등록·사용 비활성화',
      );
    }
    const missingModels = Object.values(DEFAULT_MODEL_ENV).filter(
      (key) => !configService.get<string>(key),
    );
    if (missingModels.length) {
      this.logger.warn(
        `${missingModels.join(', ')} 미설정 → 해당 제공사 키로는 튜터 답변 불가`,
      );
    }
  }

  async list(userId: string): Promise<AiConnectionsView> {
    const [user, connections] = await Promise.all([
      this.userRepository.findOne({
        where: { id: userId },
        select: { id: true, activeAiProvider: true },
      }),
      this.connectionRepository.find({
        where: { user_id: userId },
        order: { created_at: 'ASC' },
      }),
    ]);
    return {
      activeProvider: user?.activeAiProvider ?? null,
      connections: connections.map((c) => this.toView(c)),
    };
  }

  async connect(
    userId: string,
    provider: AiProvider,
    rawApiKey: string,
  ): Promise<AiConnectionView> {
    const cipher = this.requireCipher();
    const apiKey = rawApiKey.trim();
    if (
      apiKey.length < API_KEY_MIN_LENGTH ||
      apiKey.length > API_KEY_MAX_LENGTH ||
      /\s/.test(apiKey)
    ) {
      throw new BadRequestException('API Key 형식이 올바르지 않습니다.');
    }

    const check = await this.keyVerifier.verify(provider, apiKey);
    if (check === 'invalid') {
      throw new BadRequestException('제공사가 API Key를 거부했습니다.');
    }
    if (check === 'unavailable') {
      throw new BadGatewayException(
        'AI 제공사에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    const encrypted = cipher.encrypt(apiKey, AiKeyCipher.aad(userId, provider));
    // 재등록은 같은 행을 덮어씀. created_at은 처음 연결할 때만 채워짐
    await this.connectionRepository.upsert(
      {
        user_id: userId,
        provider,
        encrypted_key: encrypted.encrypted,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        masked_key: maskApiKey(apiKey),
        updated_at: new Date(),
      },
      { conflictPaths: ['user_id', 'provider'] },
    );

    // 처음 연결한 키면 바로 그 AI를 쓰도록 전환 (이미 고른 AI가 있으면 그대로)
    await this.userRepository.update(
      { id: userId, activeAiProvider: IsNull() },
      { activeAiProvider: provider },
    );

    const saved = await this.connectionRepository.findOneOrFail({
      where: { user_id: userId, provider },
    });
    return this.toView(saved);
  }

  /** 물리 삭제. 사용 중이던 제공사면 큐노 기본 AI로 되돌림. 없는 연결이어도 성공(멱등) */
  async disconnect(userId: string, provider: AiProvider): Promise<void> {
    await this.connectionRepository.manager.transaction(async (manager) => {
      await manager.delete(UserAiConnection, { user_id: userId, provider });
      await manager.update(
        User,
        { id: userId, activeAiProvider: provider },
        { activeAiProvider: null },
      );
    });
  }

  async setActive(
    userId: string,
    provider: AiProvider | null,
  ): Promise<AiConnectionsView> {
    if (provider) {
      const connected = await this.connectionRepository.exists({
        where: { user_id: userId, provider },
      });
      if (!connected) {
        throw new BadRequestException(
          '연결하지 않은 AI 제공사는 선택할 수 없습니다.',
        );
      }
    }
    await this.userRepository.update(
      { id: userId },
      { activeAiProvider: provider },
    );
    return this.list(userId);
  }

  /** 튜터 챗봇이 사용자 키로 답해야 하면 그 제공사, 아니면 null(=큐노 기본 AI) */
  async getActiveProvider(userId: string): Promise<AiProvider | null> {
    if (!this.cipher) return null;
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { id: true, activeAiProvider: true },
    });
    const provider = user?.activeAiProvider ?? null;
    if (!provider) return null;

    const connected = await this.connectionRepository.exists({
      where: { user_id: userId, provider },
    });
    if (!connected) {
      // 불변식이 깨진 경우(수동 삭제 등) → 기본 AI로 되돌려 둠
      await this.userRepository.update(
        { id: userId, activeAiProvider: provider },
        { activeAiProvider: null },
      );
      return null;
    }
    return provider;
  }

  /** 챗봇 호출용. 사용 중인 사용자 키가 없으면 null(=큐노 기본 AI) */
  async resolveTarget(userId: string): Promise<LlmTarget | null> {
    const provider = await this.getActiveProvider(userId);
    if (!provider || !this.cipher) return null;

    const connection = await this.connectionRepository.findOne({
      where: { user_id: userId, provider },
    });
    if (!connection) return null;

    const model = this.configService.get<string>(DEFAULT_MODEL_ENV[provider]);
    if (!model) {
      this.logger.error(`${DEFAULT_MODEL_ENV[provider]} 미설정`);
      throw userKeyError('AI_PROVIDER_ERROR');
    }

    // 복호화는 제공사 호출 직전에만. 평문은 캐시하거나 로그에 남기지 않음
    return this.llmService.createPersonalTarget(
      this.toLlmConnection(
        provider,
        model,
        this.decryptKey(this.cipher, connection),
      ),
    );
  }

  private toLlmConnection(
    provider: AiProvider,
    model: string,
    apiKey: string,
  ): LlmConnection {
    if (provider === 'anthropic') {
      return { provider: 'anthropic', apiKey, model };
    }
    return {
      provider: 'openai-compatible',
      baseURL: OPENAI_COMPATIBLE_BASE_URLS[provider],
      apiKey,
      model,
      invalidKeyStatuses: FETCH_CHECKS[provider].invalid,
      ...(provider === 'openrouter'
        ? { defaultHeaders: OPENROUTER_APP_HEADERS }
        : {}),
    };
  }

  private decryptKey(
    cipher: AiKeyCipher,
    connection: UserAiConnection,
  ): string {
    try {
      return cipher.decrypt(
        {
          encrypted: connection.encrypted_key,
          iv: connection.iv,
          authTag: connection.auth_tag,
        },
        AiKeyCipher.aad(connection.user_id, connection.provider),
      );
    } catch {
      // 마스터 키가 바뀌었거나 데이터 손상 — 사용자가 다시 연결해야 함
      this.logger.error(`AI 연결 키 복호화 실패 (connection ${connection.id})`);
      throw userKeyError('AI_KEY_INVALID');
    }
  }

  private requireCipher(): AiKeyCipher {
    if (!this.cipher) {
      throw new ServiceUnavailableException(
        'AI 연결 기능이 현재 비활성화되어 있습니다.',
      );
    }
    return this.cipher;
  }

  private toView(connection: UserAiConnection): AiConnectionView {
    return {
      provider: connection.provider,
      maskedKey: connection.masked_key,
      connectedAt: connection.created_at,
    };
  }
}
