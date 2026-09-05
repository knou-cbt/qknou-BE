import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserFeedbackLimit } from '../entities/feedback-limit.entity';

@Injectable()
export class FeedbackLimitGuard implements CanActivate {
  private readonly logger = new Logger(FeedbackLimitGuard.name);
  private readonly DAILY_LIMIT = 15;

  constructor(
    @InjectRepository(UserFeedbackLimit)
    private feedbackLimitRepository: Repository<UserFeedbackLimit>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('로그인이 필요합니다.');
    }

    const today = new Date().toISOString().split('T')[0];

    try {
      let userLimit = await this.feedbackLimitRepository.findOne({
        where: { user_id: userId, date: today as any },
      });

      if (!userLimit) {
        userLimit = this.feedbackLimitRepository.create({
          user_id: userId,
          date: today as any,
          count: 1,
        });
        await this.feedbackLimitRepository.save(userLimit);

        request.remainingCount = this.DAILY_LIMIT - 1;
        return true;
      }

      if (userLimit.count >= this.DAILY_LIMIT) {
        throw new ForbiddenException(
          `일일 피드백 제출 횟수를 초과했습니다. (${this.DAILY_LIMIT}회 제한)`,
        );
      }

      await this.feedbackLimitRepository.increment(
        { id: userLimit.id },
        'count',
        1,
      );

      request.remainingCount = this.DAILY_LIMIT - (userLimit.count + 1);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Feedback limit 체크 중 오류:', error);
      throw new ForbiddenException('사용 횟수 확인 중 오류가 발생했습니다.');
    }
  }
}
