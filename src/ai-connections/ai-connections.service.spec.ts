import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { LlmService } from 'src/llm/llm.service';
import { AiConnectionsService } from './ai-connections.service';
import { AiKeyVerifier } from './ai-key-verifier';
import { UserAiConnection } from './entities/user-ai-connection.entity';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const API_KEY = 'sk-proj-abcdefgh1234';
const ENV: Record<string, string> = {
  AI_KEY_ENCRYPTION_KEY: ENCRYPTION_KEY,
  AI_DEFAULT_MODEL_OPENAI: 'gpt-test',
  AI_DEFAULT_MODEL_ANTHROPIC: 'claude-test',
  AI_DEFAULT_MODEL_GEMINI: 'gemini-test',
  AI_DEFAULT_MODEL_OPENROUTER: 'free:free',
};

describe('AiConnectionsService', () => {
  let rows: UserAiConnection[];
  let users: Record<string, { id: string; activeAiProvider: string | null }>;
  let verifier: { verify: jest.Mock };
  let llmService: { createPersonalTarget: jest.Mock };

  // where 조건 비교. IsNull()은 FindOperator로 들어옴
  const matches = (row: any, where: any) =>
    Object.entries(where).every(([k, v]) =>
      v instanceof FindOperator && v.type === 'isNull'
        ? row[k] == null
        : row[k] === v,
    );

  const connectionRepo = () => ({
    find: jest.fn(async ({ where }) => rows.filter((r) => matches(r, where))),
    findOne: jest.fn(
      async ({ where }) => rows.find((r) => matches(r, where)) ?? null,
    ),
    findOneOrFail: jest.fn(async ({ where }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      return row;
    }),
    exists: jest.fn(async ({ where }) => rows.some((r) => matches(r, where))),
    upsert: jest.fn(async (values: any) => {
      const existing = rows.find(
        (r) => r.user_id === values.user_id && r.provider === values.provider,
      );
      if (existing) {
        Object.assign(existing, values);
      } else {
        rows.push({
          id: String(rows.length + 1),
          created_at: new Date(),
          ...values,
        });
      }
    }),
    manager: {
      transaction: jest.fn(async (work) =>
        work({
          delete: jest.fn(async (_entity, where) => {
            rows = rows.filter((r) => !matches(r, where));
          }),
          update: jest.fn(async (_entity, where, set) =>
            updateUsers(where, set),
          ),
        }),
      ),
    },
  });

  function updateUsers(where: any, set: any) {
    Object.values(users)
      .filter((u) => matches(u, where))
      .forEach((u) => Object.assign(u, set));
  }

  const userRepo = () => ({
    findOne: jest.fn(async ({ where }) => users[where.id] ?? null),
    update: jest.fn(async (where, set) => updateUsers(where, set)),
  });

  function makeService(env: Record<string, string> = ENV) {
    return new AiConnectionsService(
      connectionRepo() as any,
      userRepo() as any,
      verifier as unknown as AiKeyVerifier,
      llmService as unknown as LlmService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    rows = [];
    users = {
      u1: { id: 'u1', activeAiProvider: null },
      u2: { id: 'u2', activeAiProvider: null },
    };
    verifier = { verify: jest.fn().mockResolvedValue('valid') };
    llmService = {
      createPersonalTarget: jest.fn((c) => ({ ...c, isPersonal: true })),
    };
  });

  it('연결이 없으면 activeProvider null, connections 빈 배열', async () => {
    await expect(makeService().list('u1')).resolves.toEqual({
      activeProvider: null,
      connections: [],
    });
  });

  it('유효 키 저장 → 응답·목록에 maskedKey만 있고 평문이 없으며, DB에도 평문이 없다', async () => {
    const service = makeService();
    const view = await service.connect('u1', 'openai', `  ${API_KEY}\n`);

    expect(view).toEqual({
      provider: 'openai',
      maskedKey: 'sk-p...1234',
      connectedAt: expect.any(Date),
    });
    expect(verifier.verify).toHaveBeenCalledWith('openai', API_KEY);
    const list = await service.list('u1');
    expect(JSON.stringify([view, list])).not.toContain(API_KEY);
    expect(rows[0].encrypted_key.toString('utf8')).not.toContain(API_KEY);
    // 처음 연결한 키면 사용할 AI로 자동 선택
    expect(list.activeProvider).toBe('openai');
  });

  it('형식 오류·무효 키는 400, 제공사 장애는 502이고 저장하지 않는다', async () => {
    const service = makeService();
    await expect(
      service.connect('u1', 'openai', ' short '),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.connect('u1', 'openai', 'x'.repeat(513)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verifier.verify).not.toHaveBeenCalled();

    verifier.verify.mockResolvedValue('invalid');
    await expect(
      service.connect('u1', 'openai', API_KEY),
    ).rejects.toBeInstanceOf(BadRequestException);
    verifier.verify.mockResolvedValue('unavailable');
    await expect(
      service.connect('u1', 'openai', API_KEY),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(rows).toHaveLength(0);
  });

  it('같은 provider 재등록 → 행 1개 유지, 키 교체, connectedAt 유지', async () => {
    const service = makeService();
    const first = await service.connect('u1', 'gemini', 'AIzaSyD-first-x9Qk');
    const second = await service.connect('u1', 'gemini', 'AIzaSyD-second-zzzz');

    expect(rows).toHaveLength(1);
    expect(second.maskedKey).toBe('AIza...zzzz');
    expect(second.connectedAt).toBe(first.connectedAt);
  });

  it('이미 다른 AI를 쓰는 중이면 새로 연결해도 선택은 그대로', async () => {
    const service = makeService();
    await service.connect('u1', 'gemini', 'AIzaSyD-first-x9Qk');
    await service.connect('u1', 'openai', API_KEY);
    expect(users.u1.activeAiProvider).toBe('gemini');
  });

  it('사용 중인 provider 삭제 → 행이 지워지고 activeProvider가 null', async () => {
    const service = makeService();
    await service.connect('u1', 'openai', API_KEY);
    await service.disconnect('u1', 'openai');

    expect(rows).toHaveLength(0);
    await expect(service.list('u1')).resolves.toEqual({
      activeProvider: null,
      connections: [],
    });
    // 없는 연결 삭제도 성공 (멱등)
    await expect(service.disconnect('u1', 'openai')).resolves.toBeUndefined();
  });

  it('사용 중이 아닌 provider 삭제는 선택을 바꾸지 않는다', async () => {
    const service = makeService();
    await service.connect('u1', 'gemini', 'AIzaSyD-first-x9Qk');
    await service.connect('u1', 'openai', API_KEY);
    await service.disconnect('u1', 'openai');
    expect(users.u1.activeAiProvider).toBe('gemini');
  });

  it('연결 없는 provider로 선택하면 400, null이면 기본 AI로', async () => {
    const service = makeService();
    await expect(service.setActive('u1', 'anthropic')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.connect('u1', 'openai', API_KEY);
    const view = await service.setActive('u1', null);
    expect(view.activeProvider).toBeNull();
    expect(view.connections).toHaveLength(1);
  });

  it('다른 사용자의 연결은 보이지도, 선택되지도 않는다', async () => {
    const service = makeService();
    await service.connect('u1', 'openai', API_KEY);

    await expect(service.list('u2')).resolves.toEqual({
      activeProvider: null,
      connections: [],
    });
    await expect(service.setActive('u2', 'openai')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.disconnect('u2', 'openai');
    expect(rows).toHaveLength(1);
  });

  it('사용 중인 키는 복호화해서 제공사별 주소·기본 모델로 타깃을 만든다', async () => {
    const service = makeService();
    await service.connect('u1', 'openrouter', 'sk-or-v1-abcdef123456');

    await service.resolveTarget('u1');
    expect(llmService.createPersonalTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'openai-compatible',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-v1-abcdef123456',
        model: 'free:free',
        invalidKeyStatuses: [401, 403],
        defaultHeaders: expect.objectContaining({ 'X-Title': 'QKNOU' }),
      }),
    );

    await service.connect('u1', 'anthropic', 'sk-ant-api03-abcdef');
    await service.setActive('u1', 'anthropic');
    await service.resolveTarget('u1');
    expect(llmService.createPersonalTarget).toHaveBeenLastCalledWith({
      provider: 'anthropic',
      apiKey: 'sk-ant-api03-abcdef',
      model: 'claude-test',
    });
  });

  it('암호문을 다른 사용자 행으로 복사하면 복호화에 실패한다 (AAD) → AI_KEY_INVALID', async () => {
    const service = makeService();
    await service.connect('u1', 'openai', API_KEY);
    await service.connect('u2', 'openai', 'sk-proj-other-user-key');
    const [u1Row, u2Row] = rows;
    Object.assign(u2Row, {
      encrypted_key: u1Row.encrypted_key,
      iv: u1Row.iv,
      auth_tag: u1Row.auth_tag,
    });

    const error = await service.resolveTarget('u2').catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse().code).toBe('AI_KEY_INVALID');
  });

  it('선택한 provider 행이 사라졌으면 기본 AI로 되돌린다', async () => {
    const service = makeService();
    users.u1.activeAiProvider = 'gemini';
    await expect(service.getActiveProvider('u1')).resolves.toBeNull();
    expect(users.u1.activeAiProvider).toBeNull();
  });

  it('암호화 키가 없으면 저장은 503, 사용은 기본 AI로', async () => {
    const service = makeService({ ...ENV, AI_KEY_ENCRYPTION_KEY: '' });
    await expect(
      service.connect('u1', 'openai', API_KEY),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    users.u1.activeAiProvider = 'openai';
    await expect(service.resolveTarget('u1')).resolves.toBeNull();
  });

  it('예전 LLM_KEY_ENCRYPTION_KEY만 있어도 동작한다', async () => {
    const service = makeService({
      ...ENV,
      AI_KEY_ENCRYPTION_KEY: '',
      LLM_KEY_ENCRYPTION_KEY: ENCRYPTION_KEY,
    });
    await expect(
      service.connect('u1', 'openai', API_KEY),
    ).resolves.toBeTruthy();
  });
});
