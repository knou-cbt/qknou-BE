import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { UpdateNotice } from './entities/update-notice.entity';
import { UpdateEntry } from './entities/update-entry.entity';
import { DiscordNotifyModule } from 'src/notifications/discord-notify.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UpdateNotice, UpdateEntry]),
    DiscordNotifyModule,
  ],
  controllers: [NoticesController],
  providers: [NoticesService],
})
export class NoticesModule {}
