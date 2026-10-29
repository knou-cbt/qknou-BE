import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from 'src/llm/llm.module';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmSettingsService } from './llm-settings.service';
import { UserLlmSetting } from './entities/user-llm-setting.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserLlmSetting]), LlmModule],
  controllers: [LlmSettingsController],
  providers: [LlmSettingsService],
  exports: [LlmSettingsService],
})
export class LlmSettingsModule {}
