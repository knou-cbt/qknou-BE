import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Questsion } from './entities/question.entity';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
  ) {}

  async findByExamId(examId: number): Promise<Questsion[]> {
    return this.questionRepository.find({
      where: { exam_id: examId }
    });
  }
}
