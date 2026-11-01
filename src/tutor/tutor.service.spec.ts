import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TutorService } from './tutor.service';
import { Questsion } from 'src/questions/entities/question.entity';
import { Term } from './entities/term.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { UserChatLimit } from './entities/chat-limit.entity';
import { LlmService } from 'src/llm/llm.service';
import { LlmTarget } from 'src/llm/llm-client';

function llmResponse(content: object | string) {
  return {
    choices: [
      {
        message: {
          content:
            typeof content === 'string' ? content : JSON.stringify(content),
        },
      },
    ],
  };
}

function makeQuestion(id: number) {
  return {
    id,
    question_text: '문제',
    example_text: null,
    choices: [{ number: 1, text: '보기' }],
    correct_answers: [1],
    exam: { subject_id: 7 },
  } as unknown as Questsion;
}

const defaultTarget = { model: 'default', isPersonal: false } as LlmTarget;
const personalTarget = { model: 'mine', isPersonal: true } as LlmTarget;

describe('TutorService', () => {
  let service: TutorService;
  let questionRepository: {
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let termRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let llmService: { complete: jest.Mock; defaultTarget: LlmTarget };

  beforeEach(async () => {
    const countQuery = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    };
    questionRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(makeQuestion(1)),
      createQueryBuilder: jest.fn(() => countQuery),
    };
    termRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };
    llmService = { complete: jest.fn(), defaultTarget };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TutorService,
        { provide: LlmService, useValue: llmService },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        { provide: getRepositoryToken(Term), useValue: termRepository },
        { provide: getRepositoryToken(Exam), useValue: {} },
        { provide: getRepositoryToken(UserChatLimit), useValue: {} },
      ],
    }).compile();

    service = module.get(TutorService);
  });

  describe('generateExplanation', () => {
    it('같은 문제에 대한 동시 요청은 LLM을 한 번만 호출하고, 기본 LLM을 쓴다', async () => {
      llmService.complete.mockResolvedValue(
        llmResponse({ explanation: '해설', concept_tags: ['개념'] }),
      );
      const question = makeQuestion(1);

      const [a, b] = await Promise.all([
        service.generateExplanation(question),
        service.generateExplanation(question),
      ]);

      expect(llmService.complete).toHaveBeenCalledTimes(1);
      expect(llmService.complete.mock.calls[0][0]).toBe(defaultTarget);
      expect(a).toEqual({ explanation: '해설', conceptTags: ['개념'] });
      expect(b).toBe(a);
    });
  });

  describe('chat', () => {
    beforeEach(() => {
      llmService.complete
        .mockResolvedValueOnce(
          llmResponse({ intent: 'define', term_candidates: ['정규화'] }),
        )
        .mockResolvedValueOnce(llmResponse('정규화는 ...'));
    });

    it('개인 LLM을 넘기면 모든 호출에 그 LLM을 쓰고, 공용 개념 캐시에 저장하지 않는다', async () => {
      const result = await service.chat(
        1,
        '정규화가 뭐야?',
        [],
        personalTarget,
      );

      expect(result.answer).toBe('정규화는 ...');
      expect(
        llmService.complete.mock.calls.every(([t]) => t === personalTarget),
      ).toBe(true);
      expect(termRepository.save).not.toHaveBeenCalled();
    });

    it('questionId 없이 보내면 문제 조회·개념 캐시 없이 답한다', async () => {
      const result = await service.chat(undefined, '정규화가 뭐야?');

      expect(result.answer).toBe('정규화는 ...');
      expect(questionRepository.findOne).not.toHaveBeenCalled();
      expect(termRepository.findOne).not.toHaveBeenCalled();
      expect(termRepository.save).not.toHaveBeenCalled();
    });

    it('기본 LLM이면 유효한 개념은 캐시에 저장한다', async () => {
      await service.chat(1, '정규화가 뭐야?');

      expect(llmService.complete.mock.calls[0][0]).toBe(defaultTarget);
      expect(termRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ term: '정규화', model: 'default' }),
      );
    });

    describe('questionId 없는 일반 대화', () => {
      beforeEach(() => llmService.complete.mockReset());

      it('general이면 문제 컨텍스트 없는 프롬프트로 이전 대화와 함께 답한다', async () => {
        llmService.complete
          .mockResolvedValueOnce(
            llmResponse({ intent: 'general', term_candidates: [] }),
          )
          .mockResolvedValueOnce(llmResponse('공부 방법은 ...'));
        const history = [
          { role: 'user' as const, content: '안녕' },
          { role: 'assistant' as const, content: '안녕하세요' },
        ];

        const result = await service.chat(null, '공부 어떻게 해?', history);

        expect(result).toEqual({
          answer: '공부 방법은 ...',
          intent: 'general',
          recommendations: undefined,
        });
        const messages = llmService.complete.mock.calls[1][1].messages;
        expect(messages[0].content).not.toContain('[현재 문제 컨텍스트]');
        expect(messages.slice(1)).toEqual([
          ...history,
          { role: 'user', content: '공부 어떻게 해?' },
        ]);
      });

      it('recommend면 문제를 조회하지 않고 문제 화면에서 요청하라고 안내한다', async () => {
        llmService.complete.mockResolvedValueOnce(
          llmResponse({ intent: 'recommend', term_candidates: ['정규화'] }),
        );

        const result = await service.chat(undefined, '비슷한 문제 줘');

        expect(result.intent).toBe('recommend');
        expect(result.recommendations).toBeUndefined();
        expect(questionRepository.createQueryBuilder).not.toHaveBeenCalled();
        expect(llmService.complete).toHaveBeenCalledTimes(1);
      });
    });
  });
});
