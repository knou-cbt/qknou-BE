import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// 한국 시간대 설정
process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // CORS 설정
  app.enableCors({
    origin: ['http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001', 'https://www.qknou.kr'], // localhost (http/https) + 운영 도메인 허용
    credentials: true,
  });
  
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
