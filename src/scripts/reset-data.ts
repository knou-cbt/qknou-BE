import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';

/**
 * 더미 데이터 삭제 스크립트
 * - department를 제외한 모든 데이터 삭제
 * - explanation 컬럼 추가 (없을 경우)
 */
async function bootstrap() {
  console.log('🔧 데이터 리셋 시작...\n');
  
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  try {
    await dataSource.query('BEGIN');

    // 1. 기존 데이터 삭제 (department 제외)
    console.log('🗑️  기존 데이터 삭제 중...');
    
    // CASCADE로 인해 questions도 자동 삭제됨
    await dataSource.query('DELETE FROM exams');
    console.log('  ✅ exams 데이터 삭제 완료');
    
    // questions는 이미 CASCADE로 삭제되었지만 명시적으로 실행
    await dataSource.query('DELETE FROM questions');
    console.log('  ✅ questions 데이터 삭제 완료');
    
    await dataSource.query('DELETE FROM subjects');
    console.log('  ✅ subjects 데이터 삭제 완료');

    // 2. explanation 컬럼 추가 (없을 경우)
    console.log('\n📝 explanation 컬럼 확인 중...');
    
    const columnCheck = await dataSource.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'questions' 
        AND column_name = 'explanation'
    `);

    if (columnCheck.length === 0) {
      console.log('  ➕ explanation 컬럼 추가 중...');
      await dataSource.query(`
        ALTER TABLE questions 
        ADD COLUMN explanation text NULL
      `);
      console.log('  ✅ explanation 컬럼 추가 완료');
    } else {
      console.log('  ℹ️  explanation 컬럼이 이미 존재합니다');
    }

    // 3. 시퀀스 리셋 (ID를 1부터 다시 시작)
    console.log('\n🔄 시퀀스 리셋 중...');
    await dataSource.query('ALTER SEQUENCE exams_id_seq RESTART WITH 1');
    await dataSource.query('ALTER SEQUENCE questions_id_seq RESTART WITH 1');
    await dataSource.query('ALTER SEQUENCE subjects_id_seq RESTART WITH 1');
    console.log('  ✅ 시퀀스 리셋 완료');

    await dataSource.query('COMMIT');

    console.log('\n✅ 데이터 리셋 완료!');
    console.log('\n📊 현재 상태:');
    
    const examCount = await dataSource.query('SELECT COUNT(*) FROM exams');
    const questionCount = await dataSource.query('SELECT COUNT(*) FROM questions');
    const subjectCount = await dataSource.query('SELECT COUNT(*) FROM subjects');
    const deptCount = await dataSource.query('SELECT COUNT(*) FROM departments');

    console.log(`  - exams: ${examCount[0].count}개`);
    console.log(`  - questions: ${questionCount[0].count}개`);
    console.log(`  - subjects: ${subjectCount[0].count}개`);
    console.log(`  - departments: ${deptCount[0].count}개 (유지됨)`);

  } catch (error: any) {
    await dataSource.query('ROLLBACK');
    console.error('\n❌ 에러 발생:', error.message);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
