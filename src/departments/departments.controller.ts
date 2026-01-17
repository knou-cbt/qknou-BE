import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

    /**
   * GET /api/departments
   * 학과 목록 조회 (옵션: 대학별 필터링)
   */
  @Get()
  async findAll() {
    const data = await this.departmentsService.findAll()
    return {success: true, data}
  }

   /**
   * GET /api/departments/:id/subjects
   * 특정 학과의 과목들
   */
  @Get(':id/subjects')
  async findSubjectByDepartment(@Param('id', ParseIntPipe) id: number) { 
    const data = await this.departmentsService.findSubjectByDepartment(id)
    return {success: true, data}
  }
}
