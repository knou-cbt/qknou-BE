import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy } from "passport-kakao";
import { AuthService } from "../auth.service";

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, 'kakao') { 
  constructor(
    private configService: ConfigService,
    private authService: AuthService
  ) {
    super({
      //카카오 OAuth앱 설정
      clientID: configService.get('KAKAO_CLIENT_ID'), //REST API Key
      clientSecret: configService.get('KAKAO_CLIENT_SECRET'), //Client Secret
      callbackURL: configService.get('KAKAO_CALLBACK_URL'), //Redirect URI
      scope: ['profile_nickname'], // 닉네임 권한 요청
    });
  }

  //카카오 로그인 성공 후 자동으로 호출
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: any
  ): Promise<any> { 
    const { id, username, _json } = profile;
    
    // 닉네임 추출 (여러 경로 시도)
    const nickname = _json?.kakao_account?.profile?.nickname 
                  || _json?.properties?.nickname 
                  || username 
                  || '사용자';
    
    const oauthUser = {
      provider: 'kakao',
      providerId: id.toString(),
      email: _json?.kakao_account?.email || null,
      name: nickname,
      profileImage: _json?.kakao_account?.profile?.profile_image_url 
                 || _json?.properties?.profile_image 
                 || null,
    }
    
    const user = await this.authService.validateOAuthUser(oauthUser);
    done(null, user);
    }
}