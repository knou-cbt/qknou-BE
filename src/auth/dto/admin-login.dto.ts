import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ example: 'qknouadm' })
  @IsString()
  @MinLength(1)
  username: string;

  @ApiProperty({ example: 'password' })
  @IsString()
  @MinLength(1)
  password: string;
}
