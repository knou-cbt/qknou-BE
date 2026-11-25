import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, ValidateIf } from 'class-validator';
import { AI_PROVIDERS, AiProvider } from '../ai-providers';

export class PutAiConnectionDto {
  @ApiProperty({
    description:
      '제공사 API Key. 앞뒤 공백 제거 후 10~512자. 저장 전에 제공사에 확인하며, 암호화돼 저장되고 응답에는 마스킹된 값만 나옴',
    example: 'sk-proj-...',
  })
  // 길이는 공백 제거 후 서비스에서 검사 (FE 문구와 맞추려고 400 하나로 통일)
  @IsString()
  apiKey: string;
}

export class PatchActiveProviderDto {
  @ApiProperty({
    description: '튜터가 쓸 제공사. null이면 큐노 기본 AI',
    enum: AI_PROVIDERS,
    nullable: true,
  })
  @ValidateIf((_, value) => value !== null)
  @IsIn(AI_PROVIDERS)
  activeProvider: AiProvider | null;
}
