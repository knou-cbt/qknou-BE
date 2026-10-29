import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';

@Module({
  //User Entity를 이 모듈에서 사용할 수 있도록 등록
  imports: [TypeOrmModule.forFeature([User])],
  // 사용자 생성은 OAuth 로그인(AuthService)에서만 함. 인증 없이 열려 있던
  // POST /users 컨트롤러는 쓰는 곳이 없어 제거.
  providers: [UsersService],
  //다른 모듈(AuthModule)에서 UsersService를 사용할 수 있도록 export
  //TypeOrmModule도 export하면 나중에 다른 곳에서 User Entity를 사용할 수 있다
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
