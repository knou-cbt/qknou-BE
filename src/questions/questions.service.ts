import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Questsion } from './entities/question.entity';
import { formatCodeBlocks } from 'src/common/utils/code-formatter.util';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
  ) {}

  async findByExamId(examId: number): Promise<Questsion[]> {
    const questions = await this.questionRepository.find({
      where: { exam_id: examId },
    });

    // 코드 블록 포맷팅 적용
    return questions.map((q) => ({
      ...q,
      example_text: q.example_text
        ? formatCodeBlocks(q.example_text)
        : q.example_text,
      shared_example: q.shared_example
        ? formatCodeBlocks(q.shared_example)
        : q.shared_example,
    }));
  }
}
