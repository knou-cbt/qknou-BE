import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Bookmark } from './entities/bookmark.entity';
import { Questsion } from 'src/questions/entities/question.entity';

/** Postgres unique_violation 에러 코드 */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class BookmarksService {
  constructor(
    @InjectRepository(Bookmark)
    private bookmarkRepository: Repository<Bookmark>,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
  ) {}

  /**
   * 사용자의 북마크 목록 조회 (최신 등록순)
   * 문항/시험/과목 정보를 함께 조합해서 반환
   */
  async findAllByUser(userId: string) {
    const rows = await this.bookmarkRepository
      .createQueryBuilder('bookmark')
      .innerJoin('bookmark.question', 'question')
      .innerJoin('question.exam', 'exam')
      .leftJoin('exam.subject', 'subject')
      .where('bookmark.user_id = :userId', { userId })
      .select('question.id', 'questionId')
      .addSelect('question.question_number', 'questionNumber')
      .addSelect('question.question_text', 'questionText')
      .addSelect('exam.id', 'examId')
      .addSelect('exam.title', 'examTitle')
      .addSelect('subject.name', 'subjectName')
      .addSelect('bookmark.created_at', 'bookmarkedAt')
      .orderBy('bookmark.created_at', 'DESC')
      .getRawMany();

    return rows;
  }

  /**
   * 문항 북마크 등록
   * 이미 북마크돼 있으면 새로 만들지 않고 기존 것을 그대로 반환 (idempotent)
   */
  async create(
    userId: string,
    questionId: number,
  ): Promise<{ bookmark: Bookmark; created: boolean }> {
    const question = await this.questionRepository.findOne({
      where: { id: questionId },
    });
    if (!question) {
      throw new NotFoundException(`문항 id ${questionId}를 찾을 수 없습니다.`);
    }

    const existing = await this.bookmarkRepository.findOne({
      where: { user_id: userId, question_id: questionId },
    });
    if (existing) {
      return { bookmark: existing, created: false };
    }

    try {
      const bookmark = this.bookmarkRepository.create({
        user_id: userId,
        question_id: questionId,
      });
      await this.bookmarkRepository.save(bookmark);
      return { bookmark, created: true };
    } catch (error: any) {
      // 동시 요청으로 유니크 제약을 이미 다른 트랜잭션이 채운 경우
      if (error.code === UNIQUE_VIOLATION) {
        const bookmark = await this.bookmarkRepository.findOneOrFail({
          where: { user_id: userId, question_id: questionId },
        });
        return { bookmark, created: false };
      }
      throw error;
    }
  }

  /**
   * 문항 북마크 해제
   * 북마크가 없었어도 에러 없이 조용히 넘어감 (idempotent)
   */
  async remove(userId: string, questionId: number): Promise<void> {
    await this.bookmarkRepository.delete({
      user_id: userId,
      question_id: questionId,
    });
  }

  /**
   * 특정 문항의 북마크 여부 확인 (암기모드/공유 문항 조회 시 사용)
   */
  async isBookmarked(userId: string, questionId: number): Promise<boolean> {
    const count = await this.bookmarkRepository.count({
      where: { user_id: userId, question_id: questionId },
    });
    return count > 0;
  }
}
