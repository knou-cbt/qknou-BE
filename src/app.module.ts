import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubjectsModule } from './subjects/subjects.module';
import { ExamsModule } from './exams/exams.module';
import { QuestionsModule } from './questions/questions.module';
import { ChoicesModule } from './choices/choices.module';

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
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get('DATABASE_URL');
        
        // URL의 비밀번호 부분을 인코딩
        const encodedUrl = databaseUrl ? encodePasswordInUrl(databaseUrl) : '';
        
        return {
          type: 'postgres',
          url: encodedUrl,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: true, // 기존 데이터와 충돌을 피하기 위해 비활성화
          ssl: {
            rejectUnauthorized: false,  
        },
          extra: {
            ssl: {
              rejectUnauthorized: false,
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    SubjectsModule,
    ExamsModule,
    QuestionsModule,
    ChoicesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
