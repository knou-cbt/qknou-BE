import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserChatLimit } from '../entities/chat-limit.entity';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { LlmSettingsService } from 'src/llm-settings/llm-settings.service';
import { DAILY_CHAT_LIMIT, kstToday } from '../chat-limit-date';

@Injectable()
export class ChatLimitGuard implements CanActivate {
  private readonly logger = new Logger(ChatLimitGuard.name);

  constructor(
    @InjectRepository(UserChatLimit)
    private chatLimitRepository: Repository<UserChatLimit>,
    private llmSettingsService: LlmSettingsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('로그인이 필요합니다.');
    }

    const today = kstToday();

    try {
      // 개인 LLM을 쓰는 동안은 비용이 사용자 부담이라 일일 횟수에서 차감하지 않음
      // (분당 요청 제한은 컨트롤러의 @Throttle로 그대로 적용)
      if (await this.llmSettingsService.hasEnabled(userId)) {
        request.usingPersonalLlm = true;
        request.remainingCount = await this.currentRemaining(userId, today);
        return true;
      }

      const newCount = await this.consume(userId, today);
      if (newCount === null) {
        throw new ForbiddenException(
          `일일 사용 횟수를 초과했습니다. (${DAILY_CHAT_LIMIT}회 제한)`,
        );
      }

      this.logger.log(
        `사용자 ${userId} 요청 (${newCount}/${DAILY_CHAT_LIMIT})`,
      );
      // LLM 호출이 실패하면 컨트롤러가 이 날짜로 1회 환불
      request.chatCountDate = today;
      request.remainingCount = DAILY_CHAT_LIMIT - newCount;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Chat limit 체크 중 오류:', error);
      throw new ForbiddenException('사용 횟수 확인 중 오류가 발생했습니다.');
    }
  }

  /**
   * 한도 안에서만 1 증가시키고 증가 후 값을 반환. 한도 초과면 null.
   * 이전엔 조회 → 증가가 분리돼 있어 동시 요청이 한도를 넘길 수 있었음.
   */
  private async consume(userId: string, date: string): Promise<number | null> {
    const incremented = await this.incrementIfUnderLimit(userId, date);
    if (incremented !== null) return incremented;

    const exists = await this.chatLimitRepository.exists({
      where: { user_id: userId, date: date as any },
    });
    if (exists) return null;

    try {
      await this.chatLimitRepository.insert({
        user_id: userId,
        date: date as any,
        count: 1,
      });
      return 1;
    } catch (error) {
      // 같은 사용자의 동시 첫 요청이 먼저 행을 만든 경우(unique 위반) → 증가로 재시도
      if (error?.code === '23505') {
        return this.incrementIfUnderLimit(userId, date);
      }
      throw error;
    }
  }

  private async incrementIfUnderLimit(
    userId: string,
    date: string,
  ): Promise<number | null> {
    const result = await this.chatLimitRepository
      .createQueryBuilder()
      .update()
      .set({ count: () => 'count + 1' })
      .where('user_id = :userId AND date = :date AND count < :limit', {
        userId,
        date,
        limit: DAILY_CHAT_LIMIT,
      })
      .returning('count')
      .execute();
    const row = (result.raw as { count: number }[])[0];
    return row ? Number(row.count) : null;
  }

  private async currentRemaining(
    userId: string,
    date: string,
  ): Promise<number> {
    const limit = await this.chatLimitRepository.findOne({
      where: { user_id: userId, date: date as any },
    });
    return Math.max(0, DAILY_CHAT_LIMIT - (limit?.count ?? 0));
  }
}
