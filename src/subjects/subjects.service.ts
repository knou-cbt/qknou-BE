import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from './entities/subject.entity';

/**
 * 과목(Subject) 관련 비즈니스 로직을 처리하는 서비스
 * 과목의 조회, 생성 등의 기능을 제공합니다.
 */
@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
  ) {}

  /**
   * 과목 이름으로 조회하고, 없으면 새로 생성합니다.
   * 
   * @param name - 조회할 과목 이름
   * @returns 기존 과목 또는 새로 생성된 과목
   */
  async findOrCreateByName(name: string): Promise<Subject> {
    // 이름으로 기존 과목 조회
    let subject = await this.subjectRepository.findOne({ where: { name } });
    
    // 과목이 존재하지 않으면 새로 생성
    if (!subject) {
      subject = this.subjectRepository.create({ name });
      subject = await this.subjectRepository.save(subject);
      console.log(`✨ 새 과목 생성: ${name}`);
    }
    
    return subject;
  }
}
