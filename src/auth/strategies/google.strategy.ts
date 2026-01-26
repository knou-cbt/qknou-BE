import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";
import { AuthService } from "../auth.service";

/**
 *  Strategy가 하는 일
 * 1.구글 OAuth 설정 (clientID, secret 등)
 * 2.사용자가 구글에서 로그인하면 구글이 사용자 정보를 이 Strategy에게 전달
 * 3.validate() 메서드가 자동으로 실행됨
 * 4.우리는 그 정보를 받아서 DB에 저장하고 done(null, user) 호출
 * 5.그러면 Controller의 req.user에서 사용자 정보에 접근 가능
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {  
  constructor(
    private configService: ConfigService, // .env 파일 읽기
    private authService: AuthService // 사용자 생성, 조회

  ) { 
    //부모 클래스(Strategy) 초기화
    super({
        //구글 OAuth 앱 설정
      clientID: configService.get('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL'),
      
    //구글에게 요청할 정보 범위
      scope: ['email', 'profile'],  // ✅ profile 추가!
          
      })
    }
  
  /**
   * 구글 로그인 성공 후 자동으로 호출되는 메서드
   * 실행 흐름:
   * 1. 사용자가 /auth/google 접속
   * 2. 구글 로그인 페이지로 리다이렉트
   * 3. 사용자가 구글에서 로그인
   * 4. 구글이 /auth/google/callback으로 리다이렉트
   * 5. 이 validate()메서드가 자동으로 실행됨
   */
  async validate(
    _accessToken: string, //구글 API 호출용 토큰(안씀)
    _refreshToken: string, //장기 토큰
    profile: any, //구글에서 받은 사용자 정보
    done: VerifyCallback //Passport에게 결과 전달하는 콜백
  ): Promise<any>{

    const { id, displayName, name, emails } = profile;

    // 이름 안전하게 추출 (name이 없을 수도 있음)
    let userName = displayName;  // 기본값: displayName 사용
    if (name?.givenName && name?.familyName) {
      userName = `${name.givenName} ${name.familyName}`;
    } else if (name?.givenName) {
      userName = name.givenName;
    }

    //DB에 저장할 형식으로 변환
    const oauthUser = {
      provider: 'google',
      providerId: id,
      email: emails?.[0]?.value || null,  // emails가 없을 수도 있음
      name: userName || 'Google User',  // 이름이 없으면 기본값
      profileImage: null,
    };

    //AuthService에서 DB에 저장/조회
    const user = await this.authService.validateOAuthUser(oauthUser);

    //done(null, user)를 호출하면 -> req.user에 user 객체가 담김
    //Controller에서 @Req() req를 통해 접근 가능
    done(null, user);
  }
}