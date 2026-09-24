/**
 * 개발용 DB에 엔티티 기준으로 스키마를 한 번 동기화(synchronize)한다.
 * 반드시 NODE_ENV=development DB_SYNCHRONIZE=true 로만 실행할 것 —
 * 운영 DB를 향한 채로 절대 실행하지 말 것.
 *
 * 사용법: NODE_ENV=development DB_SYNCHRONIZE=true \
 *   yarn ts-node -r tsconfig-paths/register src/scripts/sync-dev-schema.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ NODE_ENV=production 상태에서는 실행할 수 없습니다.');
    process.exit(1);
  }
  if (process.env.DB_SYNCHRONIZE !== 'true') {
    console.error('❌ DB_SYNCHRONIZE=true 를 명시해야 실행됩니다.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  console.log('✅ 스키마 동기화 완료');
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
