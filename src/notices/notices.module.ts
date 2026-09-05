import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';
import { UpdateNotice } from './entities/update-notice.entity';
import { UpdateEntry } from './entities/update-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UpdateNotice, UpdateEntry])],
  controllers: [NoticesController],
  providers: [NoticesService],
})
export class NoticesModule {}
