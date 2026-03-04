import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { InjectRepository } from '@nestjs/typeorm';
import { Questsion } from 'src/questions/entities/question.entity';
import { Repository } from 'typeorm';

@Injectable()
export class TutorService {
    private openai: OpenAI;
    private readonly logger = new Logger(TutorService.name);

    constructor(
        private configService: ConfigService,
        @InjectRepository(Questsion)
        private questionRepository: Repository<Questsion>
    ) {
        const apiKey = this.configService.get<string>('OPENAI_API_KEY');
        this.openai = new OpenAI({ apiKey });
    }

    /**
     * 문제에 대한 해설을 생성하고 DB에 저장합니다.
     * @param question 문제 엔티티
     * @returns 생성된 해설 문자열
     */
    async generateExplanation(question: Questsion): Promise<string> {
        const model = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';

        // 정답 문자열 구성
        const formatChoices = (choices: any) => {
            if (!choices || !Array.isArray(choices)) return '';
            return choices.map((c: any) => `${c.number}번: ${c.text}`).join('\n');
        };

        const systemPrompt = `당신은 한국방송통신대학교(KNOU) 학생들의 학습을 돕는 '방송대 튜터'입니다.
학생이 틀린 문제나 이해하기 어려운 기출문제에 대해 해설을 제공합니다.

다음의 작성 가이드라인을 엄격히 준수하세요:
1. 말투: 학생을 가르치는 차분하고 정돈된 '존댓말' 설명체를 사용하세요. (예: "~입니다", "~때문입니다", "~을 알 수 있습니다")
2. 길이: 300자에서 600자 사이의 분량으로 작성하세요.
3. 포맷: 가독성을 높이기 위해 '불릿(Bullet)'을 적극 활용하여 요점 위주로 정리하세요.
4. 구조: 해설의 맨 첫 줄이나 마지막 줄에 반드시 '한 줄 요약(핵심)'을 포함하세요.
5. 톤앤매너: 감정 표현을 배제하고, 사실 기반의 객관적이고 차분한 톤을 유지하세요.
6. 이모지: 학습 서비스의 목적에 맞게 이모지는 절대 사용하지 마세요.
7. 선택지 언급: 해설 내에서 선택지에 대해 설명할 때, '출력 토큰 절약'을 위해 선택지의 전체 텍스트를 절대로 반복해서 적지 말고 오직 '선택지 번호'(예: "1번", "2번")만 지칭하여 설명하세요.`;

        const userPrompt = `다음 문제에 대한 상세하고 친절한 해설을 제공해주세요.

[문제 정보]
문제 텍스트: ${question.question_text}
보기문: ${question.example_text || '없음'}
선택지:
${formatChoices(question.choices)}

정답 번호: ${question.correct_answers.join(', ')}

위 정보를 바탕으로, 왜 ${question.correct_answers.join(', ')}번이 정답인지 핵심 개념과 원리를 설명해주세요. 다른 오답들이 왜 틀렸는지도 간략히 언급해주면 좋습니다.`;

        try {
            this.logger.log(`문제 ID ${question.id} 해설 생성 요청 시작`);

            const response = await this.openai.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7, // 약간의 일관성 유지
            });

            const explanation = response.choices[0]?.message?.content || '해설을 생성하지 못했습니다.';

            // 생성된 해설을 DB에 업데이트
            question.explanation = explanation;
            await this.questionRepository.save(question);

            this.logger.log(`문제 ID ${question.id} 해설 생성 완료`);

            return explanation;
        } catch (error) {
            this.logger.error(`해설 생성 중 오류 발생 (문제 ID: ${question.id}):`, error);
            throw new InternalServerErrorException('현재 AI 튜터가 해설을 생성하지 못했습니다. 나중에 다시 시도해주세요.');
        }
    }
}
