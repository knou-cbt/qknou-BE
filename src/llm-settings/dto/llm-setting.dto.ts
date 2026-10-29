import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  USER_LLM_PROVIDERS,
  UserLlmProvider,
} from '../entities/user-llm-setting.entity';

export class CreateLlmSettingDto {
  @ApiProperty({
    description:
      'openai=OpenAI, gemini=Google Gemini(OpenAI 호환 API), custom=그 외 OpenAI 호환 서버(baseUrl 필수)',
    enum: USER_LLM_PROVIDERS,
  })
  @IsIn(USER_LLM_PROVIDERS)
  provider: UserLlmProvider;

  @ApiPropertyOptional({
    description:
      'provider=custom일 때 필수. https만 허용, 내부망 주소 불가. "/v1"까지만 (예: https://my-llm.example.com/v1)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @ApiProperty({ description: '모델 이름', example: 'gpt-4o-mini' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model: string;

  @ApiPropertyOptional({
    description:
      'API Key. openai/gemini는 필수. 저장 시 암호화되며 응답에는 끝 4자리만 표시됨',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({
    description: 'false면 등록만 해두고 기본 LLM 사용',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateLlmSettingDto extends PartialType(CreateLlmSettingDto) {}
