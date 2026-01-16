# 성능 벤치마크

## 📊 선택지 저장 방식 비교: JSONB vs 별도 테이블

### 측정 환경
- **날짜**: 2026-01-14
- **데이터**: 35개 문제, 140개 선택지 (문제당 4개)
- **DB**: PostgreSQL (로컬)
- **측정 방법**: Raw SQL (EXPLAIN ANALYZE)

---

## 🔬 측정 결과

### 1. SELECT 성능

#### JSONB 방식 (현재)
```sql
EXPLAIN ANALYZE
SELECT * FROM questions WHERE exam_id = 1;
```

**결과:**
- **Total Time: 0.07ms**
- SEQ SCAN: 0.03ms
- Rows: 35개 (선택지 포함)

#### JOIN 방식 (별도 테이블)
```sql
EXPLAIN ANALYZE
SELECT q.*, c.*
FROM questions q
LEFT JOIN choices_test c ON c.question_id = q.id
WHERE q.exam_id = 1;
```

**결과:**
- **Total Time: 0.27ms**
- HASH RIGHT JOIN: 0.15ms
- SEQ SCAN (questions): 0.04ms
- SEQ SCAN (choices): 0.07ms
- Rows: 140개

#### 비교
| 방식 | 시간 | 성능 |
|------|------|------|
| **JSONB** | 0.07ms | ⭐ **기준** |
| **JOIN** | 0.27ms | 3.86배 느림 |

**✅ JSONB가 약 4배 빠름**

---

## 📡 TypeORM 레벨 성능

### 2. TypeORM SELECT 성능

#### JSONB 방식
```bash
yarn benchmark
```

**결과:**
- 평균 (Avg): 21.04ms
- 중앙값 (P50): 20.01ms
- P95: 29.82ms
- 최소: 15.63ms
- 최대: 52.81ms

#### JOIN 방식
```bash
yarn benchmark:join
```

**결과:**
- 평균 (Avg): 21.63ms
- 중앙값 (P50): 20.77ms
- P95: 26.97ms
- 최소: 17.24ms
- 최대: 63.51ms

#### 비교
| 방식 | 평균 | 중앙값 | 차이 |
|------|------|--------|------|
| **JSONB** | 21.04ms | 20.01ms | ⭐ **기준** |
| **JOIN** | 21.63ms | 20.77ms | +0.59ms (3% 느림) |

**✅ TypeORM 레벨에서는 거의 비슷함**

**분석:**
- TypeORM 오버헤드(~20ms)가 Raw SQL 차이(0.2ms)를 묻어버림
- Raw SQL: 4배 차이 → TypeORM: 3% 차이
- 대량 데이터에서 차이 더 벌어질 것으로 예상

---

## 💾 INSERT 성능

### 3. 크롤링 시 INSERT 쿼리 수

#### JSONB 방식 (현재)
```
시험 1개 크롤링:
├─ INSERT INTO exams (1개)
└─ INSERT INTO questions (35개, choices 포함)

총: 36개 INSERT
```

#### JOIN 방식 (별도 테이블)
```
시험 1개 크롤링:
├─ INSERT INTO exams (1개)
├─ INSERT INTO questions (35개)
└─ INSERT INTO choices (140개)

총: 176개 INSERT
```

#### 비교
| 방식 | INSERT 수 | 개선율 |
|------|-----------|--------|
| **JSONB** | 36개 | ⭐ **기준** |
| **JOIN** | 176개 | 4.89배 많음 |

**✅ JSONB가 80% 감소**

---

## 📊 종합 결과

### 성능 요약표

| 측정 항목 | JSONB 방식 | JOIN 방식 | 개선율 |
|----------|-----------|-----------|--------|
| **Raw SQL SELECT** | 0.07ms | 0.27ms | **74% ↓ (4배 빠름)** |
| **TypeORM SELECT** | 21.04ms | 21.63ms | **3% 빠름 (거의 비슷)** |
| **INSERT 쿼리 수** | 36개 | 176개 | **80% ↓ (5배 감소)** |

---

## 🎯 결론

### ✅ 측정 결과

1. **Raw SQL SELECT: 4배 빠름**
   - JSONB: 0.07ms
   - JOIN: 0.27ms
   - JOIN 오버헤드 제거, 메모리 효율적

2. **TypeORM SELECT: 거의 비슷함**
   - JSONB: 21.04ms
   - JOIN: 21.63ms
   - TypeORM 오버헤드(~20ms)가 차이를 묻어버림
   - 대량 데이터에서 차이 벌어질 것으로 예상

3. **INSERT 성능: 5배 개선**
   - JSONB: 36개 쿼리
   - JOIN: 176개 쿼리
   - 크롤링 시간 단축

### 💡 추가 이점

- **N+1 문제 원천 차단**: 선택지가 문제에 포함되어 있어 별도 쿼리 불필요
- **코드 단순화**: 선택지 저장 로직 9줄 → 1줄
- **Entity 감소**: Choice 엔티티 제거

### ⚠️ 고려사항

1. **데이터 크기**
   - 현재: 35개 문제 (작은 데이터셋)
   - 대량 데이터에서 Raw SQL 차이가 TypeORM에서도 드러날 것

2. **TypeORM vs Raw SQL**
   - TypeORM 오버헤드: ~20ms (네트워크 + 객체 변환)
   - Raw SQL 성능 차이(0.2ms)가 상대적으로 작아 보임
   - 프로덕션 환경(네트워크 레이턴시)에서 차이 증폭 예상

3. **선택지 개별 검색**
   - JSONB 연산자 사용 또는 GIN 인덱스 생성 가능

---

## 🔧 재현 방법

### 1. Raw SQL 측정 (PostgreSQL)

```sql
-- JSONB 방식
EXPLAIN ANALYZE SELECT * FROM questions WHERE exam_id = 1;

-- JOIN 방식 (테스트 테이블 필요)
EXPLAIN ANALYZE 
SELECT q.*, c.* FROM questions q 
LEFT JOIN choices_test c ON c.question_id = q.id 
WHERE q.exam_id = 1;
```

### 2. TypeORM 측정

```bash
# JSONB 방식
yarn benchmark

# JOIN 방식 (테스트 테이블 필요)
yarn benchmark:join
```

### 테스트 데이터 생성 (선택사항)

```sql
-- JOIN 방식 테스트를 위한 임시 테이블
CREATE TABLE choices_test (
  id SERIAL PRIMARY KEY,
  question_id INT,
  choice_number INT,
  choice_text TEXT,
  choice_image_url TEXT
);

-- JSONB에서 데이터 복제
INSERT INTO choices_test (question_id, choice_number, choice_text, choice_image_url)
SELECT 
  q.id,
  (choice->>'choiceNumber')::int,
  choice->>'choiceText',
  choice->>'choiceImageUrl'
FROM questions q,
jsonb_array_elements(q.choices) AS choice;
```

---

## 📚 참고 자료

- [PostgreSQL JSONB Performance](https://www.postgresql.org/docs/current/datatype-json.html)
- [TypeORM Performance Optimization](https://typeorm.io/caching)
- 관련 커밋: "refactor: 선택지 저장 방식을 별도 테이블에서 JSONB로 변경"
