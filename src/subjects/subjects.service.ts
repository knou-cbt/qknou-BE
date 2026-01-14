import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from './entities/subject.entity';

@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
  ) {}

  async findOrCreateByName(name: string): Promise<Subject> {
    let subject = await this.subjectRepository.findOne({ where: { name } });
    
    if (!subject) {
      subject = this.subjectRepository.create({ name });
      subject = await this.subjectRepository.save(subject);
      console.log(`✨ 새 과목 생성: ${name}`);
    }
    
    return subject;
  }
}
