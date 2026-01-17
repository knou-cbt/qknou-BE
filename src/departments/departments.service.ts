import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Department } from './entities/department.entity';
import { Repository } from 'typeorm';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private departmentRepository:Repository<Department>
  ) { }
  
  //전체 학과 목록 조회
  async findAll() {
    return await this.departmentRepository.find({
      order: {
        name: 'ASC'
      }
    })
  }


  //특정 학과의 과목들 조회
  async findSubjectByDepartment(departmentId: number) {
    const department = await this.departmentRepository.findOne({
      where: { id: departmentId },
      relations: ['subjects']
    })
    
    if (!department) {
      throw new NotFoundException(`학과를 찾을 수 없습니다. (ID: ${departmentId})`);
    }

    return department.subjects

  }
}
