import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { GetSubjectsQueryDto } from './dto/get-subjects-query.dto';

@ApiTags('subjects')
@Controller('api/subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) { }
  
  /**
   * GET /api/subjects 
   * 과목 목록 조회(검색+페이지네이션) 
   * @param query - 검색어, 페이지, 페이지당 항목 수
   * @returns 과목 목록
   */
  @Get()
  @ApiOperation({ 
    summary: '과목 목록 조회', 
    description: '과목 목록을 조회합니다. 검색어로 필터링하고 페이지네이션을 지원합니다.' 
  })
  @ApiResponse({ status: 200, description: '과목 목록 조회 성공' })
  async findAll(@Query() query: GetSubjectsQueryDto) {
    const data = await this.subjectsService.findAll(query.search, query.page, query.limit);

    return {success: true, data}
   }

  /**
   * Get /api/subjects/:id
   * 특정 과목 상세 조회
   */
  @Get(':id')
  @ApiOperation({ 
    summary: '과목 상세 조회', 
    description: '특정 과목의 상세 정보를 조회합니다.' 
  })
  @ApiParam({ name: 'id', description: '과목 ID', type: Number })
  @ApiResponse({ status: 200, description: '과목 조회 성공' })
  @ApiResponse({ status: 404, description: '과목을 찾을 수 없습니다' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.subjectsService.findOne(id);
    return {success: true, data}  
  } 

  /**
   * GET /api/subjects/:subjectId/exams
   * 
   */
  @Get(':subjectId/exams')
  @ApiOperation({ 
    summary: '과목별 시험 목록 조회', 
    description: '특정 과목의 모든 시험 목록을 조회합니다.' 
  })
  @ApiParam({ name: 'subjectId', description: '과목 ID', type: Number })
  @ApiResponse({ status: 200, description: '시험 목록 조회 성공' })
  @ApiResponse({ status: 404, description: '과목을 찾을 수 없습니다' })
  async findExamsBySubject(@Param('subjectId', ParseIntPipe) subjectId: number) {
    const data = await this.subjectsService.findExamsBySubject(subjectId);
    return {success: true, data}
  }
}
