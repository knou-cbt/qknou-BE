import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { TutorService } from './tutor.service';

/** 생성 실패 시 예전 코드가 저장하던 자리표시 문구 — 해설 없음으로 취급 */
export const EXPLANATION_PLACEHOLDER = '해설을 생성하지 못했습니다.';

// LLM이 죽었거나 키 한도가 끝났을 때 계속 두드리지 않도록, 연속 실패가 이만큼이면 중단
const MAX_CONSECUTIVE_FAILURES = 10;
const BATCH_SIZE = 100;

export interface BackfillStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** 이번 실행 대상 수 (시작 시점 기준) */
  target: number;
  succeeded: number;
  failed: number;
  failedIds: number[];
  stopReason: string | null;
}

/**
 * 해설 없는 문제를 서버가 미리 전부 생성해 두는 작업.
 * 시험지를 더 추가하지 않으므로 한 번 채워 두면 사용자 요청 시 LLM을 부를 일이 없다.
 * 상태는 메모리에만 둔다 (재기동하면 초기화되지만, 이미 저장된 해설은 다시 건너뜀).
 */
@Injectable()
export class ExplanationBackfillService {
  private readonly logger = new Logger(ExplanationBackfillService.name);
  private stopRequested = false;
  private status: BackfillStatus = {
    running: false,
    startedAt: null,
    finishedAt: null,
    target: 0,
    succeeded: 0,
    failed: 0,
    failedIds: [],
    stopReason: null,
  };

  constructor(
    private readonly tutorService: TutorService,
    @InjectRepository(Questsion)
    private readonly questionRepository: Repository<Questsion>,
  ) {}

  private missingQuery(): SelectQueryBuilder<Questsion> {
    return this.questionRepository
      .createQueryBuilder('q')
      .where(
        "(q.explanation IS NULL OR TRIM(q.explanation) = '' OR q.explanation = :placeholder)",
        { placeholder: EXPLANATION_PLACEHOLDER },
      );
  }

  countMissing(): Promise<number> {
    return this.missingQuery().getCount();
  }

  getStatus(): BackfillStatus {
    return { ...this.status, failedIds: [...this.status.failedIds] };
  }

  stop(): BackfillStatus {
    if (this.status.running) this.stopRequested = true;
    return this.getStatus();
  }

  /** 백그라운드로 시작하고 바로 반환한다 */
  async start(opts: {
    limit?: number;
    concurrency?: number;
  }): Promise<BackfillStatus> {
    if (this.status.running) {
      throw new ConflictException('이미 해설 생성 작업이 진행 중입니다.');
    }
    const missing = await this.countMissing();
    const target = opts.limit ? Math.min(opts.limit, missing) : missing;

    this.stopRequested = false;
    this.status = {
      running: true,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      target,
      succeeded: 0,
      failed: 0,
      failedIds: [],
      stopReason: null,
    };

    void this.run(target, opts.concurrency ?? 2).catch((error) => {
      this.logger.error('해설 일괄 생성 중단 (예상치 못한 오류)', error);
      this.finish('unexpected-error');
    });
    return this.getStatus();
  }

  private finish(reason: string) {
    this.status.running = false;
    this.status.finishedAt = new Date().toISOString();
    this.status.stopReason = reason;
    this.logger.log(
      `해설 일괄 생성 종료 (${reason}): 성공 ${this.status.succeeded}, 실패 ${this.status.failed}`,
    );
  }

  private async run(target: number, concurrency: number) {
    this.logger.log(
      `해설 일괄 생성 시작: 대상 ${target}건, 동시 ${concurrency}`,
    );
    let lastId = 0;
    let processed = 0;
    let consecutiveFailures = 0;

    while (processed < target) {
      if (this.stopRequested) return this.finish('stopped');

      // id 커서로 진행 → 실패한 문제는 이번 실행에서 다시 집지 않음
      const batch = await this.missingQuery()
        .andWhere('q.id > :lastId', { lastId })
        .orderBy('q.id', 'ASC')
        .take(Math.min(BATCH_SIZE, target - processed))
        .getMany();
      if (batch.length === 0) break;
      lastId = batch[batch.length - 1].id;

      let cursor = 0;
      const worker = async () => {
        while (cursor < batch.length) {
          if (
            this.stopRequested ||
            consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
          )
            return;
          const question = batch[cursor++];
          try {
            await this.tutorService.generateExplanation(question);
            this.status.succeeded++;
            consecutiveFailures = 0;
          } catch {
            this.status.failed++;
            consecutiveFailures++;
            if (this.status.failedIds.length < 500) {
              this.status.failedIds.push(question.id);
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, batch.length) }, worker),
      );
      processed += batch.length;

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return this.finish('too-many-failures');
      }
      this.logger.log(
        `해설 일괄 생성 진행: ${this.status.succeeded + this.status.failed}/${target}`,
      );
    }
    this.finish(this.stopRequested ? 'stopped' : 'completed');
  }
}
