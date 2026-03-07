import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { Questsion } from '../questions/entities/question.entity';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
    const args = process.argv.slice(2);
    const isTest = args.includes('--test');

    console.log('NestJS 애플리케이션 초기화 중...');
    const app = await NestFactory.createApplicationContext(AppModule);

    try {
        const dataSource = app.get(DataSource);
        const storageService = app.get(StorageService);

        console.log('데이터베이스에서 이미지 마이그레이션이 필요한 문제 불러오는 중...');

        const publicDomain = process.env.R2_PUBLIC_DOMAIN;
        if (!publicDomain) throw new Error('R2_PUBLIC_DOMAIN 환경변수가 설정되지 않았습니다.');

        const questions = await dataSource.getRepository(Questsion).find({
            relations: ['exam', 'exam.subject'], // 제목, 연도 정보 접근용
        });

        // 필터링: R2 도메인이 없는 이미지가 있는 문제만 추출
        const targetQuestions = questions.filter(q => {
            if (q.question_image_urls && q.question_image_urls.some(url => !url.includes(publicDomain))) return true;
            if (q.choices && Array.isArray(q.choices)) {
                return q.choices.some(c => c.imageUrls && c.imageUrls.some(url => !url.includes(publicDomain)));
            }
            return false;
        });

        const questionsToProcess = isTest ? targetQuestions.slice(0, 1) : targetQuestions;

        if (questionsToProcess.length === 0) {
            console.log('🎉 마이그레이션이 필요한 문제(기존 링크)가 없습니다!');
            return;
        }

        console.log(`총 ${questionsToProcess.length}개의 문제를 갱신합니다.${isTest ? ' (테스트 모드: 1개만 실행)' : ''}`);
        let updatedCount = 0;
        const failedLogs: any[] = [];

        for (const q of questionsToProcess) {
            let isUpdated = false;
            const exam = q.exam;

            // 1. 문제 이미지 처리
            if (q.question_image_urls && q.question_image_urls.length > 0) {
                const newUrls = [];
                for (let idx = 0; idx < q.question_image_urls.length; idx++) {
                    const url = q.question_image_urls[idx];
                    if (!url.includes(publicDomain)) {
                        console.log(`[문제 ${q.id}] 문제 이미지 ${idx + 1} 업로드 중...`);
                        const newUrl = await storageService.processAndUploadImage(
                            url,
                            `migrated_e${exam?.id}_q${q.question_number}_img${idx}`
                        );
                        if (newUrl) {
                            newUrls.push(newUrl);
                            isUpdated = true;
                        } else {
                            newUrls.push(url);
                            failedLogs.push({ type: 'question', id: q.id, url });
                        }
                    } else {
                        newUrls.push(url);
                    }
                }
                q.question_image_urls = newUrls;
            }

            // 2. 보기 이미지 처리
            if (q.choices && Array.isArray(q.choices)) {
                for (const choice of q.choices) {
                    if (choice.imageUrls && choice.imageUrls.length > 0) {
                        const newChoiceUrls = [];
                        for (let idx = 0; idx < choice.imageUrls.length; idx++) {
                            const url = choice.imageUrls[idx];
                            if (!url.includes(publicDomain)) {
                                console.log(`[문제 ${q.id}] 보기 ${choice.number} 이미지 ${idx + 1} 업로드 중...`);
                                const newChoiceUrl = await storageService.processAndUploadImage(
                                    url,
                                    `migrated_e${exam?.id}_q${q.question_number}_c${choice.number}_img${idx}`
                                );
                                if (newChoiceUrl) {
                                    newChoiceUrls.push(newChoiceUrl);
                                    isUpdated = true;
                                } else {
                                    newChoiceUrls.push(url);
                                    failedLogs.push({ type: 'choice', id: q.id, choiceNumber: choice.number, url });
                                }
                            } else {
                                newChoiceUrls.push(url);
                            }
                        }
                        choice.imageUrls = newChoiceUrls;
                    }
                }
            }

            // 변경사항이 있으면 DB에 저장
            if (isUpdated) {
                await dataSource.getRepository(Questsion).save(q);
                updatedCount++;
            }
        }

        console.log('');
        console.log('✅ 마이그레이션 완료!');
        console.log(`   - 총 ${updatedCount}개의 문제 레코드가 업데이트되었습니다.`);

        if (failedLogs.length > 0) {
            console.log('');
            console.log(`⚠️ ${failedLogs.length}개의 이미지 업로드 실패. 로그를 저장합니다.`);
            const logDir = path.join(process.cwd(), 'logs', 'migrate');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

            const dateStr = new Date().toISOString().split('T')[0];
            const logFile = path.join(logDir, `failed-migrations-${dateStr}.json`);

            let existingLogs = [];
            if (fs.existsSync(logFile)) {
                try {
                    existingLogs = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
                } catch { }
            }
            fs.writeFileSync(logFile, JSON.stringify([...existingLogs, ...failedLogs], null, 2));
            console.log(`📝 실패 로그 저장 위치: ${logFile}`);
            console.log(`💡 실패한 이미지들은 R2 링크를 갖지 못했기 때문에, 다음 번에 이 스크립트를 다시 실행하면 자동으로 재시도 대상(타겟)에 포함되어 전부 재시도됩니다.`);
        }

    } catch (error: any) {
        console.log('');
        console.error('❌ 마이그레이션 실패:', error.message);
    } finally {
        await app.close();
    }
}

bootstrap();
