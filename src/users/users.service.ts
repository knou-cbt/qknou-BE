import { Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';

//DB에서 사용자를 찾거나 생성하는 로직
@Injectable()
export class UsersService {
  //TypeORM의 Repository를 주입받아 DB 작업을 수행한다
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>
  ) {}
  
  /**
   * provider와 providerId로 사용자 찾기
   * 이미 가입한 사용자인지 확인하는 용도
   */
  async findByProviderId(
    provider: string,
    providerId: string
  ): Promise<User | null>{
    return this.usersRepository.findOne({
      where: {
        provider, // 'google' 또는 'kakao'
        providerId //OAuth에서 받은 사용자 ID
      }
    })
  }

  //이메일로 사용자 찾기 (나중에 계정 연동 기능에서 사용)
  async findByEmail(email: string): Promise<User | null>{
    return this.usersRepository.findOne({
      where: {
        email
      }
    })
  }

  //ID로 사용자 찾기 (로그인 후 JWT에서 사용자 정보 가져올 때 사용)
  async findById(id: string): Promise<User | null>{
    return this.usersRepository.findOne({
      where: {
        id
      }
    })
  }

  //create와 update를 분리해 신규 가입과 기존 사용자 로그인을 구분함
  // Partial<User>는 User의 일부 속성만 받겠다는 의미(유연성 확보)
  //새 사용자 생성, OAuth 로그인 시 처음 가입하는 경우 호출됨
  async create(userData: Partial<User>): Promise<User>{
    // create()는 엔티티 인스턴스만 만들고
    const user = this.usersRepository.create(userData);
    //save()가 실제로 DB에 저장함
    return this.usersRepository.save(user);

  }
  //사용자 정보 업데이트, 로그인할 떄마다 프로필 이미지나 이름이 바뀌었을 수 있으니 업데이트
  async update(id: string, userData: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, userData);
    return this.usersRepository.findOne({where: {id}})
  }
}
