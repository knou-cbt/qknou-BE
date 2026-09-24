import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SubjectsModule } from './subjects/subjects.module';
import { ExamsModule } from './exams/exams.module';
import { QuestionsModule } from './questions/questions.module';
import { DepartmentsModule } from './departments/departments.module';
import { CrawlersModule } from './crawlers/crawlers.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TutorModule } from './tutor/tutor.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { ExamHistoryModule } from './exam-history/exam-history.module';
import { NoticesModule } from './notices/notices.module';
import { FeedbacksModule } from './feedbacks/feedbacks.module';
import { ExamSubmissionsModule } from './exam-submissions/exam-submissions.module';

// DATABASE_URL의 비밀번호 부분을 URL 인코딩하는 함수
function encodePasswordInUrl(url: string): string {
  try {
    // postgresql://username:password@host:port/database 형식 파싱.
    // 비밀번호 자체에 '@'가 들어있을 수 있어([^@]+로는 첫 '@'에서 잘못 끊김),
    // 마지막 '@' 앞까지를 비밀번호로 greedy하게 잡는다.
    const match = url.match(/^(postgresql:\/\/[^:]+:)(.+)(@[^@]+)$/);

    if (match) {
      const [, prefix, password, suffix] = match;
      const encodedPassword = encodeURIComponent(password);
      return `${prefix}${encodedPassword}${suffix}`;
    }

    return url;
  } catch (error) {
    console.error('URL 인코딩 실패:', error);
    return url;
  }
}

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get('DATABASE_URL');
        const nodeEnv = configService.get('NODE_ENV');
        // NODE_ENV(dev/prod)로 자동 판단하지 않는다 — 로컬 .env가 NODE_ENV=development인
        // 채로 운영 DATABASE_URL을 가리키는 사고가 실제로 있었음(synchronize가 켜져서
        // 운영 스키마를 건드릴 뻔함). 기본값은 항상 false, 진짜 필요할 때만
        // DB_SYNCHRONIZE=true를 명시적으로 켜도록 분리.
        const synchronize = configService.get('DB_SYNCHRONIZE') === 'true';
        // SSL도 NODE_ENV 기준으로 자동 판단하지 않는다 — Supabase 등 관리형 DB는 SSL이
        // 필요하지만, 자체 호스팅 Docker Postgres(같은 네트워크 내부)는 SSL이 없다.
        // 운영이라고 무조건 SSL을 켜면 자체 호스팅 DB 연결이 깨지므로 명시적으로 지정.
        const sslEnabled = configService.get('DB_SSL') === 'true';

        // 디버깅 로그
        console.log('=== TypeORM 설정 확인 ===');
        console.log('NODE_ENV:', nodeEnv);
        console.log('synchronize:', synchronize);
        console.log('======================');

        // URL의 비밀번호 부분을 인코딩
        const encodedUrl = databaseUrl ? encodePasswordInUrl(databaseUrl) : '';

        return {
          type: 'postgres',
          url: encodedUrl,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: synchronize, // 기본 false. DB_SYNCHRONIZE=true를 명시해야만 켜짐
          timezone: 'Asia/Seoul', // 한국 시간대 설정
          logging: false, // 로깅 비활성화
          ssl: sslEnabled ? { rejectUnauthorized: false } : false,
          extra: {
            ...(sslEnabled ? { ssl: { rejectUnauthorized: false } } : {}),
            // Connection Pool 최적화
            max: 20, // 최대 연결 수
            min: 5, // 최소 유지 연결 수
            idleTimeoutMillis: 30000, // 유휴 연결 타임아웃 (30초)
            connectionTimeoutMillis: 10000, // 연결 대기 타임아웃 (10초)
          },
        };
      },
      inject: [ConfigService],
    }),
    SubjectsModule,
    ExamsModule,
    QuestionsModule,
    DepartmentsModule,
    CrawlersModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TutorModule,
    BookmarksModule,
    ExamHistoryModule,
    NoticesModule,
    FeedbacksModule,
    ExamSubmissionsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
