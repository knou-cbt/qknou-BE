import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ChatLimitGuard } from './chat-limit.guard';
import { LlmSettingsService } from 'src/llm-settings/llm-settings.service';

function context(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('ChatLimitGuard', () => {
  let updateResult: { count: number }[];
  let repository: any;
  let llmSettings: { hasEnabled: jest.Mock };
  let guard: ChatLimitGuard;

  beforeEach(() => {
    updateResult = [];
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(async () => ({ raw: updateResult })),
    };
    repository = {
      createQueryBuilder: jest.fn(() => qb),
      exists: jest.fn().mockResolvedValue(false),
      insert: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue({ count: 2 }),
    };
    llmSettings = { hasEnabled: jest.fn().mockResolvedValue(false) };
    guard = new ChatLimitGuard(
      repository,
      llmSettings as unknown as LlmSettingsService,
    );
  });

  it('오늘 첫 요청이면 행을 만들고 남은 횟수 4', async () => {
    const req: any = { user: { id: 'u1' } };
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', count: 1 }),
    );
    expect(req.remainingCount).toBe(4);
    expect(req.chatCountDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('한도 안이면 원자적으로 증가한 값 기준으로 남은 횟수 계산', async () => {
    updateResult = [{ count: 3 }];
    const req: any = { user: { id: 'u1' } };
    await guard.canActivate(context(req));
    expect(req.remainingCount).toBe(2);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('행이 있는데 증가가 안 되면(한도 도달) 403', async () => {
    repository.exists.mockResolvedValue(true);
    await expect(
      guard.canActivate(context({ user: { id: 'u1' } })),
    ).rejects.toThrow('일일 사용 횟수를 초과');
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('동시 첫 요청으로 unique 위반이 나면 증가로 재시도', async () => {
    repository.insert.mockRejectedValue({ code: '23505' });
    const qb = repository.createQueryBuilder();
    qb.execute
      .mockResolvedValueOnce({ raw: [] })
      .mockResolvedValueOnce({ raw: [{ count: 2 }] });
    const req: any = { user: { id: 'u1' } };
    await guard.canActivate(context(req));
    expect(req.remainingCount).toBe(3);
  });

  it('개인 LLM 사용 중이면 차감하지 않고 통과', async () => {
    llmSettings.hasEnabled.mockResolvedValue(true);
    const req: any = { user: { id: 'u1' } };
    await guard.canActivate(context(req));
    expect(req.usingPersonalLlm).toBe(true);
    expect(req.chatCountDate).toBeUndefined();
    expect(req.remainingCount).toBe(3);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('로그인 안 했으면 403', async () => {
    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
