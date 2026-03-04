# AI 튜터 설계 및 구현 문서

> 작성일: 2026-03-04  
> 상태: 구현 완료

---

**목차**

| 번호 | 구분 | 설명 |
| --- | --- | --- |
| 1 | 개요 | AI 기능 구성 및 목적 |
| 2 | 기출문제 해설 자동 생성 | 캐시 기반 해설 생성 + concept_tags 동시 추출 |
| 3 | AI 튜터 (문제 화면 도우미) | 문제 기반 질의응답 챗봇 |
| 4 | 개념(term) 기반 구조 | 개념 설명 캐시 및 terms 테이블 |
| 5 | concept_tags (문제 개념 태그) | 문제별 핵심 개념 태그 |
| 6 | 스키마 변경 사항 | 테이블/컬럼 추가 내역 |
| 7 | 구현 파일 목록 | 변경/생성된 파일 정리 |

---

## 1. 개요

AI 기능은 크게 두 가지로 구성한다.

| 번호 | 기능 | 설명 |
| --- | --- | --- |
| 1 | 기출문제 해설 자동 생성 | LLM으로 해설 + concept_tags 동시 생성 → DB 캐시 |
| 2 | AI 튜터 (문제 화면 도우미) | 문제 화면에서 개념 질문, 비교, 문제 추천 |

---

## 2. 기출문제 해설 자동 생성

### 구현 위치

`TutorService.generateExplanation()`

### 동작 흐름

```
요청 → questions.explanation 존재?
  ├─ YES → DB 값 반환 (generated: false, conceptTags 포함)
  └─ NO  → LLM 1회 호출 → explanation + concept_tags 동시 생성 → DB 저장 → 반환
```

### API

| Method | URL | 설명 |
| --- | --- | --- |
| GET | /api/tutor/questions/:id/explanation | 해설 조회 (없으면 생성) |
| POST | /api/tutor/questions/:id/explanation/regenerate | 해설 강제 재생성 |

### concept_tags 추출 프롬프트 핵심 규칙

LLM이 해설과 함께 JSON으로 concept_tags를 반환하도록 지시한다.

```
concept_tags 규칙:
- 문제를 풀기 위해 반드시 알아야 하는 학문적 개념/이론/용어만 추출 (2~5개)
- 문제 지문에 등장하는 일반 단어(주체, 과정, 결과 등)는 절대 포함 금지
- "이 태그로 검색하면 같은 개념을 다루는 다른 시험 문제를 찾을 수 있는가?"를 기준으로 판단
- 좋은 예: ["가계", "경제주체", "소비", "재무관리"]
- 나쁜 예: ["주체", "과정", "결과", "설명", "개념"]
```

### 응답 형식

`response_format: { type: 'json_object' }` 를 사용하여 구조화된 JSON 응답을 보장한다.

```json
{
  "explanation": "해설 내용",
  "concept_tags": ["가계", "경제주체", "경제활동", "소비"]
}
```

---

## 3. AI 튜터 (문제 화면 도우미)

### 구현 위치

`TutorService.chat()` → `POST /api/tutor/chat`

### 핵심 설계 원칙

AI 튜터는 **과목 전체 기반 챗봇이 아니라, 현재 문제 기반 튜터**로 동작한다.

### 동작 방식

**1단계: intent 분류** (`classifyIntent`)

LLM을 통해 사용자 질문의 의도와 핵심 개념을 추출한다.

```
질문: "DI가 뭐야?"  →  intent: define, term_candidates: ["di"]
질문: "DI랑 IoC 차이?" → intent: compare, term_candidates: ["di", "ioc"]
질문: "비슷한 문제 줘" → intent: recommend, term_candidates: [...]
```

**2단계: intent별 분기 처리**

| intent | 동작 | 구현 메서드 |
| --- | --- | --- |
| define | 개념 설명 (terms 캐시 활용) | `getTermExplanation()` |
| compare | 두 개념 비교 설명 | `compareTerms()` |
| recommend | concept_tags 기반 같은 과목 내 문제 추천 | `recommendQuestions()` |
| general | 현재 문제 컨텍스트 기반 일반 응답 | `answerGeneral()` |

### 대화 컨텍스트 관리

