# 데이터베이스 인덱스로 API 응답 속도 480배 개선하기

> 방송대 기출문제 서비스 개발 중 겪은 성능 문제와 해결 과정

## 🚨 문제 상황

사이드 프로젝트로 방송대 기출문제 서비스를 개발하던 중, 크롤링으로 데이터를 많이 넣고 나니 갑자기 **페이지 로딩이 너무 느려지는 문제**가 발생했습니다.

- 과목 목록 페이지: 로딩이 느림
- 시험 문제 조회: 체감상 2~3초 대기
- 과목별 시험 목록: 1초 이상 소요

처음에는 "데이터가 좀 많아져서 그런가?" 정도로 생각했는데, 실제로 측정해보니 심각한 수준이었습니다.

## 📊 데이터 규모

```
- Subjects (과목): 539건
- Exams (시험지): 3,191건
- Questions (문제): 106,495건 (10만 건!)
```

크롤링을 열심히 돌린 결과 문제 데이터만 10만 건이 넘었습니다.

## 🔍 원인 분석

PostgreSQL의 `EXPLAIN ANALYZE`로 쿼리를 분석해보니 문제를 발견했습니다.

### 문제의 쿼리
```sql
EXPLAIN ANALYZE 
SELECT * FROM questions WHERE exam_id = 1;
```

### 결과
```
Seq Scan on questions  (cost=0.00..9197.19 rows=36 width=1088) 
  (actual time=0.022..24.968 rows=35 loops=1)
  Filter: (exam_id = 1)
  Rows Removed by Filter: 106460  ⚠️ 이게 문제!
Execution Time: 24.968 ms
```

**문제점:**
- `Seq Scan` (Sequential Scan) = 처음부터 끝까지 전체 스캔
- 106,495개 중 35개를 찾기 위해 **106,460개를 불필요하게 검사**
- `exam_id` 컬럼에 **인덱스가 없었음**

마치 전화번호부를 순서 없이 처음부터 끝까지 넘기면서 찾는 격이었습니다.

## 💡 해결 방법: 인덱스 추가

### 1. 인덱스가 필요한 컬럼 파악

자주 사용되는 WHERE 조건들을 분석했습니다:

```typescript
// 1. 시험 문제 조회 (가장 빈번)
SELECT * FROM questions WHERE exam_id = ?

// 2. 과목별 시험 목록
SELECT * FROM exams WHERE subject_id = ?

// 3. 중복 체크 (크롤링 시)
SELECT * FROM exams WHERE year = ? AND exam_type = ?

// 4. 과목 목록 (페이지네이션)
SELECT * FROM subjects ORDER BY name LIMIT 10
```

### 2. TypeORM 인덱스 추가

```typescript
// questions.entity.ts
import { Index } from "typeorm";

@Entity('questions')
@Index('IDX_questions_exam_id', ['exam_id'])  // 추가!
export class Question {
  @Column({type:'int'})
  exam_id: number;
  // ...
}
```

```typescript
// exam.entity.ts
@Entity('exams')
@Index('IDX_exams_subject_id', ['subject_id'])
@Index('IDX_exams_year_exam_type', ['year', 'exam_type']) // 복합 인덱스
export class Exam {
  // ...
}
```

```typescript
// subject.entity.ts
@Entity('subjects')
@Index('IDX_subjects_name', ['name'])  // ORDER BY 최적화
export class Subject {
  // ...
}
```

### 3. 인덱스 생성 확인

앱을 재시작하면 TypeORM이 자동으로 인덱스를 생성합니다:

```sql
CREATE INDEX "IDX_questions_exam_id" ON "questions" ("exam_id");
CREATE INDEX "IDX_exams_subject_id" ON "exams" ("subject_id");
CREATE INDEX "IDX_exams_year_exam_type" ON "exams" ("year", "exam_type");
CREATE INDEX "IDX_subjects_name" ON "subjects" ("name");
```

## 🎯 성능 개선 결과

### 벤치마크 환경
- 도구: NestJS + TypeORM + PostgreSQL
- 방법: `EXPLAIN ANALYZE` (Raw SQL) + TypeORM 100회 반복 측정
- 상태: Warm Cache (데이터가 메모리에 로드된 상태)

### 1️⃣ 시험 문제 조회 (가장 중요!)

**쿼리:** `SELECT * FROM questions WHERE exam_id = 1`
- 10만 건 중에서 35개를 찾는 쿼리

| 항목 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| **스캔 방식** | Seq Scan | **Index Scan** ✅ | 완전 변경 |
| **실행 시간** | 24.968ms | **0.052ms** | **480배 빠름** 🚀 |
| **불필요한 검사** | 106,460개 버림 | 0개 | 완벽 제거! |

**EXPLAIN ANALYZE 결과 (인덱스 후):**
```sql
Index Scan using "IDX_questions_exam_id" on questions
  (cost=0.29..5.13 rows=36 width=1088) 
  (actual time=0.013..0.027 rows=35 loops=1)
  Index Cond: (exam_id = 1)
Execution Time: 0.052 ms  ⚡
```

### 2️⃣ 과목별 시험 목록 조회

**쿼리:** `SELECT * FROM exams WHERE subject_id = 1`
- 3,191개 중에서 7개를 찾는 쿼리

| 항목 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| **실행 시간** | 0.262ms | **0.045ms** | **5.8배 빠름** |
| **불필요한 검사** | 3,184개 버림 | 0개 | 완벽! |

