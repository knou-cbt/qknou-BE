import {
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import OpenAI from 'openai';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository, LessThan } from 'typeorm';
import { Term } from './entities/term.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { UserChatLimit } from './entities/chat-limit.entity';
import { LlmService } from 'src/llm/llm.service';
import { LlmTarget } from 'src/llm/llm-client';
import { DAILY_CHAT_LIMIT, kstDaysAgo, kstToday } from './chat-limit-date';

const PROMPT_VERSION = 'v1';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface IntentResult {
  intent: 'define' | 'compare' | 'recommend' | 'general';
  term_candidates: string[];
}

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);
  // 해설 없는 문제를 여러 사용자가 동시에 열면 같은 해설을 N번 생성하던 것을 1번으로 합침
  private readonly explanationInFlight = new Map<
    number,
    Promise<{ explanation: string; conceptTags: string[] }>
  >();

  constructor(
    private readonly llmService: LlmService,
    @InjectRepository(Questsion)
    private questionRepository: Repository<Questsion>,
    @InjectRepository(Term)
    private termRepository: Repository<Term>,
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>,
    @InjectRepository(UserChatLimit)
    private chatLimitRepository: Repository<UserChatLimit>,
  ) {}

  private formatChoices(choices: any): string {
    if (!choices || !Array.isArray(choices)) return '';
    return choices.map((c: any) => `${c.number}번: ${c.text}`).join('\n');
  }

  // ──────────────────────────────────────────────
  // 1. 해설 + concept_tags 동시 생성
  // ──────────────────────────────────────────────

  async generateExplanation(
    question: Questsion,
  ): Promise<{ explanation: string; conceptTags: string[] }> {
    const pending = this.explanationInFlight.get(question.id);
    if (pending) return pending;

    const task = this.generateAndSaveExplanation(question).finally(() =>
      this.explanationInFlight.delete(question.id),
    );
    this.explanationInFlight.set(question.id, task);
    return task;
  }

  private async generateAndSaveExplanation(
    question: Questsion,
  ): Promise<{ explanation: string; conceptTags: string[] }> {
    const systemPrompt = `KNOU 기출문제 해설 생성. JSON만 출력.
규칙: 각 선택지를 "N번. 개념명\n설명" 형식으로 작성. 선택지 사이는 빈 줄(\\n\\n)로 구분. 정답/오답 구분 표시 없음. 오답은 틀렸다는 표현 없이 그 개념이 무엇인지만 설명. 영문 명칭이 실제로 존재하는 용어에 한해 "한글발음(English)" 형식으로 표기하고, 한글 전용 개념은 그냥 한글만 쓸 것. 말투는 "~이다, ~때문이다" 체로 간결하게. 이모지 금지.
{"explanation":"1번. 개념명\\n설명\\n\\n2번. 개념명\\n설명\\n\\n...","concept_tags":["개념1","개념2"]}
concept_tags: 핵심 학술 개념 2~4개, 소문자, 일반어 제외.`;

    const userPrompt = `문제: ${question.question_text}${question.example_text ? `\n보기: ${question.example_text}` : ''}
선택지:
${this.formatChoices(question.choices)}
정답: ${question.correct_answers.join(', ')}번`;

    try {
      this.logger.log(`문제 ID ${question.id} 해설 생성 요청 시작`);

      // 해설은 DB에 저장돼 모든 사용자가 같이 보므로 항상 기본 LLM으로 생성
      const response = await this.llmService.complete(
        this.llmService.defaultTarget,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          response_format: { type: 'json_object' },
        },
      );

      const raw = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(raw);

      const explanation: string =
        parsed.explanation || '해설을 생성하지 못했습니다.';
      const conceptTags: string[] = (parsed.concept_tags || []).map(
        (t: string) => t.toLowerCase().trim(),
      );

      question.explanation = explanation;
      question.concept_tags = conceptTags;
      await this.questionRepository.save(question);

      this.logger.log(
        `문제 ID ${question.id} 해설 생성 완료 (tags: ${conceptTags.join(', ')})`,
      );

      return { explanation, conceptTags };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `해설 생성 중 오류 발생 (문제 ID: ${question.id}):`,
        error,
      );
      throw new InternalServerErrorException(
        '현재 AI 튜터가 해설을 생성하지 못했습니다. 나중에 다시 시도해주세요.',
      );
    }
  }

  // ──────────────────────────────────────────────
  // 2. AI 튜터 챗봇 — intent 분류
  // ──────────────────────────────────────────────

  private async classifyIntent(
    target: LlmTarget,
    userMessage: string,
  ): Promise<IntentResult> {
    const systemPrompt = `사용자의 질문을 분석하여 의도(intent)와 핵심 개념(term_candidates)을 추출하세요.

반드시 아래 JSON 형식으로만 응답하세요.
{
  "intent": "define | compare | recommend | general",
  "term_candidates": ["개념1", "개념2"]
}

intent 분류 기준:
- define: 특정 개념의 의미/정의를 묻는 질문 (예: "CPU가 뭐야?", "DI 설명해줘")
- compare: 두 개 이상의 개념을 비교하는 질문 (예: "DI랑 IoC 차이가 뭐야?")
- recommend: 관련 문제나 유사 문제를 요청 (예: "비슷한 문제 더 줘", "관련 문제 추천해줘")
- general: 위 분류에 해당하지 않는 일반 질문

term_candidates 규칙:
- 소문자로 정규화
- 영문 약어가 있으면 영문 사용 (예: di, cpu, oop)
- 한글 개념은 한글 그대로 (예: 정규화, 상속)
- 질문에서 핵심 개념이 없으면 빈 배열`;

    try {
      const response = await this.llmService.complete(target, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      });

      const raw = response.choices[0]?.message?.content || '';
      const parsed = JSON.parse(raw);

      return {
        intent: parsed.intent || 'general',
        term_candidates: (parsed.term_candidates || []).map((t: string) =>
          t.toLowerCase().trim(),
        ),
      };
    } catch (error) {
      // 대기열 초과(503)·개인 LLM 오류(502)는 다음 호출도 실패하므로 바로 올려보냄
      if (error instanceof HttpException) throw error;
      this.logger.error('intent 분류 실패:', error);
      return { intent: 'general', term_candidates: [] };
    }
  }

  // ──────────────────────────────────────────────
  // 3. 개념 설명 (define)
  // ──────────────────────────────────────────────

  private async getTermExplanation(
    target: LlmTarget,
    term: string,
    subjectId: number,
  ): Promise<string> {
    // 1. 캐시 히트 확인
    const existing = await this.termRepository.findOne({
      where: { term, subject_id: subjectId, prompt_version: PROMPT_VERSION },
    });

    if (existing) {
      await this.termRepository.increment({ id: existing.id }, 'hit_count', 1);
      return existing.explanation;
    }

    // 2. concept_tags에 존재하는 개념인지 검증
    const isValidConcept = await this.questionRepository
      .createQueryBuilder('q')
      .innerJoin('q.exam', 'exam')
      .where('exam.subject_id = :subjectId', { subjectId })
      .andWhere('q.concept_tags @> :tag::jsonb', {
        tag: JSON.stringify([term]),
      })
      .getCount()
      .then((count) => count > 0);

    // 3. LLM으로 설명 생성
    const explanation = await this.generateTermExplanation(target, term);

    // 4. 유효한 개념이면 캐시, 아니면 1회성 반환.
    //    개인 LLM 응답은 공용 캐시(다른 사용자도 보는 값)에 넣지 않음
    if (isValidConcept && !target.isPersonal) {
      const newTerm = this.termRepository.create({
        subject_id: subjectId,
        term,
        explanation,
        model: target.model,
        prompt_version: PROMPT_VERSION,
        hit_count: 1,
      });
      await this.termRepository.save(newTerm);
      this.logger.log(`term 캐시 저장: "${term}" (subject: ${subjectId})`);
    } else {
      this.logger.log(`term 1회성 응답: "${term}" (concept_tags에 미존재)`);
    }

    return explanation;
  }

  private async generateTermExplanation(
    target: LlmTarget,
    term: string,
  ): Promise<string> {
    const systemPrompt = `당신은 한국방송통신대학교(KNOU) 학생들의 학습을 돕는 '방송대 튜터'입니다.
학생이 궁금해하는 개념에 대해 명확하고 이해하기 쉬운 설명을 제공합니다.

가이드라인:
1. 100~200자 분량
2. 차분한 존댓말 설명체
3. 핵심 정의를 첫 문장에 제시
4. 이모지 사용 금지
5. 문단 구분은 줄바꿈 한 번(\n)만 사용하고, \n\n(빈 줄)은 사용하지 마세요.`;

    const userPrompt = `"${term}" 개념에 대해 설명해주세요.`;

    try {
      const response = await this.llmService.complete(target, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      });

      return (
        response.choices[0]?.message?.content || '설명을 생성하지 못했습니다.'
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`개념 설명 생성 실패 (${term}):`, error);
      throw new InternalServerErrorException(
        '개념 설명을 생성하지 못했습니다.',
      );
    }
  }

  // ──────────────────────────────────────────────
  // 4. 개념 비교 (compare)
  // ──────────────────────────────────────────────

  private async compareTerms(
    target: LlmTarget,
    terms: string[],
  ): Promise<string> {
    const systemPrompt = `당신은 한국방송통신대학교(KNOU) 학생들의 학습을 돕는 '방송대 튜터'입니다.

가이드라인:
1. 100~200자 분량
2. 차분한 존댓말 설명체
3. 공통점과 차이점을 명확히 구분하여 설명
4. 표 형식이나 불릿 활용
5. 이모지 사용 금지
6. 문단 구분은 줄바꿈 한 번(\n)만 사용하고, \n\n(빈 줄)은 사용하지 마세요.`;

    const userPrompt = `다음 개념들을 비교하여 설명해주세요: ${terms.join(', ')}`;

    try {
      const response = await this.llmService.complete(target, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      });

      return (
        response.choices[0]?.message?.content ||
        '비교 설명을 생성하지 못했습니다.'
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`개념 비교 실패 (${terms.join(', ')}):`, error);
      throw new InternalServerErrorException(
        '개념 비교 설명을 생성하지 못했습니다.',
      );
    }
  }

  // ──────────────────────────────────────────────
  // 5. 관련 문제 추천 (recommend)
  // ──────────────────────────────────────────────

  async recommendQuestions(
    termCandidates: string[],
    subjectId: number,
    excludeQuestionId?: number,
    limit: number = 5,
  ): Promise<
    Array<{
      id: number;
      questionNumber: number;
      text: string;
      examTitle: string;
      year: number;
    }>
  > {
    if (termCandidates.length === 0) return [];

    // TypeORM 쿼리에서 사용할 파라미터 객체
    const params = { subjectId };

    let query = this.questionRepository
      .createQueryBuilder('q')
      .innerJoin('q.exam', 'exam')
      .innerJoin('exam.subject', 'subject')
      .select([
        'q.id',
        'q.question_number',
        'q.question_text',
        'exam.title',
        'exam.year',
      ])
      .where('exam.subject_id = :subjectId', params);

    // concept_tags JSONB에 term 후보 중 하나라도 포함되어 있는 문제 조회
    const tagConditions = termCandidates.map(
      (_, i) => `q.concept_tags @> :tag${i}::jsonb`,
    );
    const tagParams: Record<string, string> = {};
    termCandidates.forEach((t, i) => {
      tagParams[`tag${i}`] = JSON.stringify([t]);
    });

    query = query.andWhere(`(${tagConditions.join(' OR ')})`, tagParams);

    if (excludeQuestionId) {
      query = query.andWhere('q.id != :excludeId', {
        excludeId: excludeQuestionId,
      });
    }

    const questions = await query.orderBy('RANDOM()').limit(limit).getMany();

    return questions.map((q) => ({
      id: q.id,
      questionNumber: q.question_number,
      text:
        q.question_text.substring(0, 80) +
        (q.question_text.length > 80 ? '...' : ''),
      examTitle: q.exam.title,
      year: q.exam.year,
    }));
  }

  // ──────────────────────────────────────────────
  // 6. 일반 질문 (general)
  // ──────────────────────────────────────────────

  private async answerGeneral(
    target: LlmTarget,
    question: Questsion,
    userMessage: string,
    history: ChatMessage[],
  ): Promise<string> {
    const systemPrompt = `당신은 한국방송통신대학교(KNOU) 학생들의 학습을 돕는 '방송대 튜터'입니다.
학생이 시험 문제를 풀고 있는 화면에서 질문하고 있습니다.
학습에 도움이 되는 답변을 해주세요.

[현재 문제 컨텍스트]
문제: ${question.question_text}

가이드라인:
1. 100~200자 분량
2. 차분한 존댓말 설명체
3. 이모지 사용 금지
4. 학습 범위를 벗어나는 질문에는 정중히 안내
5. 문단 구분은 줄바꿈 한 번(\n)만 사용하고, \n\n(빈 줄)은 사용하지 마세요.`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: userMessage },
    ];

    try {
      const response = await this.llmService.complete(target, {
        messages,
        temperature: 0.7,
      });

      return (
        response.choices[0]?.message?.content || '답변을 생성하지 못했습니다.'
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('일반 질문 응답 실패:', error);
      throw new InternalServerErrorException('답변을 생성하지 못했습니다.');
    }
  }

  // ──────────────────────────────────────────────
  // 메인: AI 튜터 채팅
  // ──────────────────────────────────────────────

  /**
   * @param target 사용자 개인 LLM. 없으면 기본 LLM
   */
  async chat(
    questionId: number,
    userMessage: string,
    history: ChatMessage[] = [],
    target: LlmTarget = this.llmService.defaultTarget,
  ): Promise<{
    answer: string;
    intent: string;
    recommendations?: Array<{
      id: number;
      questionNumber: number;
      text: string;
      examTitle: string;
      year: number;
    }>;
  }> {
    const question = await this.questionRepository.findOne({
      where: { id: questionId },
      relations: ['exam'],
    });

    if (!question) {
      throw new NotFoundException(`문제 ID ${questionId}를 찾을 수 없습니다.`);
    }

    const subjectId = question.exam.subject_id;

    // 1. intent 분류
    const { intent, term_candidates } = await this.classifyIntent(
      target,
      userMessage,
    );
    this.logger.log(`intent: ${intent}, terms: ${term_candidates.join(', ')}`);

    let answer: string;
    let recommendations:
      | Array<{
          id: number;
          questionNumber: number;
          text: string;
          examTitle: string;
          year: number;
        }>
      | undefined;

    // 2. intent별 분기
    switch (intent) {
      case 'define': {
        if (term_candidates.length === 0) {
          answer = await this.answerGeneral(
            target,
            question,
            userMessage,
            history,
          );
        } else {
          const explanations = await Promise.all(
            term_candidates.map((t) =>
              this.getTermExplanation(target, t, subjectId),
            ),
          );
          answer = explanations.join('\n\n---\n\n');
        }
        break;
      }

      case 'compare': {
        if (term_candidates.length < 2) {
          answer = await this.answerGeneral(
            target,
            question,
            userMessage,
            history,
          );
        } else {
          answer = await this.compareTerms(target, term_candidates);
        }
        break;
      }

      case 'recommend': {
        const recs = await this.recommendQuestions(
          term_candidates,
          subjectId,
          questionId,
        );
        if (recs.length > 0) {
          recommendations = recs;
          answer = `"${term_candidates.join(', ')}" 관련 문제 ${recs.length}개를 찾았습니다.`;
        } else {
          answer =
            '관련 문제를 찾지 못했습니다. 아직 해당 개념의 태그가 생성되지 않은 문제가 많을 수 있습니다.';
        }
        break;
      }

      default: {
        answer = await this.answerGeneral(
          target,
          question,
          userMessage,
          history,
        );
        break;
      }
    }

    return { answer, intent, recommendations };
  }

  // ──────────────────────────────────────────────
  // 7. 남은 횟수 조회
  // ──────────────────────────────────────────────

  async getRemainingCount(userId: string): Promise<number> {
    const limit = await this.chatLimitRepository.findOne({
      where: { user_id: userId, date: kstToday() as any },
    });

    if (!limit) return DAILY_CHAT_LIMIT;
    return Math.max(0, DAILY_CHAT_LIMIT - limit.count);
  }

  /** LLM 호출이 실패한 요청은 ChatLimitGuard에서 차감한 1회를 되돌려줌 */
  async refundChatCount(userId: string, date: string): Promise<void> {
    await this.chatLimitRepository
      .createQueryBuilder()
      .update()
      .set({ count: () => 'count - 1' })
      .where('user_id = :userId AND date = :date AND count > 0', {
        userId,
        date,
      })
      .execute();
  }

  // ──────────────────────────────────────────────
  // 8. Cron Job - 오래된 챗봇 사용 데이터 삭제
  // ──────────────────────────────────────────────

  /**
   * 매일 새벽 3시에 90일 이전 데이터 삭제
   */
  @Cron('0 3 * * *', {
    name: 'cleanup-old-chat-limits',
    timeZone: 'Asia/Seoul',
  })
  async cleanupOldChatLimits() {
    this.logger.log('=== 오래된 챗봇 사용 데이터 정리 시작 ===');

    try {
      // 90일 이전 날짜 계산
      const cutoffDate = kstDaysAgo(90);

      // 삭제 전 개수 확인
      const countBefore = await this.chatLimitRepository.count({
        where: {
          date: LessThan(cutoffDate as any),
        },
      });

      if (countBefore === 0) {
        this.logger.log('삭제할 오래된 데이터가 없습니다.');
        return;
      }

      // 삭제 실행
      const result = await this.chatLimitRepository.delete({
        date: LessThan(cutoffDate as any),
      });

      this.logger.log(
        `오래된 챗봇 사용 데이터 ${result.affected}개 삭제 완료 (${cutoffDate} 이전)`,
      );
    } catch (error) {
      this.logger.error('오래된 데이터 삭제 중 오류 발생:', error);
    }
  }

  /**
   * 수동 실행용 메서드 (테스트/관리자용)
   */
  async manualCleanupOldChatLimits(days: number = 90): Promise<{
    deleted: number;
    cutoffDate: string;
  }> {
    const cutoffDate = kstDaysAgo(days);

    const result = await this.chatLimitRepository.delete({
      date: LessThan(cutoffDate as any),
    });

    this.logger.log(
      `수동 삭제: ${result.affected}개 삭제 (${cutoffDate} 이전, ${days}일)`,
    );

    return {
      deleted: result.affected || 0,
      cutoffDate,
    };
  }
}
