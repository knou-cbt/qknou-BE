import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { ExamsService } from '../exams/exams.service';
import { SubjectsService } from '../subjects/subjects.service';

@ApiTags('health')
@Controller('api/health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly examsService: ExamsService,
    private readonly subjectsService: SubjectsService,
  ) {}

  /**
   * 기본 Health Check
   */
  @Get()
  @ApiOperation({ summary: '서버 상태 확인' })
  @ApiResponse({ status: 200, description: '서버 정상 작동' })
  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  /**
   * 성능 측정 엔드포인트
   * 운영 서버에서 실제 성능을 측정합니다.
   */
  @Get('performance')
  @ApiOperation({ 
    summary: '성능 측정', 
    description: '실제 운영 환경에서 API 성능을 측정합니다. DB ping, 쿼리 실행 시간 등을 반환합니다.' 
  })
  @ApiResponse({ status: 200, description: '성능 측정 완료' })
  async checkPerformance() {
    const results = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      tests: [],
    };

    try {
      // 1. DB Ping 테스트 (가장 간단한 쿼리)
      const dbPingStart = performance.now();
      await this.dataSource.query('SELECT 1');
      const dbPingTime = performance.now() - dbPingStart;
      
      results.tests.push({
        name: 'db_ping',
        description: 'Simple SELECT 1 query',
        time_ms: Number(dbPingTime.toFixed(2)),
        status: 'success',
      });

      // 2. Connection Pool 상태
      const poolStatus = {
        name: 'connection_pool',
        description: 'Current pool status',
        // @ts-ignore - TypeORM 내부 속성 접근
        active: this.dataSource.driver?.master?.totalCount || 'N/A',
        // @ts-ignore
        idle: this.dataSource.driver?.master?.idleCount || 'N/A',
      };
      results.tests.push(poolStatus);

      // 3. 과목별 시험 조회 (7개 항목)
      const findExamsStart = performance.now();
      await this.subjectsService.findExamsBySubject(1);
      const findExamsTime = performance.now() - findExamsStart;
      
      results.tests.push({
        name: 'findExamsBySubject',
        description: 'Fetch 7 exams for subject 1',
        time_ms: Number(findExamsTime.toFixed(2)),
        status: 'success',
      });

      // 4. 문제 조회 (5개 페이지네이션)
      const findQuestionsStart = performance.now();
      await this.examsService.findQuestions(1, 'test', 1, 5);
      const findQuestionsTime = performance.now() - findQuestionsStart;
      
      results.tests.push({
        name: 'findQuestions_paginated',
        description: 'Fetch 5 questions (page 1)',
        time_ms: Number(findQuestionsTime.toFixed(2)),
        status: 'success',
      });

      // 5. 전체 문제 조회 (35개)
      const findAllQuestionsStart = performance.now();
      await this.examsService.findQuestions(1, 'test');
      const findAllQuestionsTime = performance.now() - findAllQuestionsStart;
      
      results.tests.push({
        name: 'findQuestions_full',
        description: 'Fetch all 35 questions',
        time_ms: Number(findAllQuestionsTime.toFixed(2)),
        status: 'success',
      });

      // 6. 과목 목록 조회
      const findSubjectsStart = performance.now();
      await this.subjectsService.findAll(undefined, 1, 10);
      const findSubjectsTime = performance.now() - findSubjectsStart;
      
      results.tests.push({
        name: 'findSubjects',
        description: 'Fetch 10 subjects',
        time_ms: Number(findSubjectsTime.toFixed(2)),
        status: 'success',
      });

      // 요약 통계
      const times = results.tests
        .filter(t => typeof t.time_ms === 'number')
        .map(t => t.time_ms);
      
      return {
        ...results,
        summary: {
          total_tests: times.length,
          avg_time_ms: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)),
          min_time_ms: Number(Math.min(...times).toFixed(2)),
          max_time_ms: Number(Math.max(...times).toFixed(2)),
        },
      };

    } catch (error) {
      return {
        ...results,
        error: error.message,
        status: 'failed',
      };
    }
  }

  /**
   * DB 연결 상태 확인
   */
  @Get('db')
  @ApiOperation({ summary: 'DB 연결 상태 확인' })
  @ApiResponse({ status: 200, description: 'DB 연결 정상' })
  async checkDatabase() {
    try {
      await this.dataSource.query('SELECT NOW()');
      return {
        status: 'connected',
        driver: this.dataSource.driver.constructor.name,
        database: this.dataSource.driver.database,
      };
    } catch (error) {
      return {
        status: 'disconnected',
        error: error.message,
      };
    }
  }
}
