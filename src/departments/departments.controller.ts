import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DepartmentsService } from './departments.service';

@ApiTags('departments')
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

    /**
   * GET /api/departments
   * 학과 목록 조회 (옵션: 대학별 필터링)
   */
  @Get()
  @ApiOperation({ 
    summary: '학과 목록 조회', 
    description: '모든 학과 목록을 조회합니다.' 
  })
  @ApiResponse({ status: 200, description: '학과 목록 조회 성공' })
  async findAll() {
    const data = await this.departmentsService.findAll()
    return {success: true, data}
  }

   /**
   * GET /api/departments/:id/subjects
   * 특정 학과의 과목들
   */
  @Get(':id/subjects')
  @ApiOperation({ 
    summary: '학과별 과목 목록 조회', 
    description: '특정 학과에 속한 모든 과목을 조회합니다.' 
  })
  @ApiParam({ name: 'id', description: '학과 ID', type: Number })
  @ApiResponse({ status: 200, description: '과목 목록 조회 성공' })
  @ApiResponse({ status: 404, description: '학과를 찾을 수 없습니다' })
  async findSubjectByDepartment(@Param('id', ParseIntPipe) id: number) { 
    const data = await this.departmentsService.findSubjectByDepartment(id)
    return {success: true, data}
  }
}
