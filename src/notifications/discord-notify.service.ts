import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Discord Incoming Webhook 알림 전송. 피드백/업데이트 알림 등 여러
 * 기능이 공용으로 쓰는 서비스라 feedbacks 밖으로 뺐다.
 */
@Injectable()
export class DiscordNotifyService {
  private readonly logger = new Logger(DiscordNotifyService.name);

  constructor(private configService: ConfigService) {}

  /**
   * 실패해도 throw하지 않는다 (Discord 장애가 호출부의 본 기능을
   * 실패시키면 안 되므로).
   */
  async notify(message: string): Promise<void> {
    const webhookUrl = this.configService.get('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn(
        'DISCORD_WEBHOOK_URL이 설정되지 않아 알림을 건너뜁니다.',
      );
      return;
    }

    try {
      await axios.post(webhookUrl, { content: message }, { timeout: 5000 });
    } catch (error: any) {
      this.logger.error(
        'Discord 알림 전송 실패',
        error?.response?.data ?? error?.message ?? error,
      );
    }
  }
}
