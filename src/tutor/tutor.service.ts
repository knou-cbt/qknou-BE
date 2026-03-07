import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository } from 'typeorm';
import { Term } from './entities/term.entity';
import { Exam } from 'src/exams/entities/exam.entity';

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
    private openai: OpenAI;
    private readonly logger = new Logger(TutorService.name);

    constructor(
        private configService: ConfigService,
        @InjectRepository(Questsion)
        private questionRepository: Repository<Questsion>,
        @InjectRepository(Term)
        private termRepository: Repository<Term>,
        @InjectRepository(Exam)
        private examRepository: Repository<Exam>,
    ) {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        this.openai = new OpenAI({ apiKey });
    }

    private get model(): string {
        return this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    }

    private formatChoices(choices: any): string {
        if (!choices || !Array.isArray(choices)) return '';
        return choices.map((c: any) => `${c.number}번: ${c.text}`).join('\n');
    }

    // ──────────────────────────────────────────────
    // 1. 해설 + concept_tags 동시 생성
    // ──────────────────────────────────────────────

    async generateExplanation(question: Questsion): Promise<{ explanation: string; conceptTags: string[] }> {
        const systemPrompt = `당신은 한국방송통신대학교(KNOU) 학생들의 학습을 돕는 '방송대 튜터'입니다.
학생이 틀린 문제나 이해하기 어려운 기출문제에 대해 해설을 제공합니다.

다음의 작성 가이드라인을 엄격히 준수하세요:
1. 말투: 학생을 가르치는 차분하고 정돈된 '존댓말' 설명체를 사용하세요. (예: "~입니다", "~때문입니다", "~을 알 수 있습니다")
2. 길이: 200자에서 450자 사이의 분량으로 작성하세요.
3. 포맷: 가독성을 높이기 위해 '불릿(Bullet)'을 적극 활용하여 요점 위주로 정리하세요.
4. 구조: 해설의 맨 첫 줄이나 마지막 줄에 반드시 '한 줄 요약(핵심)'을 포함하세요.
5. 톤앤매너: 감정 표현을 배제하고, 사실 기반의 객관적이고 차분한 톤을 유지하세요.
6. 이모지: 학습 서비스의 목적에 맞게 이모지는 절대 사용하지 마세요.
7. 선택지 언급: 해설 내에서 선택지에 대해 설명할 때, '출력 토큰 절약'을 위해 선택지의 전체 텍스트를 절대로 반복해서 적지 말고 오직 '선택지 번호'(예: "1번", "2번")만 지칭하여 설명하세요.

반드시 아래 JSON 형식으로만 응답하세요. JSON 외의 텍스트는 절대 포함하지 마세요.
{
  "explanation": "해설 내용",
  "concept_tags": ["핵심개념1", "핵심개념2"]
}

concept_tags 규칙:
- 이 문제를 풀기 위해 반드시 알아야 하는 학문적 개념/이론/용어만 추출 (2~5개)
- 문제 지문에 등장하는 일반 단어(주체, 과정, 결과, 설명, 내용 등)는 절대 포함하지 마세요
- "이 태그로 검색하면 같은 개념을 다루는 다른 시험 문제를 찾을 수 있는가?"를 기준으로 판단하세요
- 모두 소문자, 영문 약어가 있으면 영문 사용 (예: di, cpu, oop)
- 한글 개념은 한글 그대로 사용 (예: 정규화, 상속, 가계재무관리)
- 좋은 예: ["가계", "경제주체", "소비", "재무관리"]
- 나쁜 예: ["주체", "과정", "결과", "설명", "개념"]`;

        const userPrompt = `다음 문제에 대한 해설과 핵심 개념 태그를 제공해주세요.

[문제 정보]
문제 텍스트: ${question.question_text}
보기문: ${question.example_text || '없음'}
선택지:
${this.formatChoices(question.choices)}

정답 번호: ${question.correct_answers.join(', ')}

왜 ${question.correct_answers.join(', ')}번이 정답인지 핵심 개념과 원리를 설명해주세요.`;

        try {
            this.logger.log(`문제 ID ${question.id} 해설 생성 요청 시작`);

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                response_format: { type: 'json_object' },
            });

            const raw = response.choices[0]?.message?.content || '';
            const parsed = JSON.parse(raw);

            const explanation: string = parsed.explanation || '해설을 생성하지 못했습니다.';
            const conceptTags: string[] = (parsed.concept_tags || []).map((t: string) => t.toLowerCase().trim());

            question.explanation = explanation;
            question.concept_tags = conceptTags;
            await this.questionRepository.save(question);

            this.logger.log(`문제 ID ${question.id} 해설 생성 완료 (tags: ${conceptTags.join(', ')})`);

            return { explanation, conceptTags };
        } catch (error) {
            this.logger.error(`해설 생성 중 오류 발생 (문제 ID: ${question.id}):`, error);
            throw new InternalServerErrorException('현재 AI 튜터가 해설을 생성하지 못했습니다. 나중에 다시 시도해주세요.');
        }
    }

    // ──────────────────────────────────────────────
    // 2. AI 튜터 챗봇 — intent 분류
    // ──────────────────────────────────────────────

    private async classifyIntent(userMessage: string): Promise<IntentResult> {
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
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0,
                response_format: { type: 'json_object' },
            });

            const raw = response.choices[0]?.message?.content || '';
            const parsed = JSON.parse(raw);

            return {
                intent: parsed.intent || 'general',
                term_candidates: (parsed.term_candidates || []).map((t: string) => t.toLowerCase().trim()),
            };
        } catch (error) {
            this.logger.error('intent 분류 실패:', error);
            return { intent: 'general', term_candidates: [] };
        }
    }

    // ──────────────────────────────────────────────
    // 3. 개념 설명 (define)
    // ──────────────────────────────────────────────

    private async getTermExplanation(term: string, subjectId: number): Promise<string> {
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
            .andWhere('q.concept_tags @> :tag::jsonb', { tag: JSON.stringify([term]) })
            .getCount()
            .then(count => count > 0);

        // 3. LLM으로 설명 생성
        const explanation = await this.generateTermExplanation(term);

        // 4. 유효한 개념이면 캐시, 아니면 1회성 반환
        if (isValidConcept) {
            const newTerm = this.termRepository.create({
                subject_id: subjectId,
                term,
                explanation,
                model: this.model,
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

    private async generateTermExplanation(term: string): Promise<string> {
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
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
            });

            return response.choices[0]?.message?.content || '설명을 생성하지 못했습니다.';
        } catch (error) {
            this.logger.error(`개념 설명 생성 실패 (${term}):`, error);
            throw new InternalServerErrorException('개념 설명을 생성하지 못했습니다.');
        }
    }

    // ──────────────────────────────────────────────
    // 4. 개념 비교 (compare)
    // ──────────────────────────────────────────────

    private async compareTerms(terms: string[], subjectId: number): Promise<string> {
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
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
            });

            return response.choices[0]?.message?.content || '비교 설명을 생성하지 못했습니다.';
        } catch (error) {
            this.logger.error(`개념 비교 실패 (${terms.join(', ')}):`, error);
            throw new InternalServerErrorException('개념 비교 설명을 생성하지 못했습니다.');
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
    ): Promise<Array<{ id: number; questionNumber: number; text: string; examTitle: string; year: number }>> {
        if (termCandidates.length === 0) return [];

        let query = this.questionRepository
            .createQueryBuilder('q')
            .innerJoin('q.exam', 'exam')
            .innerJoin('exam.subject', 'subject')
            .select(['q.id', 'q.question_number', 'q.question_text', 'exam.title', 'exam.year'])
            .where('exam.subject_id = :subjectId', { subjectId: subjectId });

        // concept_tags JSONB에 term 후보 중 하나라도 포함되어 있는 문제 조회
        const tagConditions = termCandidates.map((_, i) => `q.concept_tags @> :tag${i}::jsonb`);
        const tagParams: Record<string, string> = {};
        termCandidates.forEach((t, i) => {
            tagParams[`tag${i}`] = JSON.stringify([t]);
        });

        query = query.andWhere(`(${tagConditions.join(' OR ')})`, tagParams);

        if (excludeQuestionId) {
            query = query.andWhere('q.id != :excludeId', { excludeId: excludeQuestionId });
        }

        const questions = await query
            .orderBy('RANDOM()')
            .limit(limit)
            .getMany();

        return questions.map(q => ({
            id: q.id,
            questionNumber: q.question_number,
            text: q.question_text.substring(0, 80) + (q.question_text.length > 80 ? '...' : ''),
            examTitle: q.exam.title,
            year: q.exam.year,
        }));
    }

    // ──────────────────────────────────────────────
    // 6. 일반 질문 (general)
    // ──────────────────────────────────────────────

    private async answerGeneral(question: Questsion, userMessage: string, history: ChatMessage[]): Promise<string> {
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
            ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
            { role: 'user', content: userMessage },
        ];

        try {
            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages,
                temperature: 0.7,
            });

            return response.choices[0]?.message?.content || '답변을 생성하지 못했습니다.';
        } catch (error) {
            this.logger.error('일반 질문 응답 실패:', error);
            throw new InternalServerErrorException('답변을 생성하지 못했습니다.');
        }
    }

    // ──────────────────────────────────────────────
    // 메인: AI 튜터 채팅
    // ──────────────────────────────────────────────

    async chat(
        questionId: number,
        userMessage: string,
        history: ChatMessage[] = [],
    ): Promise<{
        answer: string;
        intent: string;
        recommendations?: Array<{ id: number; questionNumber: number; text: string; examTitle: string; year: number }>;
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
        const { intent, term_candidates } = await this.classifyIntent(userMessage);
        this.logger.log(`intent: ${intent}, terms: ${term_candidates.join(', ')}`);

        let answer: string;
        let recommendations: Array<{ id: number; questionNumber: number; text: string; examTitle: string; year: number }> | undefined;

        // 2. intent별 분기
        switch (intent) {
            case 'define': {
                if (term_candidates.length === 0) {
                    answer = await this.answerGeneral(question, userMessage, history);
                } else {
                    const explanations = await Promise.all(
                        term_candidates.map(t => this.getTermExplanation(t, subjectId))
                    );
                    answer = explanations.join('\n\n---\n\n');
                }
                break;
            }

            case 'compare': {
                if (term_candidates.length < 2) {
                    answer = await this.answerGeneral(question, userMessage, history);
                } else {
                    answer = await this.compareTerms(term_candidates, subjectId);
                }
                break;
            }

            case 'recommend': {
                const recs = await this.recommendQuestions(term_candidates, subjectId, questionId);
                if (recs.length > 0) {
                    recommendations = recs;
                    answer = `"${term_candidates.join(', ')}" 관련 문제 ${recs.length}개를 찾았습니다.`;
                } else {
                    answer = '관련 문제를 찾지 못했습니다. 아직 해당 개념의 태그가 생성되지 않은 문제가 많을 수 있습니다.';
                }
                break;
            }

            default: {
                answer = await this.answerGeneral(question, userMessage, history);
                break;
            }
        }

        return { answer, intent, recommendations };
    }
}
