import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from 'src/llm/llm.module';
import { User } from 'src/users/entities/user.entity';
import { AiConnectionsController } from './ai-connections.controller';
import { AiConnectionsService } from './ai-connections.service';
import { AiKeyVerifier } from './ai-key-verifier';
import { UserAiConnection } from './entities/user-ai-connection.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserAiConnection, User]), LlmModule],
  controllers: [AiConnectionsController],
  providers: [AiConnectionsService, AiKeyVerifier],
  exports: [AiConnectionsService],
})
export class AiConnectionsModule {}
