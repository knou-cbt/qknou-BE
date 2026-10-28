import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { TutorService } from './tutor.service';
import { Questsion } from 'src/questions/entities/question.entity';
import { Term } from './entities/term.entity';
import { Exam } from 'src/exams/entities/exam.entity';
import { UserChatLimit } from './entities/chat-limit.entity';

const config: Record<string, string> = {
  OPENAI_API_KEY: 'test-key',
  LLM_MAX_CONCURRENCY: '1',
  LLM_MAX_QUEUE: '1',
};

function llmResponse(content: object) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function makeQuestion(id: number) {
  return {
    id,
    question_text: '문제',
    example_text: null,
    choices: [{ number: 1, text: '보기' }],
    correct_answers: [1],
  } as unknown as Questsion;
}

describe('TutorService', () => {
  let service: TutorService;
  let questionRepository: { save: jest.Mock };
  let createCompletion: jest.Mock;

  beforeEach(async () => {
    questionRepository = { save: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TutorService,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => config[key] },
        },
        {
          provide: getRepositoryToken(Questsion),
          useValue: questionRepository,
        },
        { provide: getRepositoryToken(Term), useValue: {} },
        { provide: getRepositoryToken(Exam), useValue: {} },
        { provide: getRepositoryToken(UserChatLimit), useValue: {} },
      ],
    }).compile();

    service = module.get(TutorService);
    createCompletion = jest.fn();
    (service as any).openai = {
      chat: { completions: { create: createCompletion } },
    };
  });

  describe('generateExplanation', () => {
    it('같은 문제에 대한 동시 요청은 LLM을 한 번만 호출한다', async () => {
      createCompletion.mockResolvedValue(
        llmResponse({ explanation: '해설', concept_tags: ['개념'] }),
      );
      const question = makeQuestion(1);

      const [a, b] = await Promise.all([
        service.generateExplanation(question),
        service.generateExplanation(question),
      ]);

      expect(createCompletion).toHaveBeenCalledTimes(1);
      expect(a).toEqual({ explanation: '해설', conceptTags: ['개념'] });
      expect(b).toBe(a);
    });

    it('동시 호출 상한과 대기열이 모두 차면 503을 던진다', async () => {
      let release: () => void = () => undefined;
      createCompletion.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve(llmResponse({ explanation: '해설', concept_tags: [] }));
          }),
      );

      // 동시 1개 실행 + 대기 1개 → 세 번째 요청은 바로 거절
      const running = service.generateExplanation(makeQuestion(1));
      const queued = service.generateExplanation(makeQuestion(2));
      await expect(
        service.generateExplanation(makeQuestion(3)),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      release();
      await running;
      // 슬롯이 대기자에게 넘어가서 두 번째 요청도 처리됨
      await Promise.resolve();
      release();
      await expect(queued).resolves.toEqual({
        explanation: '해설',
        conceptTags: [],
      });
      expect(createCompletion).toHaveBeenCalledTimes(2);
    });
  });
});
