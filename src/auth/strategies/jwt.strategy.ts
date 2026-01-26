import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import {ExtractJwt, Strategy} from 'passport-jwt';
import { AuthService } from "../auth.service";
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      // Authorization 헤더에서 Bearer 토큰 추출
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      //만료된 토큰은 거부
      ignoreExpiration: false,
      //JWT 검증 시크릿 키
      secretOrKey: configService.get('JWT_SECRET'),
      
    })
  }
  /**
   * JWT 토큰이 유효하면 자동으로 호출됨
   * payload는 토큰 안에 들어있는 데이터
   */
  async validate(payload: any) {
    //DB에서 사용자 확인(탈퇴했거나 없는 사용자면 거부)
    const user = await this.authService.validateUser(payload.sub)
    if (!user) {
      throw new UnauthorizedException('유효하지 않은 사용자입니다.');
    }
    // req.user에 담길 정보(컨트롤러에서 사용)
    return {
      id: user.id,
      email: user.email,
      name: user.name,
    }
  }
}