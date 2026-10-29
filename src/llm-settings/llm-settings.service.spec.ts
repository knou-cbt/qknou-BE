import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmSettingsService } from './llm-settings.service';
import { UserLlmSetting } from './entities/user-llm-setting.entity';
import { LlmService } from 'src/llm/llm.service';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const API_KEY = 'sk-test-abcdefgh1234';

describe('LlmSettingsService', () => {
  let rows: UserLlmSetting[];
  let repository: any;
  let llmService: { complete: jest.Mock; createPersonalTarget: jest.Mock };

  function makeService(encryptionKey: string | undefined = ENCRYPTION_KEY) {
    return new LlmSettingsService(
      repository,
      llmService as unknown as LlmService,
      {
        get: (k: string) =>
          k === 'LLM_KEY_ENCRYPTION_KEY' ? encryptionKey : undefined,
      } as unknown as ConfigService,
    );
  }

  const match = (where: any) => (r: UserLlmSetting) =>
    Object.entries(where).every(([k, v]) => (r as any)[k] === v);

  beforeEach(() => {
    rows = [];
    repository = {
      findOne: jest.fn(async ({ where }) => rows.find(match(where)) ?? null),
      exists: jest.fn(async ({ where }) => rows.some(match(where))),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (v) => {
        const saved = {
          id: 1,
          created_at: new Date(),
          updated_at: new Date(),
          ...v,
        };
        rows = [...rows.filter((r) => r.user_id !== v.user_id), saved];
        return saved;
      }),
      delete: jest.fn(async (where) => {
        const before = rows.length;
        rows = rows.filter((r) => !match(where)(r));
        return { affected: before - rows.length };
      }),
    };
    llmService = {
      complete: jest.fn().mockResolvedValue({}),
      createPersonalTarget: jest.fn((c) => ({ ...c, isPersonal: true })),
    };
  });

  it('등록하면 키는 암호화돼 저장되고 응답에는 끝 4자리만 나온다', async () => {
    const service = makeService();
    const view = await service.create('u1', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: API_KEY,
    });

    expect(view.apiKeyMasked).toBe('…1234');
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(rows[0].api_key_encrypted).not.toContain(API_KEY);
    expect(rows[0].base_url).toBeNull();
    // 저장 전 연결 확인 호출
    expect(llmService.complete).toHaveBeenCalledTimes(1);
  });

  it('연결 확인에 실패하면 저장하지 않는다', async () => {
    llmService.complete.mockRejectedValue(new Error('401'));
    await expect(
      makeService().create('u1', {
        provider: 'openai',
        model: 'm',
        apiKey: API_KEY,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rows).toHaveLength(0);
  });

  it('이미 있으면 409, openai는 apiKey 필수, custom 내부 주소는 거부', async () => {
    const service = makeService();
    await service.create('u1', {
      provider: 'openai',
      model: 'm',
      apiKey: API_KEY,
    });

    await expect(
      service.create('u1', { provider: 'openai', model: 'm', apiKey: API_KEY }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.create('u2', { provider: 'openai', model: 'm' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create('u3', {
        provider: 'custom',
        baseUrl: 'https://169.254.169.254/v1',
        model: 'm',
      }),
    ).rejects.toThrow('내부 주소');
  });

  it('다른 사용자의 설정은 조회·수정·삭제할 수 없다', async () => {
    const service = makeService();
    await service.create('owner', {
      provider: 'openai',
      model: 'm',
      apiKey: API_KEY,
    });

    await expect(service.get('other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.update('other', { isEnabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_enabled).toBe(true);
  });

  it('provider/baseUrl을 바꾸면서 apiKey를 안 주면 거부 (기존 키를 새 주소로 보내지 않음)', async () => {
    const service = makeService();
    await service.create('u1', {
      provider: 'openai',
      model: 'm',
      apiKey: API_KEY,
    });

    await expect(service.update('u1', { provider: 'gemini' })).rejects.toThrow(
      'apiKey를 다시',
    );
  });

  it('isEnabled만 바꾸면 연결 확인 없이 전환된다', async () => {
    const service = makeService();
    await service.create('u1', {
      provider: 'openai',
      model: 'm',
      apiKey: API_KEY,
    });
    llmService.complete.mockClear();

    const view = await service.update('u1', { isEnabled: false });

    expect(view.isEnabled).toBe(false);
    expect(llmService.complete).not.toHaveBeenCalled();
    expect(await service.resolveTarget('u1')).toBeNull();
  });

  it('사용 중인 설정은 복호화된 키로 개인 타깃을 만든다', async () => {
    const service = makeService();
    await service.create('u1', {
      provider: 'gemini',
      model: 'g',
      apiKey: API_KEY,
    });

    await service.resolveTarget('u1');

    expect(llmService.createPersonalTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: API_KEY,
        model: 'g',
        baseURL: expect.stringContaining('generativelanguage.googleapis.com'),
      }),
    );
  });

  it('암호화 키가 없으면 등록은 503, 사용은 기본 LLM으로', async () => {
    const service = makeService('');
    await expect(
      service.create('u1', { provider: 'openai', model: 'm', apiKey: API_KEY }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await service.hasEnabled('u1')).toBe(false);
    expect(await service.resolveTarget('u1')).toBeNull();
  });
});
