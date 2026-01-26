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
    });
  }

  //카카오 로그인 성공 후 자동으로 호출
  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: any
  ): Promise<any> { 
    // 카카오 profile 구조:
    // {
    //   id: "1234567890",
    //   username: "홍길동",
    //   _json: {
    //     kakao_account: {
    //       email: "hong@kakao.com",
    //       profile: {
    //         nickname: "홍길동",
    //         profile_image_url: "https://...profile.jpg"
    //       }
    //     }
    //   }
    // }
    const { id, username, _json } = profile;
    //카카오는 이메일을 제공하지 않을 수도 있음(사용자가 거부 가능)
    const oauthUser = {
      provider: 'kakako',
      providerId: id.toString(),
      email: _json.kakao_account?.email || null,
      name: _json.kakao_account?.profile.nickname || username,
      profileImage:null,
    }
    const user = await this.authService.validateOAuthUser(oauthUser);
    done(null, user);
    }
}