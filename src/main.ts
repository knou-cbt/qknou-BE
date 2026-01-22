// New Relic은 가장 먼저 로드되어야 합니다
if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// 한국 시간대 설정
process.env.TZ = 'Asia/Seoul';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 전역 Validation Pipe 설정
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  
  // CORS 설정
  app.enableCors({
    origin: ['http://localhost:3000', 'https://localhost:3000', 'http://localhost:3001', 'https://www.qknou.kr'], // localhost (http/https) + 운영 도메인 허용
    credentials: true,
  });

  // Swagger 설정
  const config = new DocumentBuilder()
    .setTitle('QKNOU API')
    .setDescription('방송통신대학교 CBT 시험 시스템 API')
    .setVersion('1.0')
    .addTag('exams', '시험 관련 API')
    .addTag('subjects', '과목 관련 API')
    .addTag('departments', '학과 관련 API')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  
  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀 서버가 실행 중입니다: http://localhost:${process.env.PORT ?? 3000}`);
  console.log(`📚 Swagger 문서: http://localhost:${process.env.PORT ?? 3000}/api-docs`);
}
bootstrap();
