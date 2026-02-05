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
  
  // CORS 허용 origin (로컬 개발 포트 제한 없음)
  const allowedOrigins: (string | RegExp)[] = [
    'https://www.qknou.kr',
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, // 로컬: localhost/127.0.0.1 모든 포트
  ];
  const isOriginAllowed = (origin: string) =>
    allowedOrigins.some((o) =>
      typeof o === 'string' ? o === origin : (o as RegExp).test(origin),
    );

  // 304 응답에도 CORS 헤더가 붙도록 가장 먼저 실행 (304 시 CORS 누락 방지)
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(isOriginAllowed(origin) ? null : new Error('Not allowed by CORS'), isOriginAllowed(origin) ? origin : false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
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
