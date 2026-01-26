import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from 'src/users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { GoogleStrategy } from './strategies/google.strategy';
import { KakaoStrategy } from './strategies/kakao.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    
    // JWT 모듈 설정
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],  // ConfigService 주입
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        // 토큰 만료 시간 설정
        signOptions: { 
          expiresIn: configService.get('JWT_EXPIRES_IN') || '7d' 
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, KakaoStrategy, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
