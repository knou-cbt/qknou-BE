import { Module } from '@nestjs/common';
import { ChoicesService } from './choices.service';
import { Choice } from './entities/choice.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
   imports: [TypeOrmModule.forFeature([Choice])],
  providers: [ChoicesService],
    exports: [ChoicesService],
})
export class ChoicesModule {}
