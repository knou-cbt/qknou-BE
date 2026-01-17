import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubjectsModule } from './subjects/subjects.module';
import { ExamsModule } from './exams/exams.module';
import { QuestionsModule } from './questions/questions.module';
import { DepartmentsModule } from './departments/departments.module';

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
        
        // URL의 비밀번호 부분을 인코딩
        const encodedUrl = databaseUrl ? encodePasswordInUrl(databaseUrl) : '';
        
        return {
          type: 'postgres',
          url: encodedUrl,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get('NODE_ENV') !== 'production', // 프로덕션에서는 false
          timezone: 'Asia/Seoul', // 한국 시간대 설정
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
    DepartmentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