| 항목 | 내용 |
| --- | --- |
| 방식 | 프론트엔드 메모리 기반 (Stateless) |
| 구조 | 프론트엔드가 최근 N개 대화를 `history` 배열로 요청 body에 포함 |
| 장점 | 서버 부담 없음, 구현 단순 |

---

## 4. 개념(term) 기반 구조

### terms 테이블

| column | 타입 | 설명 | 비고 |
| --- | --- | --- | --- |
| id | serial PK | | |
| subject_id | int, FK → subjects.id | 과목 | 동일 term이라도 과목별 설명이 다를 수 있음 |
| term | varchar(100) | normalized key | 소문자 정규화 (ex: di, cpu) |
| explanation | text | 개념 설명 | LLM 생성 |
| model | varchar(50) | 생성 모델명 | ex: gpt-4o-mini |
| prompt_version | varchar(20) | 프롬프트 버전 | 캐시 무효화에 활용 |
| hit_count | int, default 0 | 조회 횟수 | 인기 개념 추적 |
| created_at | timestamptz | 생성일 | |

### 캐시 동작 (concept_tags 검증 포함)

```
사용자 질문 → term 추출

1. terms 캐시 히트? (term + subject_id + prompt_version)
   ├─ YES → hit_count++ → 캐시 반환
   └─ NO → 계속

2. concept_tags에 이 term이 존재하는 문제가 해당 과목에 있는가?
   (questions.concept_tags @> '["term"]' AND exam.subject_id = ?)

3. LLM으로 설명 생성

4. concept_tags에 존재?
   ├─ YES → terms 테이블에 캐시 저장
   └─ NO  → 1회성 응답만 반환 (캐시 안 함)
```

이 검증 덕분에 의미 없는 질문("ㅋㅋㅋ", "asdf" 등)은 캐시되지 않고, **실제 시험에 출제된 개념만** terms 테이블에 쌓인다.

---

## 5. concept_tags (문제 개념 태그)

### 저장 위치

`questions.concept_tags` (jsonb)

### 형식

```json
["가계", "경제주체", "경제활동", "소비"]
```

### 생성 시점

해설 생성 시 LLM 1회 호출로 동시 추출 (`generateExplanation()`).

### 활용

| 용도 | 설명 |
| --- | --- |
| 관련 문제 추천 | concept_tags JSONB `@>` 연산자로 같은 과목 내 관련 문제 조회 |
| terms 캐시 검증 | 사용자 질문의 term이 실제 시험 개념인지 확인하는 필터 |

---

## 6. 스키마 변경 사항

### 6-1. questions 테이블 - concept_tags 컬럼 추가

| column | 타입 | nullable | 설명 |
| --- | --- | --- | --- |
| concept_tags | jsonb | YES | 문제의 핵심 개념 태그 배열 |

### 6-2. terms 테이블 신규 생성

| column | 타입 | nullable | 설명 |
| --- | --- | --- | --- |
| id | serial PK | N | |
| subject_id | int, FK | N | 과목 |
| term | varchar(100) | N | 정규화된 개념 키 |
| explanation | text | N | LLM 생성 개념 설명 |
| model | varchar(50) | N | 생성 모델명 |
| prompt_version | varchar(20) | N | 프롬프트 버전 |
| hit_count | int | N | 조회 횟수 (default 0) |
| created_at | timestamptz | N | 생성일 |

유니크 인덱스: `IDX_terms_subject_term` (subject_id, term)

---

## 7. 구현 파일 목록

| 파일 | 변경 내용 |
| --- | --- |
| `src/questions/entities/question.entity.ts` | `concept_tags` (jsonb) 컬럼 추가 |
| `src/tutor/entities/term.entity.ts` | **신규** — terms 테이블 엔티티 (hit_count 포함) |
| `src/tutor/dto/chat.dto.ts` | **신규** — 챗봇 요청 DTO (questionId, message, history) |
| `src/tutor/tutor.module.ts` | Term, Exam 엔티티 등록 |
| `src/tutor/tutor.service.ts` | 전면 리팩토링 — 해설+태그 동시 생성, intent 분류, 개념 설명/비교/추천/일반 응답, terms 캐시 검증 |
| `src/tutor/tutor.controller.ts` | `POST /api/tutor/chat` 엔드포인트 추가, 기존 해설 API에 conceptTags 응답 추가 |
