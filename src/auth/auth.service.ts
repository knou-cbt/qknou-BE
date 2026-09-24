import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService, //사용자 DB 작업
    private jwtService: JwtService, //JWT 토큰 생성
    private configService: ConfigService,
  ) {}
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
  }): Promise<User> {
    //1. 이미 가입된 사용자인지 확인
    let user = await this.usersService.findByProviderId(
      oauthUser.provider,
      oauthUser.providerId,
    );
    if (!user) {
      //2-1. 처음 로그인하는 사용자 -> 회원가입
      console.log(`[Auth] 새 사용자 생성: ${oauthUser.email}`);
      user = await this.usersService.create({
        provider: oauthUser.provider,
        providerId: oauthUser.providerId,
        email: oauthUser.email,
        name: oauthUser.name,
      });
    } else {
      //2-2 기존 사용자 -> 정보 업데이트(프로필 이미지, 이름 변경 반영)
      console.log(`[Auth] 기존 사용자 로그인: ${user.email}`);
      user = await this.usersService.update(user.id, {
        name: oauthUser.name,
      });
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
        profileImage: user.profileImage,
      },
    };
  }

  /**
   * JWT 토큰에서 사용자 정보 추출
   * 프론트엔드가 보낸 토큰이 유효한지 확인하고 사용자 정보를 가져온다
   */
  async validateUser(userId: string): Promise<User | null> {
    return this.usersService.findById(userId);
  }

  /**
   * 관리자 로그인 (아이디/비밀번호)
   * 구글/카카오 로그인과 완전히 별개 경로. users 테이블을 쓰지 않고
   * ADMIN_USERNAME / ADMIN_PASSWORD_HASH 환경변수와 대조한다.
   */
  async loginAdmin(username: string, password: string) {
    console.log('[AdminLogin] 요청 수신');

    const adminUsername = this.configService.get<string>('ADMIN_USERNAME');
    const adminPasswordHash = this.configService.get<string>(
      'ADMIN_PASSWORD_HASH',
    );

    if (!adminUsername || !adminPasswordHash || username !== adminUsername) {
      throw new UnauthorizedException(
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    let passwordMatches: boolean;
    try {
      passwordMatches = await bcrypt.compare(password, adminPasswordHash);
    } catch (err) {
      // 500으로 뭉개지지 않도록 여기서 잡고, 로그에는 실제 원인을 남긴다
      console.error('[AdminLogin] bcrypt.compare 실패:', err);
      throw new UnauthorizedException(
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    if (!passwordMatches) {
      throw new UnauthorizedException(
        '아이디 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    let accessToken: string;
    try {
      const payload = { sub: 'admin', role: 'admin' as const };
      accessToken = this.jwtService.sign(payload);
    } catch (err) {
      console.error('[AdminLogin] JWT 서명 실패:', err);
      throw err;
    }
    console.log('[AdminLogin] 로그인 성공, 토큰 발급 완료');

    return {
      access_token: accessToken,
      user: { id: 'admin', role: 'admin', name: '관리자' },
    };
  }
}
