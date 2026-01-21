import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exam } from 'src/exams/entities/exam.entity';
import { Questsion } from 'src/questions/entities/question.entity';
import { SubjectsModule } from 'src/subjects/subjects.module';
import { CrawlerService } from './crawler.service';

@Module({
  imports: [
    // TypeORM 엔티티 등록 (Exam, Question 테이블 사용)
    TypeOrmModule.forFeature([Exam, Questsion]),
    // SubjectsService 사용을 위해 SubjectsModule import
    SubjectsModule,
  ],
  providers: [
    //이 모듈에서 제공하는 서비스
    CrawlerService],
  exports: [
    //다른 모듈에서도 사용할 수 있도록 export 
    CrawlerService]
})
export class CrawlersModule {}