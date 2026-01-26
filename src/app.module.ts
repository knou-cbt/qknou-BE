import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubjectsModule } from './subjects/subjects.module';
import { ExamsModule } from './exams/exams.module';
import { QuestionsModule } from './questions/questions.module';
import { DepartmentsModule } from './departments/departments.module';
import { CrawlersModule } from './crawlers/crawlers.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

// DATABASE_URL의 비밀번호 부분을 URL 인코딩하는 함수
function encodePasswordInUrl(url: string): string {
  try {
    // postgresql://username:password@host:port/database 형식 파싱
    const match = url.match(/^(postgresql:\/\/[^:]+:)([^@]+)(@.+)$/);
    
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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env'
  ],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get('DATABASE_URL');
        const nodeEnv = configService.get('NODE_ENV');
        const synchronize = nodeEnv !== 'production';
        
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
          synchronize: synchronize, // 프로덕션에서는 false
          timezone: 'Asia/Seoul', // 한국 시간대 설정
          logging: false, // 로깅 비활성화
          ssl: nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
          extra: {
            ssl: {
              rejectUnauthorized: false,
            },
            // Connection Pool 최적화
            max: 20,              // 최대 연결 수
            min: 5,               // 최소 유지 연결 수
            idleTimeoutMillis: 30000,  // 유휴 연결 타임아웃 (30초)
            connectionTimeoutMillis: 10000,  // 연결 대기 타임아웃 (10초)
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
