import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Questsion } from './entities/question.entity';
import { formatCodeBlocks } from 'src/common/utils/code-formatter.util';
import { BookmarksService } from 'src/bookmarks/bookmarks.service';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    private bookmarksService: BookmarksService,
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

  /**
   * 문항 단건 공개 조회 (암기모드 화면 진입 / 공유 링크 진입점)
   * 로그인 없이도 조회 가능. userId가 있으면 isBookmarked를 채운다.
   */
  async findOnePublic(id: number, userId?: string) {
    const question = await this.questionRepository.findOne({
      where: { id },
      relations: ['exam', 'exam.subject'],
    });
    if (!question) {
      throw new NotFoundException(`문항 id ${id}를 찾을 수 없습니다.`);
    }

    const isBookmarked = userId
      ? await this.bookmarksService.isBookmarked(userId, id)
      : null;

    return {
      id: question.id,
      questionNumber: question.question_number,
      text: question.question_text,
      example: question.example_text
        ? formatCodeBlocks(question.example_text)
        : question.example_text,
      sharedExample: question.shared_example
        ? formatCodeBlocks(question.shared_example)
        : question.shared_example,
      imageUrls: question.question_image_urls,
      choices: question.choices,
      correctAnswers: question.correct_answers,
      explanation: question.explanation,
      exam: {
        id: question.exam.id,
        title: question.exam.title,
        subject: question.exam.subject?.name ?? null,
      },
      isBookmarked,
    };
  }
}
