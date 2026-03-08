import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserChatLimit } from '../entities/chat-limit.entity';

@Injectable()
export class ChatLimitGuard implements CanActivate {
  private readonly logger = new Logger(ChatLimitGuard.name);
  private readonly DAILY_LIMIT = 5;

  constructor(
    @InjectRepository(UserChatLimit)
    private chatLimitRepository: Repository<UserChatLimit>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('로그인이 필요합니다.');
    }

    const today = new Date().toISOString().split('T')[0];

    try {
      let userLimit = await this.chatLimitRepository.findOne({
        where: { user_id: userId, date: today as any },
      });

      if (!userLimit) {
        userLimit = this.chatLimitRepository.create({
          user_id: userId,
          date: today as any,
          count: 1,
        });
        await this.chatLimitRepository.save(userLimit);

        this.logger.log(`사용자 ${userId} 첫 요청 (1/${this.DAILY_LIMIT})`);

        request.remainingCount = this.DAILY_LIMIT - 1;
        return true;
      }

      if (userLimit.count >= this.DAILY_LIMIT) {
        throw new ForbiddenException(
          `일일 사용 횟수를 초과했습니다. (${this.DAILY_LIMIT}회 제한)`,
        );
      }

      await this.chatLimitRepository.increment(
        { id: userLimit.id },
        'count',
        1,
      );

      const newCount = userLimit.count + 1;
      this.logger.log(
        `사용자 ${userId} 요청 (${newCount}/${this.DAILY_LIMIT})`,
      );

      request.remainingCount = this.DAILY_LIMIT - newCount;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Chat limit 체크 중 오류:', error);
      throw new ForbiddenException('사용 횟수 확인 중 오류가 발생했습니다.');
    }
  }
}