### 3️⃣ 과목 목록 페이지네이션

**쿼리:** `SELECT * FROM subjects ORDER BY name LIMIT 10`

| 항목 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| **스캔 방식** | Sort + Seq Scan | **Index Scan** ✅ | - |
| **실행 시간** | 0.251ms | **0.110ms** | **2.3배 빠름** |
| **정렬 방식** | 메모리 정렬 (25kB) | 인덱스 순서 사용 | 메모리 절약 |

**핵심:** 인덱스 전에는 539개 전체를 읽고 메모리에서 정렬했지만, 인덱스 후에는 이미 정렬된 인덱스에서 바로 10개만 읽습니다.

### 4️⃣ 실제 API 성능 (TypeORM 레벨)

TypeORM을 통해 100회 반복 측정한 결과:

**Questions 조회 (`exam_id = 1`):**

| 지표 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| **평균 (Avg)** | 530.91ms | 273.30ms | **48% 개선** |
| **중앙값 (P50)** | 524.47ms | 144.60ms | **72% 개선** 🔥 |
| **P95** | 1,219.38ms | 816.74ms | **33% 개선** |

**Exams 조회 (`subject_id = 1`):**

| 지표 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| **평균 (Avg)** | 572.36ms | 282.97ms | **51% 개선** |
| **중앙값 (P50)** | 529.70ms | 140.14ms | **74% 개선** 🔥 |

**P50(중앙값)에서 70% 이상 개선**된 것은 대부분의 사용자가 **2배 이상 빠른 속도**를 경험한다는 의미입니다!

## 💭 Cold Cache에서는?

참고로, 데이터베이스를 처음 시작하거나 캐시가 비어있는 상태(Cold Cache)에서는 더욱 극적인 차이를 보였습니다:

| 항목 | 인덱스 전 | 인덱스 후 | 개선율 |
|------|----------|----------|--------|
| Questions 조회 | **2,029ms** | 0.046ms | **44,110배** |

하지만 실제 운영 환경에서는 PostgreSQL이 자주 조회되는 데이터를 메모리에 캐싱하기 때문에, Warm Cache 결과가 더 현실적입니다.

## 📚 배운 점

### 1. 인덱스는 데이터가 많을수록 효과적

- 데이터 100개: 인덱스 효과 미미
- 데이터 10만 개: **480배 차이!**
- 데이터가 많아질수록 Seq Scan의 비용이 기하급수적으로 증가

### 2. WHERE, JOIN, ORDER BY에 사용되는 컬럼은 필수

```sql
-- 이런 쿼리들은 인덱스가 필수!
WHERE exam_id = ?
WHERE subject_id = ?
WHERE year = ? AND exam_type = ?
ORDER BY name
```

### 3. EXPLAIN ANALYZE로 측정하고 검증하자

- 추측하지 말고 측정하기
- `Seq Scan` vs `Index Scan` 확인
- `Rows Removed by Filter` 숫자가 크면 인덱스 필요

### 4. 복합 인덱스 순서가 중요

```typescript
@Index('IDX_exams_year_exam_type', ['year', 'exam_type'])
```

- `WHERE year = ?` → 인덱스 사용 ✅
- `WHERE year = ? AND exam_type = ?` → 인덱스 사용 ✅
- `WHERE exam_type = ?` → 인덱스 사용 불가 ❌

첫 번째 컬럼(year)이 없으면 인덱스를 사용할 수 없습니다.

### 5. TypeORM 오버헤드 vs Raw SQL

- Raw SQL: 0.052ms
- TypeORM 100회 평균: 273ms

TypeORM은 객체 변환, 연결 풀 관리 등의 오버헤드가 있지만, 개발 생산성을 고려하면 충분히 가치 있습니다.

## 🎯 결론

### 변화

| 항목 | 개선 전 | 개선 후 |
|------|---------|---------|
| 시험 문제 로딩 | 530ms (느림 😫) | 273ms (빠름 ⚡) |
| 과목별 시험 목록 | 572ms (느림 😫) | 283ms (빠름 ⚡) |
| 사용자 경험 | 답답함 | 부드러움 |

### 인덱스 추가 전 vs 후

**인덱스 전:**
```
사용자: "시험지 열기" 클릭
서버: 106,495개 전체 스캔 중... (524ms)
사용자: "왜 이렇게 느려?" 😤
```

**인덱스 후:**
```
사용자: "시험지 열기" 클릭
서버: 인덱스로 바로 찾기! (145ms)
사용자: "오, 빠르네?" 😊
```

### 핵심 교훈

> **"데이터베이스 성능 문제의 80%는 인덱스로 해결된다"**

사이드 프로젝트를 하면서 책에서만 보던 인덱스의 중요성을 몸소 체험했습니다. 10만 건의 데이터에서 인덱스 하나로 **480배**의 성능 개선을 이뤄낸 경험은, 앞으로 데이터베이스를 다룰 때 항상 인덱스를 먼저 고려하게 만들었습니다.

**"느리다면, 먼저 EXPLAIN ANALYZE를 확인하자!"**

## 🔗 참고 자료

- [PostgreSQL EXPLAIN 공식 문서](https://www.postgresql.org/docs/current/using-explain.html)
- [TypeORM 인덱스 가이드](https://typeorm.io/indices)
- 프로젝트 저장소: [GitHub](https://github.com/your-repo)

---

**2026.01.21 작성**
*방송대 기출문제 서비스 개발 중*
