import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { Subject } from './entities/subject.entity';
import { Exam } from 'src/exams/entities/exam.entity';

/**
 * 과목(Subject) 관련 비즈니스 로직을 처리하는 서비스
 * 과목의 조회, 생성 등의 기능을 제공합니다.
 */
@Injectable()
export class SubjectsService {
  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>
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
      console.log(`새 과목 생성: ${name}`);
    }
    
    return subject;
  }

  //과목 목록 조회(검색+페이지네이션)
  /**
   * @param search - 과목명 검색어(선택사항)
   * @param page - 페이지 번호(선택사항, 기본값 1)
   * @param limit - 페이지당 항목 수(선택사항, 기본값 10)
   * @returns 과목 목록
   */
  async findAll(search?: string, page: number = 1, limit: number = 10) {
    //1.skip계산(건너뛸 항목 수)
    const skip = (page - 1) * limit;

    //2.WHERE 조건(검색어가 있으면 LIKE 검색)
    const where =search ? { name: Like(`%${search}%`) } : {};

    //3.DB 조회
    const [subjects, total] = await this.subjectRepository.findAndCount({
      where,
      skip,
      take: limit,
      order: { name: 'ASC'}
    });
    //4.응답 형식으로 변환
    return {
      subjects: subjects.map(subject => ({
        id: subject.id,
        name: subject.name,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * 특정 과목 상세 조회
   */
  async findOne(id: number) {
    //1.DB에서 과목을 조회
    const subject = await this.subjectRepository.findOne({
      where: {id},
    })
    //2. 없으면 404 에러
    if (!subject) {
      throw new NotFoundException(`과목 id ${id}를 찾을 수 없습니다.`)
    }
    //3. 있으면 응답 형식으로 변환
    return {
      id: subject.id,
      name: subject.name,
    }
  }

  /**
   *  특정 과목의 시험지 목록 조회
   *  @param subjectId - 과목 ID
   */
  async findExamsBySubject(subjectId: number) {
    const subject = await this.subjectRepository.findOne({
      where: { id: subjectId }
    })

    if (!subject) {
      throw new NotFoundException(`과목 id ${subjectId}를 찾을 수 없습니다.`)
    }

    const exams = await this.examRepository.find({
      where: { subject_id: subjectId },
      order:{year:'DESC', exam_type:'ASC'}
    })

    return exams.map(exam => ({
      id: exam.id,
      title: exam.title,
      year: exam.year,
      examType: exam.exam_type,
    }))
  }

}
