import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// 한국 시간대 설정
process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
