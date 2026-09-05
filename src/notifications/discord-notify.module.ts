import { Module } from '@nestjs/common';
import { DiscordNotifyService } from './discord-notify.service';

@Module({
  providers: [DiscordNotifyService],
  exports: [DiscordNotifyService],
})
export class DiscordNotifyModule {}
