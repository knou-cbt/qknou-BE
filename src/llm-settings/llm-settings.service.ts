import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmService } from 'src/llm/llm.service';
import { LlmConnection, LlmTarget } from 'src/llm/llm-client';
import { UnsafeUrlError, assertSafeLlmBaseUrl } from 'src/llm/safe-url';
import {
  UserLlmProvider,
  UserLlmSetting,
} from './entities/user-llm-setting.entity';
import {
  CreateLlmSettingDto,
  UpdateLlmSettingDto,
} from './dto/llm-setting.dto';
import { LlmKeyCipher } from './llm-key-cipher';

// openai/gemini는 사용자가 주소를 고르지 않고 서버에 고정된 공식 주소만 씀
const PROVIDER_BASE_URLS: Record<Exclude<UserLlmProvider, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
};

export interface LlmSettingView {
  provider: UserLlmProvider;
  baseUrl: string | null;
  model: string;
  /** 예: "…abcd". 키 원문은 어떤 API로도 돌려주지 않음 */
  apiKeyMasked: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class LlmSettingsService {
  private readonly logger = new Logger(LlmSettingsService.name);
  private readonly cipher: LlmKeyCipher | null;

  constructor(
    @InjectRepository(UserLlmSetting)
    private readonly settingRepository: Repository<UserLlmSetting>,
    private readonly llmService: LlmService,
    configService: ConfigService,
  ) {
    this.cipher = LlmKeyCipher.fromEnv(
      configService.get<string>('LLM_KEY_ENCRYPTION_KEY'),
    );
    if (!this.cipher) {
      this.logger.warn(
        'LLM_KEY_ENCRYPTION_KEY 미설정/형식 오류 → 개인 LLM 등록·사용 비활성화',
      );
    }
  }

  async get(userId: string): Promise<LlmSettingView> {
    const setting = await this.settingRepository.findOne({
      where: { user_id: userId },
    });
    if (!setting) {
      throw new NotFoundException('등록된 개인 LLM 설정이 없습니다.');
    }
    return this.toView(setting);
  }

  async create(
    userId: string,
    dto: CreateLlmSettingDto,
  ): Promise<LlmSettingView> {
    const cipher = this.requireCipher();
    const exists = await this.settingRepository.exists({
      where: { user_id: userId },
    });
    if (exists) {
      throw new ConflictException(
        '이미 등록된 개인 LLM 설정이 있습니다. 수정(PATCH)을 사용해주세요.',
      );
    }

    const connection = await this.buildConnection(
      dto.provider,
      dto.baseUrl,
      dto.model,
      dto.apiKey,
    );
    await this.testConnection(connection);

    const setting = this.settingRepository.create({
      user_id: userId,
      provider: dto.provider,
      base_url: dto.provider === 'custom' ? connection.baseURL : null,
      model: dto.model,
      ...this.encryptKey(cipher, dto.apiKey),
      is_enabled: dto.isEnabled ?? true,
    });
    return this.toView(await this.settingRepository.save(setting));
  }

  async update(
    userId: string,
    dto: UpdateLlmSettingDto,
  ): Promise<LlmSettingView> {
    const cipher = this.requireCipher();
    const setting = await this.settingRepository.findOne({
      where: { user_id: userId },
    });
    if (!setting) {
      throw new NotFoundException('등록된 개인 LLM 설정이 없습니다.');
    }

    const provider = dto.provider ?? setting.provider;
    const baseUrl =
      provider === 'custom'
        ? (dto.baseUrl ?? setting.base_url ?? undefined)
        : undefined;
    const model = dto.model ?? setting.model;

    // 주소(provider/baseUrl)가 바뀌는데 키를 새로 안 주면 기존 키를 새 주소로
    // 보내게 됨 → 토큰을 탈취한 사람이 자기 서버로 키를 빼낼 수 있으므로 금지
    const destinationChanged =
      provider !== setting.provider ||
      (provider === 'custom' && baseUrl !== setting.base_url);
    if (destinationChanged && dto.apiKey === undefined) {
      throw new BadRequestException(
        'provider 또는 baseUrl을 바꿀 때는 apiKey를 다시 입력해야 합니다.',
      );
    }

    const connectionChanged =
      destinationChanged || dto.model !== undefined || dto.apiKey !== undefined;
    if (connectionChanged) {
      const apiKey = dto.apiKey ?? this.decryptKey(cipher, setting);
      const connection = await this.buildConnection(
        provider,
        baseUrl,
        model,
        apiKey,
      );
      await this.testConnection(connection);
      setting.base_url = provider === 'custom' ? connection.baseURL : null;
    }

    setting.provider = provider;
    setting.model = model;
    if (dto.apiKey !== undefined) {
      Object.assign(setting, this.encryptKey(cipher, dto.apiKey));
    }
    if (dto.isEnabled !== undefined) {
      setting.is_enabled = dto.isEnabled;
    }
    return this.toView(await this.settingRepository.save(setting));
  }

  async remove(userId: string): Promise<void> {
    const result = await this.settingRepository.delete({ user_id: userId });
    if (!result.affected) {
      throw new NotFoundException('등록된 개인 LLM 설정이 없습니다.');
    }
  }

  async hasEnabled(userId: string): Promise<boolean> {
    if (!this.cipher) return false;
    return this.settingRepository.exists({
      where: { user_id: userId, is_enabled: true },
    });
  }

  /** 챗봇 호출용. 사용 중인 개인 LLM이 없으면 null(=기본 LLM) */
  async resolveTarget(userId: string): Promise<LlmTarget | null> {
    if (!this.cipher) return null;
    const setting = await this.settingRepository.findOne({
      where: { user_id: userId, is_enabled: true },
    });
    if (!setting) return null;

    // 저장 후 DNS가 내부 주소로 바뀌었을 수 있어 호출 때마다 다시 검사
    const connection = await this.buildConnection(
      setting.provider,
      setting.base_url ?? undefined,
      setting.model,
      this.decryptKey(this.cipher, setting),
    );
    return this.llmService.createPersonalTarget(connection);
  }

  private requireCipher(): LlmKeyCipher {
    if (!this.cipher) {
      throw new ServiceUnavailableException(
        '개인 LLM 기능이 현재 비활성화되어 있습니다.',
      );
    }
    return this.cipher;
  }

  private async buildConnection(
    provider: UserLlmProvider,
    baseUrl: string | undefined,
    model: string,
    apiKey: string | undefined,
  ): Promise<LlmConnection> {
    if (provider !== 'custom') {
      if (!apiKey) {
        throw new BadRequestException(`${provider}는 apiKey가 필요합니다.`);
      }
      return {
        provider: 'openai-compatible',
        baseURL: PROVIDER_BASE_URLS[provider],
        apiKey,
        model,
      };
    }

    if (!baseUrl) {
      throw new BadRequestException('custom provider는 baseUrl이 필요합니다.');
    }
    try {
      const url = await assertSafeLlmBaseUrl(baseUrl);
      return {
        provider: 'openai-compatible',
        baseURL: url.toString().replace(/\/$/, ''),
        // 인증 없는 서버도 SDK는 빈 키를 거부하므로 자리표시자
        apiKey: apiKey || 'not-needed',
        model,
      };
    } catch (error) {
      if (error instanceof UnsafeUrlError) {
        throw new BadRequestException(`baseUrl: ${error.message}`);
      }
      throw error;
    }
  }

  /** 저장 전에 실제로 한 번 호출해서 키/모델/주소가 맞는지 확인 */
  private async testConnection(connection: LlmConnection): Promise<void> {
    const target = this.llmService.createPersonalTarget(connection);
    try {
      await this.llmService.complete(target, {
        messages: [{ role: 'user', content: 'Reply with OK.' }],
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException(
        'LLM 연결 확인에 실패했습니다. apiKey, model, baseUrl을 확인해주세요.',
      );
    }
  }

  private encryptKey(
    cipher: LlmKeyCipher,
    apiKey: string | undefined,
  ): Pick<UserLlmSetting, 'api_key_encrypted' | 'api_key_last4'> {
    if (!apiKey) return { api_key_encrypted: null, api_key_last4: null };
    return {
      api_key_encrypted: cipher.encrypt(apiKey),
      // 짧은 키는 끝 4자리만으로도 상당 부분이 드러나서 마스킹 표시를 생략
      api_key_last4: apiKey.length >= 12 ? apiKey.slice(-4) : null,
    };
  }

  private decryptKey(
    cipher: LlmKeyCipher,
    setting: UserLlmSetting,
  ): string | undefined {
    if (!setting.api_key_encrypted) return undefined;
    try {
      return cipher.decrypt(setting.api_key_encrypted);
    } catch {
      // 암호화 키가 바뀌었거나 데이터 손상 — 사용자가 키를 다시 입력해야 함
      this.logger.error(`개인 LLM 키 복호화 실패 (setting ${setting.id})`);
      throw new BadRequestException(
        '저장된 API Key를 읽을 수 없습니다. apiKey를 다시 입력해주세요.',
      );
    }
  }

  private toView(setting: UserLlmSetting): LlmSettingView {
    return {
      provider: setting.provider,
      baseUrl: setting.base_url,
      model: setting.model,
      apiKeyMasked: setting.api_key_last4 ? `…${setting.api_key_last4}` : null,
      isEnabled: setting.is_enabled,
      createdAt: setting.created_at,
      updatedAt: setting.updated_at,
    };
  }
}
