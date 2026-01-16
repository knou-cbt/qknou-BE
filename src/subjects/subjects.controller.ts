import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { GetSubjectsQueryDto } from './dto/get-subjects-query.dto';

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
  async findAll(@Query() query: GetSubjectsQueryDto) {
    const data = await this.subjectsService.findAll(query.search, query.page, query.limit);

    return {success: true, data}
   }

  /**
   * Get /api/subjects/:id
   * 특정 과목 상세 조회
   */
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const data = await this.subjectsService.findOne(id);
    return {success: true, data}  
  } 

}
