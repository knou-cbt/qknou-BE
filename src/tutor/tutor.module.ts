import { Module } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { TutorController } from './tutor.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Questsion])],
    controllers: [TutorController],
    providers: [TutorService],
    exports: [TutorService]
})
export class TutorModule { }
