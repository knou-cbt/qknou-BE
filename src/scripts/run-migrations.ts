/**
 * migrations/ 폴더의 .sql 파일을 파일명(날짜) 순서대로 실행한다.
 * 전부 IF NOT EXISTS / OR REPLACE 기반이라 여러 번 실행해도 안전(idempotent)하다.
 * CHECK_FIRST가 파일명에 붙은 마이그레이션은 안전 확인 후 별도로 손으로 실행할 것 —
 * 이 스크립트는 그런 파일을 자동으로 건너뛴다.
 *
 * 사용법: NODE_ENV=development \
 *   yarn ts-node -r tsconfig-paths/register src/scripts/run-migrations.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const nodeEnv = process.env.NODE_ENV || 'development';
if (nodeEnv === 'production') {
  console.error(
    '❌ NODE_ENV=production 상태에서는 이 스크립트를 실행할 수 없습니다.',
  );
  process.exit(1);
}

dotenv.config({ path: path.resolve(__dirname, `../../.env.${nodeEnv}`) });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function encodePasswordInUrl(url: string): string {
  const match = url.match(/^(postgresql:\/\/[^:]+:)(.+)(@[^@]+)$/);
  if (!match) return url;
  const [, prefix, password, suffix] = match;
  return `${prefix}${encodeURIComponent(password)}${suffix}`;
}

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error('❌ DATABASE_URL이 없습니다.');
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql') && !f.includes('CHECK_FIRST'))
    .sort();

  console.log(`대상 DB: ${rawUrl.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`적용할 마이그레이션 ${files.length}개:`);
  files.forEach((f) => console.log(`  - ${f}`));

  const client = new Client({
    connectionString: encodePasswordInUrl(rawUrl),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`\n▶ ${file} 실행 중...`);
      await client.query(sql);
      console.log(`✅ ${file} 완료`);
    }
  } finally {
    await client.end();
  }

  console.log('\n✅ 전체 마이그레이션 완료');
}

main().catch((err) => {
  console.error('❌ 마이그레이션 실패:', err);
  process.exit(1);
});
