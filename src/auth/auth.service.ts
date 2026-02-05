import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService, //사용자 DB 작업
    private jwtService: JwtService //JWT 토큰 생성
  ) { }
  /**
   * OAuth로 받은 사용자 정보를 검증하고 DB에 저장/업데이트
   * 
   * 이 메서드가 하는 일:
   * 1. DB에 이 사용자가 이미 있는지 확인
   * 2. 없으면 새로 생성(회원가입)
   * 3. 있으면 정보 업데이트(프로필 변경 반영)
   */
  async validateOAuthUser(oauthUser: {
    provider: string; //google or kakako
    providerId: string; //OAuth에서 받은 사용자 ID
    email: string; 
    name: string;
  }): Promise<User>{
    //1. 이미 가입된 사용자인지 확인 
    let user = await this.usersService.findByProviderId(oauthUser.provider, oauthUser.providerId)
    if (!user) {
      //2-1. 처음 로그인하는 사용자 -> 회원가입
      console.log(`[Auth] 새 사용자 생성: ${oauthUser.email}`)
      user = await this.usersService.create({
        provider: oauthUser.provider,
        providerId: oauthUser.providerId,
        email: oauthUser.email,
        name: oauthUser.name,
      })
    } else {
      //2-2 기존 사용자 -> 정보 업데이트(프로필 이미지, 이름 변경 반영)
      console.log(`[Auth] 기존 사용자 로그인: ${user.email}`);
      user = await this.usersService.update(user.id, {
        name: oauthUser.name,
      })
    }
    return user;
  }

  /**
   * JWT 토큰 생성
   * 로그인 성공 후 프론트엔드에게 전달할 토큰을 만든다
   * 이 토큰으로 사용자 인증을 한다
   */
  async login(user: User) {
    //JWT의 payload (토큰 안에 들어갈 데이터)
    const payload = {
      sub: user.id, //sub는 JWT표준 필드(subject = 사용자 id)
      email: user.email,
      name: user.name, // 사용자 이름(닉네임)
    };
    //JWT 토큰 생성(환경변수의 JWT_SECRET으로 서명됨)
    const accessToken = this.jwtService.sign(payload);
    
    return {
      access_token: accessToken,
      //프론트엔드에서 바로 사용할 수 있는 사용자 정보도 함께 반환
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImage: user.profileImage
      }
    };
  }

  /**
   * JWT 토큰에서 사용자 정보 추출
   * 프론트엔드가 보낸 토큰이 유효한지 확인하고 사용자 정보를 가져온다
   */
  async validateUser(userId: string): Promise<User | null> { 
    return this.usersService.findById(userId);
  }

}
