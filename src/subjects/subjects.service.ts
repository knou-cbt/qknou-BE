import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subject } from './entities/subject.entity';
import { Exam } from 'src/exams/entities/exam.entity';

/**
 * 과목(Subject) 관련 비즈니스 로직을 처리하는 서비스
 * 과목의 조회, 생성 등의 기능을 제공합니다.
 */
@Injectable()
export class SubjectsService implements OnModuleInit {
  // 전체 과목 수 캐시 (과목은 거의 변하지 않으므로 캐싱)
  private totalSubjectsCache: number | null = null;

  constructor(
    @InjectRepository(Subject)
    private subjectRepository: Repository<Subject>,
    @InjectRepository(Exam)
    private examRepository: Repository<Exam>
  ) {}

  /**
   * 모듈 초기화 시 캐시 예열 (Cache Warming)
   * 서버 시작 시 자동으로 전체 과목 수를 캐싱하여
   * 첫 번째 사용자도 빠른 응답을 받을 수 있도록 함
   */
  async onModuleInit() {
    await this.warmupCache();
  }

  /**
   * 캐시 예열 메서드
   * 전체 과목 수를 미리 계산하여 캐시에 저장
   */
  private async warmupCache() {
    try {
      console.log('📊 [SubjectsService] 캐시 예열 시작...');
      const start = Date.now();
      
      this.totalSubjectsCache = await this.subjectRepository.count();
      
      const duration = Date.now() - start;
      console.log(`✅ [SubjectsService] 전체 과목 수: ${this.totalSubjectsCache}개 캐시 완료 (${duration}ms)`);
    } catch (error) {
      console.error('❌ [SubjectsService] 캐시 예열 실패:', error.message);
      // 캐시 예열 실패해도 서버는 계속 실행 (첫 요청 시 캐싱됨)
    }
  }

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
      
      // 캐시 무효화 (새 과목이 추가되었으므로)
      this.totalSubjectsCache = null;
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
    //1. skip 계산(건너뛸 항목 수)
    const skip = (page - 1) * limit;

    //3. 전체 과목 수 캐싱 (검색어가 없을 때만)
    if (!search && !this.totalSubjectsCache) {
      this.totalSubjectsCache = await this.subjectRepository.count();
    }

    //4. DB 조회 (검색어가 있으면 findAndCount, 없으면 find만)
    let subjects: Subject[];
    let total: number;

    if (search) {
      // 검색어가 있으면 LOWER로 대소문자 구분 없이 LIKE 검색
      const qb = this.subjectRepository
        .createQueryBuilder('subject')
        .select(['subject.id', 'subject.name'])
        .where('LOWER(subject.name) LIKE LOWER(:search)', { search: `%${search}%` })
        .orderBy('subject.name', 'ASC')
        .skip(skip)
        .take(limit);
      subjects = await qb.getMany();
      total = await qb.getCount();
    } else {
      // 검색어가 없으면 캐시된 total 사용
      subjects = await this.subjectRepository
        .createQueryBuilder('subject')
        .select(['subject.id', 'subject.name'])
        .orderBy('subject.name', 'ASC')
        .skip(skip)
        .take(limit)
        .getMany();
      total = this.totalSubjectsCache!;
    }

    //5. 응답 형식으로 변환
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
   *  특정 과목의 시험지 목록 조회 (최적화: QueryBuilder 사용)
   *  @param subjectId - 과목 ID
   */
  async findExamsBySubject(subjectId: number) {
    // QueryBuilder로 필요한 필드만 선택 (1번 쿼리로 처리)
    const exams = await this.examRepository
      .createQueryBuilder('exam')
      .select(['exam.id', 'exam.title', 'exam.year', 'exam.exam_type'])
      .where('exam.subject_id = :subjectId', { subjectId })
      .orderBy('exam.year', 'DESC')
      .addOrderBy('exam.exam_type', 'ASC')
      .getMany();

    // 시험지가 없으면 404
    if (exams.length === 0) {
      throw new NotFoundException(`과목 id ${subjectId}의 시험지를 찾을 수 없습니다.`)
    }

    return exams.map(exam => ({
      id: exam.id,
      title: exam.title,
      year: exam.year,
      examType: exam.exam_type,
    }))
  }

}
