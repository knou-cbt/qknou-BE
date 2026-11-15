import { ConflictException } from '@nestjs/common';
import { ExplanationBackfillService } from './explanation-backfill.service';

function makeQb(rowsRef: { rows: { id: number }[] }) {
  const state: { lastId: number; take: number } = { lastId: 0, take: 100 };
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn((_sql: string, p: { lastId: number }) => {
      state.lastId = p.lastId;
      return qb;
    }),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn((n: number) => {
      state.take = n;
      return qb;
    }),
    getCount: jest.fn(async () => rowsRef.rows.length),
    getMany: jest.fn(async () =>
      rowsRef.rows.filter((r) => r.id > state.lastId).slice(0, state.take),
    ),
  };
  return qb;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function waitDone(service: ExplanationBackfillService) {
  for (let i = 0; i < 100 && service.getStatus().running; i++) await flush();
}

describe('ExplanationBackfillService', () => {
  it('해설 없는 문제를 모두 생성하고, 실패는 기록 후 건너뛴다', async () => {
    const ref = { rows: [1, 2, 3, 4].map((id) => ({ id })) };
    const repo = { createQueryBuilder: jest.fn(() => makeQb(ref)) };
    const tutor = {
      generateExplanation: jest.fn(async (q: { id: number }) => {
        if (q.id === 3) throw new Error('fail');
        return { explanation: 'x', conceptTags: [] };
      }),
    };
    const service = new ExplanationBackfillService(tutor as any, repo as any);

    const started = await service.start({ concurrency: 2 });
    expect(started.target).toBe(4);
    await expect(service.start({})).rejects.toBeInstanceOf(ConflictException);
    await waitDone(service);

    const s = service.getStatus();
    expect(tutor.generateExplanation).toHaveBeenCalledTimes(4);
    expect(s).toMatchObject({
      running: false,
      succeeded: 3,
      failed: 1,
      failedIds: [3],
      stopReason: 'completed',
    });
  });

  it('LLM이 연속으로 실패하면 스스로 멈춘다', async () => {
    const ref = { rows: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) };
    const repo = { createQueryBuilder: jest.fn(() => makeQb(ref)) };
    const tutor = {
      generateExplanation: jest.fn(async () => {
        throw new Error('down');
      }),
    };
    const service = new ExplanationBackfillService(tutor as any, repo as any);

    await service.start({ concurrency: 1 });
    await waitDone(service);

    expect(tutor.generateExplanation).toHaveBeenCalledTimes(10);
    expect(service.getStatus().stopReason).toBe('too-many-failures');
  });

  it('limit만큼만 생성한다', async () => {
    const ref = { rows: [1, 2, 3, 4, 5].map((id) => ({ id })) };
    const repo = { createQueryBuilder: jest.fn(() => makeQb(ref)) };
    const tutor = {
      generateExplanation: jest.fn(async () => ({
        explanation: 'x',
        conceptTags: [],
      })),
    };
    const service = new ExplanationBackfillService(tutor as any, repo as any);

    await service.start({ limit: 2 });
    await waitDone(service);

    expect(tutor.generateExplanation).toHaveBeenCalledTimes(2);
    expect(service.getStatus().succeeded).toBe(2);
  });
});
