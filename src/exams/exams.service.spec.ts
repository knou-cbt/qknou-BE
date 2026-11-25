import { DataSource } from 'typeorm';
import { ExamsService, PREVIEW_QUESTION_COUNT } from './exams.service';

/** createQueryBuilder 체이닝을 흉내 내는 목. take()로 받은 개수만큼 잘라서 돌려준다. */
function makeQueryBuilder<T>(rows: T[]) {
  let taken: number | undefined;
  const qb: any = {
    select: jest.fn(() => qb),
    addSelect: jest.fn(() => qb),
    leftJoin: jest.fn(() => qb),
    where: jest.fn(() => qb),
    orderBy: jest.fn(() => qb),
    skip: jest.fn(() => qb),
    take: jest.fn((n: number) => {
      taken = n;
      return qb;
    }),
    getOne: jest.fn(async () => rows[0]),
    getMany: jest.fn(async () =>
      taken === undefined ? rows : rows.slice(0, taken),
    ),
  };
  return qb;
}

const exam = {
  id: 1,
  title: '자료구조',
  total_questions: 8,
  year: 2024,
  subject: { name: '자료구조' },
};

const questions = Array.from({ length: 8 }, (_, i) => ({
  id: 100 + i,
  question_number: i + 1,
  question_text: `Q${i + 1}`,
  example_text: null,
  shared_example: null,
  shared_example_image_urls: null,
  question_image_urls: null,
  choices: [],
  concept_tags: null,
  correct_answers: [((i % 4) + 1) as number],
  explanation: '해설',
}));

function makeService() {
  const examRepository: any = {
    createQueryBuilder: jest.fn(() => makeQueryBuilder([exam])),
    findOne: jest.fn(async () => ({
      id: 1,
      total_questions: 8,
      subject_id: 3,
      year: 2024,
    })),
    exist: jest.fn(async () => true),
  };
  const questionRepository: any = {
    createQueryBuilder: jest.fn(() => makeQueryBuilder(questions)),
  };
  const examHistoryService: any = { saveAttempt: jest.fn() };
  const service = new ExamsService(
    examRepository,
    questionRepository,
    {} as any,
    {} as DataSource,
    {} as any,
    examHistoryService,
  );
  return { service, examRepository, examHistoryService };
}

describe('ExamsService 문제 데이터 보호', () => {
  describe('findQuestions', () => {
    it('비로그인은 앞 문항만 받고 preview 정보가 붙는다', async () => {
      const { service } = makeService();
      const data = await service.findQuestions(1, false);

      expect(data.questions).toHaveLength(PREVIEW_QUESTION_COUNT);
      expect(data.preview).toEqual({
        limit: PREVIEW_QUESTION_COUNT,
        totalQuestions: 8,
      });
    });

    it('로그인은 전체 문항을 받는다', async () => {
      const { service } = makeService();
      const data = await service.findQuestions(1, true);

      expect(data.questions).toHaveLength(8);
      expect(data.preview).toBeUndefined();
    });

    it('로그인 여부와 관계없이 목록에 정답·해설이 없다', async () => {
      const { service } = makeService();
      for (const isAuthenticated of [false, true]) {
        const data = await service.findQuestions(1, isAuthenticated);
        for (const q of data.questions) {
          expect(q).not.toHaveProperty('correctAnswers');
          expect(q).not.toHaveProperty('explanation');
        }
      }
    });
  });

  describe('findAnswers', () => {
    it('문항별 정답만 돌려준다 (해설 없음)', async () => {
      const { service } = makeService();
      const data = await service.findAnswers(1);

      expect(data.answers).toHaveLength(8);
      expect(data.answers[0]).toEqual({
        questionId: 100,
        number: 1,
        correctAnswers: [1],
      });
      expect(data.answers[0]).not.toHaveProperty('explanation');
    });
  });

  describe('submitExam', () => {
    const allAnswers = questions.map((q) => ({
      questionId: q.id,
      selectedAnswer: 1,
    }));

    it('비로그인은 미리보기 문항만 채점해 전체 정답이 새지 않는다', async () => {
      const { service, examHistoryService } = makeService();
      const data = await service.submitExam(1, allAnswers);

      expect(data.results).toHaveLength(PREVIEW_QUESTION_COUNT);
      expect(data.totalQuestions).toBe(PREVIEW_QUESTION_COUNT);
      expect(examHistoryService.saveAttempt).not.toHaveBeenCalled();
    });

    it('로그인은 전체를 채점하고 풀이 기록을 저장한다', async () => {
      const { service, examHistoryService } = makeService();
      const data = await service.submitExam(1, allAnswers, 'user-1');

      expect(data.results).toHaveLength(8);
      expect(examHistoryService.saveAttempt).toHaveBeenCalled();
    });
  });
});
