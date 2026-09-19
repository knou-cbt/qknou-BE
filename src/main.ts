// Sentry와 New Relic은 가장 먼저 로드되어야 합니다
import './instrument';
/* eslint-disable @typescript-eslint/no-require-imports */
if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}
/* eslint-enable @typescript-eslint/no-require-imports */

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
    'https://qknou-fe.onrender.com',
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
      // 허용되지 않은 origin은 에러를 던지지 않고 false만 반환한다.
      // Error를 넘기면 cors 미들웨어가 next(err)로 전파해 CORS 차단이 아닌
      // 500 Internal Server Error로 응답하게 되어, 프록시를 거쳐 Origin 헤더가
      // 실려오는 서버-to-서버 요청까지 전부 깨지는 문제가 있었다.
      callback(null, isOriginAllowed(origin));
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
    .addTag('auth', '인증 관련 API')
    .addTag('tutor', 'AI 튜터 관련 API')
    .addTag('bookmarks', '북마크 관련 API')
    .addTag('mypage', '마이페이지 관련 API')
    .addTag('notices', '업데이트 알림 관련 API')
    .addTag('feedbacks', '피드백 관련 API')
    .addTag('questions', '문항 관련 API')
    .addTag('exam-submissions', '시험지 등록 관련 API')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'JWT 토큰을 입력하세요 (Bearer 제외)',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
  console.log(
    `🚀 서버가 실행 중입니다: http://localhost:${process.env.PORT ?? 3000}`,
  );
  console.log(
    `📚 Swagger 문서: http://localhost:${process.env.PORT ?? 3000}/api-docs`,
  );
}
bootstrap();
