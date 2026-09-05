import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class DiscordNotifyService {
  private readonly logger = new Logger(DiscordNotifyService.name);

  constructor(private configService: ConfigService) {}

  /**
   * Discord Incoming Webhook으로 알림 전송. 실패해도 throw하지 않는다
   * (Discord 장애가 피드백 접수 자체를 실패시키면 안 되므로).
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
