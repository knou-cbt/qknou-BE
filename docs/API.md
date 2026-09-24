# QKNOU API 문서

**목차**

| 번호 | 구분 | 설명 |
| --- | --- | --- |
| 1~5 | Auth | 구글 로그인 시작/콜백, 카카오 로그인 시작/콜백, 현재 사용자 조회(JWT) |
| 6 | Users | 회원 생성 |
| 7~9 | 과목 | 목록 조회, 상세 조회, 과목별 시험 목록 |
| 10~11 | 시험 | 문제 조회, 제출(채점) |
| 12~13 | 학과 | 목록 조회, 학과별 과목 목록 |
| 14~15 | Tutor | 문제 해설 조회/생성, 해설 재생성 |
| 16 | Tutor | AI 튜터 챗봇 (로그인 필수, 일 5회 제한) |
| 17 | Tutor | 남은 챗봇 사용 횟수 조회 |
| 18 | Tutor | 오래된 챗봇 사용 데이터 삭제 (관리자용) |
| 19~21 | Health | 서버 상태, 성능 측정, DB 연결 |
| 22 | 피드백 | 피드백 제출 (GitHub Issue 자동 생성) |
| 23~28 | 시험지 등록 | 업로드(중복 검증 내부 처리), 관리자 검수/수정/게시/반려 |
| 29~31 | 업데이트 알림 | 활성 공지 조회, 내역 적재(관리자), 공지 발행(관리자) |
| 32~33 | 마이페이지 | 풀이 기록 목록(누적, 검색/페이지네이션) + 상세 조회 |
| 34~36 | 북마크 | 목록 조회, 등록, 해제 |
| 37 | 문항 | 문항 단건 공개 조회 (암기모드 공유 진입점) |

> ⚠️ **구현 상태**: 22~37번(v2 고도화)은 OCR 워커(시험지 등록의 pending→processing→parsed/failed 전이를 실제로 수행하는 부분)를 제외하고 전부 구현 완료 상태입니다. OCR 워커는 별도 프로젝트로 아직 미구현입니다.

---

## 1. Auth - 구글 로그인 시작

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /auth/google |
| **설명** | 구글 OAuth 로그인 시작. 호출 시 구글 로그인 페이지로 리다이렉트됩니다. |

**Request**  
없음 (브라우저/클라이언트에서 GET 요청 시 구글 로그인 화면으로 이동)

**Response**  
302 리다이렉트 → 구글 로그인 페이지

**Status**

| status | response content |
| --- | --- |
| 302 | 구글 로그인 페이지로 리다이렉트 |

---

## 2. Auth - 구글 로그인 콜백

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /auth/google/callback |
| **설명** | 구글 로그인 완료 후 콜백. 서버에서만 사용되며, 로그인 성공 시 프론트엔드로 리다이렉트하며 쿼리에 토큰을 붙입니다. |

**Response**  
302 리다이렉트 → `{FRONTEND_URL}/auth/success?token={access_token}`

**Status**

| status | response content |
| --- | --- |
| 302 | 프론트엔드 /auth/success?token=... 로 리다이렉트 |

---

## 3. Auth - 카카오 로그인 시작

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /auth/kakao |
| **설명** | 카카오 OAuth 로그인 시작. 호출 시 카카오 로그인 페이지로 리다이렉트됩니다. |

**Request**  
없음

**Response**  
302 리다이렉트 → 카카오 로그인 페이지

**Status**

| status | response content |
| --- | --- |
| 302 | 카카오 로그인 페이지로 리다이렉트 |

---

## 4. Auth - 카카오 로그인 콜백

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /auth/kakao/callback |
| **설명** | 카카오 로그인 완료 후 콜백. 로그인 성공 시 프론트엔드로 리다이렉트하며 쿼리에 토큰을 붙입니다. |

**Response**  
302 리다이렉트 → `{FRONTEND_URL}/auth/success?token={access_token}`

**Status**

| status | response content |
| --- | --- |
| 302 | 프론트엔드 /auth/success?token=... 로 리다이렉트 |

---

## 5. Auth - 현재 사용자 조회 (JWT)

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /auth/me |
| **설명** | JWT 인증 테스트/현재 로그인 사용자 정보 조회. Authorization 헤더에 Bearer 토큰 필요. |

**Request - Header**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| Authorization | Bearer {access_token} | string | - | N |

**Response**

| key | 설명 | value 타입 |
| --- | --- | --- |
| message | 메시지 | string |
| user | JWT에서 복원한 사용자 정보 | object |

**Status**

| status | response content |
| --- | --- |
| 200 | JWT 인증 성공, 사용자 정보 반환 |
| 401 | 인증 실패 (토큰 없음/만료/무효) |

---

## 6. Users - 회원 생성

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /users |
| **설명** | 사용자(회원) 생성. |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| (CreateUserDto) | 요청 body (현재 스키마는 비어 있음) | object | - | - |

**Response**  
서비스에서 반환하는 생성 결과 객체

**Status**

| status | response content |
| --- | --- |
| 201 | 생성 성공 |
| 400 | 잘못된 요청 |

---

## 7. 과목 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/subjects |
| **설명** | 과목 전체 목록 조회 (검색 + 페이지네이션) |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| search | 과목명 검색어 | string | optional | Y | "경영" |
| page | 페이지 번호 | number | optional | Y | 1 |
| limit | 페이지당 항목 수 | number | optional | Y | 10 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N | true |
| data | 결과 데이터 | object | - | N | - |
| data.subjects | 과목 배열 | array | - | N | - |
| data.subjects[].id | 과목 ID | number | - | N | 1 |
| data.subjects[].name | 과목명 | string | - | N | "경영학개론" |
| data.pagination | 페이지 정보 | object | - | N | - |
| data.pagination.page | 현재 페이지 | number | - | N | 1 |
| data.pagination.limit | 페이지당 항목 수 | number | - | N | 10 |
| data.pagination.total | 전체 항목 수 | number | - | N | 25 |
| data.pagination.totalPages | 전체 페이지 수 | number | - | N | 3 |

**Example**

```json
{
  "success": true,
  "data": {
    "subjects": [
      { "id": 2, "name": "간호연구" },
      { "id": 1, "name": "경영학원론" }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 2,
      "totalPages": 1
    }
  }
}
```

**Status**

| status | response content |
| --- | --- |
| 200 | 과목 목록 조회 성공 |
| 500 | 과목 목록 조회 실패 |

---

## 8. 과목 상세 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/subjects/:id |
| **설명** | 특정 과목 상세 조회 |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 과목 ID | number | - | N | 1 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N | true |
| data | 결과 데이터 | object | - | N | - |
| data.id | 과목 ID | number | - | N | 1 |
| data.name | 과목명 | string | - | N | "경영학개론" |

**Status**

| status | response content |
| --- | --- |
| 200 | 과목 조회 성공 |
| 404 | 과목을 찾을 수 없습니다 |

---

## 9. 과목별 시험 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/subjects/:subjectId/exams |
| **설명** | 특정 과목의 시험 목록 조회 |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| subjectId | 과목 ID | number | - | N | 1 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N | true |
| data | 시험 배열 | array | - | N | - |
| data[].id | 시험 ID | number | - | N | 1 |
| data[].title | 시험 제목 | string | - | N | "경영학원론 기말 2019 2학기" |
| data[].year | 연도 | number | - | N | 2019 |
| data[].examType | 시험 종류 | string | - | N | "기말" |

**Status**

| status | response content |
| --- | --- |
| 200 | 시험 목록 조회 성공 |
| 404 | 과목을 찾을 수 없습니다 |

---

## 10. 시험 문제 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/exams/:id/questions |
| **설명** | 특정 시험의 문제 목록 조회 (test/study 모드, 페이지네이션 지원). 문제·선택지 이미지는 imageUrls 배열로 제공됩니다. |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 시험 ID | number | - | N | 1 |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| mode | 조회 모드 (study: 정답·해설 포함, test: 미포함) | string | optional | Y | "test" (기본값) |
| page | 페이지 번호 (미제공 시 전체 조회) | number | optional | Y | 1 |
| limit | 페이지당 문제 수 | number | optional | Y | 5 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N | true |
| data | 결과 데이터 | object | - | N | - |
| data.exam | 시험 정보 | object | - | N | - |
| data.exam.id | 시험 ID | number | - | N | 1 |
| data.exam.title | 시험 제목 | string | - | N | "경영학원론 기말 2019" |
| data.exam.subject | 과목명 | string | - | N | "경영학원론" |
| data.exam.totalQuestions | 총 문항 수 | number | - | N | 35 |
| data.exam.year | 연도 | number | - | N | 2019 |
| data.questions | 문제 배열 | array | - | N | - |
| data.questions[].id | 문제 ID | number | - | N | 101 |
| data.questions[].number | 문제 번호 | number | - | N | 1 |
| data.questions[].text | 문제 지문 텍스트 | string | - | N | "다음 중 옳은 것은?" |
| data.questions[].example | 예시/보기 텍스트 (코드 블록은 마크다운 형식으로 포함, 아래 참고) | string | optional | Y | null |
| data.questions[].sharedExample | 공통 보기 텍스트 (여러 문제가 공유하는 보기, 코드 블록 포함 가능) | string | optional | Y | null |
| data.questions[].imageUrls | 문제에 첨부된 이미지 URL 배열 (문장 중간/보기 그림 등) | array of string | optional | Y | ["https://..."] 또는 null |
| data.questions[].choices | 선택지 배열 | array | - | N | - |
| data.questions[].choices[].number | 선택지 번호 (1~4) | number | - | N | 1 |
| data.questions[].choices[].text | 선택지 텍스트 | string | - | N | "① 비피압대수층..." |
| data.questions[].choices[].imageUrls | 선택지에 첨부된 이미지 URL 배열 | array of string | optional | Y | null 또는 ["https://..."] |
| data.questions[].correctAnswers | 정답 번호 배열 (study 모드일 때만) | array of number | optional | Y | [3] |
| data.questions[].explanation | 해설 (study 모드일 때만) | string | optional | Y | null |
| data.pagination | 페이지 정보 (page, limit 사용 시만 포함) | object | optional | Y | - |
| data.pagination.page | 현재 페이지 | number | - | N | 1 |
| data.pagination.limit | 페이지당 문제 수 | number | - | N | 5 |
| data.pagination.total | 전체 문항 수 | number | - | N | 35 |
| data.pagination.totalPages | 전체 페이지 수 | number | - | N | 7 |
| data.pagination.hasNext | 다음 페이지 존재 여부 | boolean | - | N | true |
| data.pagination.hasPrev | 이전 페이지 존재 여부 | boolean | - | N | false |

**Example**

```json
{
  "success": true,
  "data": {
    "exam": {
      "id": 1,
      "title": "토양지하수관리 기말 2019 2학기",
      "subject": "토양지하수관리",
      "totalQuestions": 35,
      "year": 2019
    },
    "questions": [
      {
        "id": 101,
        "number": 36,
        "text": "다음은 토양과 지하수와의 관계를 설명한 내용이다. 잘못 설명된 것은?",
        "example": null,
        "sharedExample": null,
        "imageUrls": null,
        "choices": [
          { "number": 1, "text": "비피압대수층...", "imageUrls": null },
          { "number": 2, "text": "포화대에서의...", "imageUrls": null }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 5,
      "total": 35,
      "totalPages": 7,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

**example 필드 코드 블록 처리**

`example` 필드에 코드가 포함된 경우, 마크다운 코드 블록 형식으로 저장됩니다.

예시:
```
(3∼4) 다음과 같은 프로그램이 있을 때 물음에 답하시오.
(여기서 'A'의 ASCII값은 65이다.)

```cpp
#include <stdio.h>
void main() {
  char var='A';
  printf("var1=%d var2=%c", var, var);
}
```　
```

프론트엔드 렌더링 가이드:
1. ` ```언어명 ` ~ ` ``` ` 패턴을 정규식으로 파싱 (언어명은 없을 수 있음: ` ``` `)
2. 코드 블록은 `<pre><code>` 태그로 렌더링 (언어명이 있으면 syntax highlighting 적용)
3. 나머지 텍스트는 `white-space: pre-wrap` 스타일 적용

React 파싱 예시:
```tsx
function ExampleText({ text }: { text: string }) {
  if (!text) return null;
  
  const parts = text.split(/(```\w*\n[\s\S]*?\n```)/g);
  
  return (
    <div className="example-text">
      {parts.map((part, i) => {
        const codeMatch = part.match(/```(\w*)\n([\s\S]*?)\n```/);
        if (codeMatch) {
          const [, lang, code] = codeMatch;
          return (
            <pre key={i} className={`code-block language-${lang}`}>
              <code>{code}</code>
            </pre>
          );
        }
        return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
      })}
    </div>
  );
}
```

**sharedExample 필드 (공통 보기)**

여러 문제가 공유하는 공통 보기가 있는 경우 `sharedExample` 필드에 저장됩니다.
`example` 필드와 동일하게 코드 블록이 포함될 수 있으며, 같은 방식으로 파싱하면 됩니다.

예시:
```json
{
  "sharedExample": "(3~4) 다음과 같은 프로그램이 있을 때 물음에 답하시오.\n\n```cpp\n#include <stdio.h>\nvoid main() {\n  char var='A';\n  printf(\"var1=%d var2=%c\", var, var);\n}\n```",
  "example": null
}
```

프론트엔드 렌더링 가이드:
1. `sharedExample`이 있으면 문제 위에 별도 영역으로 표시
2. `example`과 동일한 코드 블록 파싱 로직 적용
3. 같은 공통 보기를 공유하는 연속 문제들은 UI에서 그룹핑 고려

**Status**

| status | response content |
| --- | --- |
| 200 | 문제 조회 성공 |
| 404 | 시험을 찾을 수 없습니다 |

---

## 11. 시험 제출 (채점)

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/exams/:id/submit |
| **설명** | 시험 답안 제출 및 채점 결과 수신. **(v2 추가)** `Authorization` 헤더가 있으면 로그인 사용자로 인식해 채점 결과를 마이페이지 풀이 기록에 저장합니다. 같은 과목(subject) + 같은 연도(year) 조합의 기존 기록이 있으면 지우고 이번 기록으로 교체합니다(과목-연도 조합당 최신 1건만 유지, 누적 아님). 과목이 같아도 연도가 다르면 별도 기록으로 유지됩니다. 헤더가 없으면 기존과 동일하게 저장 없이 채점만 수행합니다. |
| **인증** | 선택 (없으면 비로그인으로 채점만 / 있는데 유효하지 않으면 401) |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 시험 ID | number | - | N | 1 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| answers | 제출할 답안 목록 | array | - | N | - |
| answers[].questionId | 문제 ID | number | - | N | 101 |
| answers[].selectedAnswer | 선택한 답안 번호 (1~4), 미선택 시 null | number | - | Y | 2 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N | true |
| data | 채점 결과 | object | - | N | - |
| data.examId | 시험 ID | number | - | N | 1 |
| data.totalQuestions | 총 문항 수 | number | - | N | 35 |
| data.correctCount | 정답 수 | number | - | N | 28 |
| data.score | 점수 (0~100) | number | - | N | 80 |
| data.results | 문제별 채점 결과 | array | - | N | - |
| data.results[].questionId | 문제 ID | number | - | N | 101 |
| data.results[].questionNumber | 문제 번호 | number | - | N | 36 |
| data.results[].userAnswer | 사용자 선택 답 | number | optional | Y | 2 |
| data.results[].correctAnswers | 정답 번호 배열 | array of number | - | N | [3] |
| data.results[].isCorrect | 정답 여부 | boolean | - | N | false |

**Status**

| status | response content |
| --- | --- |
| 200 | 채점 완료 |
| 400 | 잘못된 요청 (예: 답안 누락) |
| 401 | Authorization 헤더는 있으나 토큰이 유효하지 않음(만료/위조) |
| 404 | 시험을 찾을 수 없습니다 |

---

## 12. 학과 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /departments |
| **설명** | 학과 전체 목록 조회 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data | 학과 배열 | array | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 학과 목록 조회 성공 |

---

## 13. 학과별 과목 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /departments/:id/subjects |
| **설명** | 특정 학과에 속한 과목 목록 조회 |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 학과 ID | number | - | N | 1 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data | 과목 배열 | array | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 과목 목록 조회 성공 |
| 404 | 학과를 찾을 수 없습니다 |

---

## 14. Tutor - 문제 해설 조회/생성

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/tutor/questions/:id/explanation |
| **설명** | 특정 문제의 해설 조회. DB에 해설이 없으면 AI로 실시간 생성 후 반환합니다. 생성 시 concept_tags도 함께 추출됩니다. |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 문제 ID | number | - | N | 101 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| explanation | 해설 텍스트 | string | - | N |
| conceptTags | 핵심 개념 태그 배열 | array of string | - | Y |
| generated | 이번 요청에서 새로 생성된 해설인지 여부 | boolean | - | N |

**Example**

```json
{
  "success": true,
  "explanation": "가계의 개념은 경제학에서 중요한 요소입니다...",
  "conceptTags": ["가계", "경제주체", "경제활동", "소비"],
  "generated": true
}
```

**Status**

| status | response content |
| --- | --- |
| 200 | 해설 조회/생성 성공 |
| 404 | 문제를 찾을 수 없습니다 |

---

## 15. Tutor - 문제 해설 재생성

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/tutor/questions/:id/explanation/regenerate |
| **설명** | 특정 문제의 해설을 AI로 강제 재생성하여 DB에 덮어씁니다. concept_tags도 함께 재생성됩니다. |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 문제 ID | number | - | N | 101 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| explanation | 새로 생성된 해설 텍스트 | string | - | N |
| conceptTags | 핵심 개념 태그 배열 | array of string | - | N |
| generated | 재생성 여부 (항상 true) | boolean | - | N |

**Status**

| status | response content |
| --- | --- |
| 201 | 해설 재생성 성공 |
| 404 | 문제를 찾을 수 없습니다 |

---

## 16. Tutor - AI 튜터 챗봇

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/tutor/chat |
| **설명** | 현재 문제 기반으로 개념 질문, 개념 비교, 관련 문제 추천 등을 처리하는 AI 튜터 챗봇입니다. **로그인 필수, 일일 5회 제한** |
| **인증** | JWT Bearer Token 필수 |

**Request - Header**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| Authorization | Bearer {access_token} | string | - | N |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| questionId | 현재 문제 ID | number | - | N | 101 |
| message | 사용자 질문 | string | - | N | "DI가 뭐야?" |
| history | 최근 대화 내역 | array | optional | Y | - |
| history[].role | 메시지 역할 | string ("user" \| "assistant") | - | N | "user" |
| history[].content | 메시지 내용 | string | - | N | "DI가 뭐야?" |

**history[].role 설명**

| role | 의미 |
| --- | --- |
| user | 사용자(학생)가 보낸 메시지 |
| assistant | AI 튜터가 보낸 응답 |

대화를 이어갈 때, 이전에 주고받은 메시지를 위 순서대로 history에 넣어 보내면 됩니다. 첫 질문 시에는 history를 생략해도 됩니다.

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.answer | AI 튜터 응답 텍스트 | string | - | N |
| data.intent | 분류된 질문 의도 | string ("define" \| "compare" \| "recommend" \| "general") | - | N |
| data.recommendations | 추천 문제 목록 (intent=recommend일 때만) | array | optional | Y |
| data.recommendations[].id | 문제 ID | number | - | N |
| data.recommendations[].questionNumber | 문제 번호 | number | - | N |
| data.recommendations[].text | 문제 텍스트 (80자 요약) | string | - | N |
| data.recommendations[].examTitle | 시험 제목 | string | - | N |
| data.recommendations[].year | 시험 연도 | number | - | N |
| remainingCount | 오늘 남은 사용 횟수 (0~5) | number | - | N |

**Example - 개념 질문 (define)**

```json
// Request
{
  "questionId": 1,
  "message": "가계가 뭐야?"
}

// Response
{
  "success": true,
  "data": {
    "answer": "가계는 개인이나 가구가 소비와 저축을 통해 경제활동을 하는 단위입니다...",
    "intent": "define"
  },
  "remainingCount": 4
}
```

**Example - 개념 비교 (compare)**

```json
// Request
{
  "questionId": 1,
  "message": "가계랑 기업의 차이가 뭐야?"
}

// Response
{
  "success": true,
  "data": {
    "answer": "가계와 기업은 경제에서 중요한 두 가지 주체로...",
    "intent": "compare"
  }
}
```

**Example - 관련 문제 추천 (recommend)**

```json
// Request
{
  "questionId": 1,
  "message": "비슷한 문제 더 줘"
}

// Response
{
  "success": true,
  "data": {
    "answer": "\"가계\" 관련 문제 3개를 찾았습니다.",
    "intent": "recommend",
    "recommendations": [
      {
        "id": 15,
        "questionNumber": 40,
        "text": "가계의 경제적 기능에 대한 설명으로 옳지 않은 것은?...",
        "examTitle": "가계재무관리",
        "year": 2020
      }
    ]
  }
}
```

**Intent 분류 기준**

| intent | 동작 | 예시 질문 |
| --- | --- | --- |
| define | 개념 설명 (terms 캐시 활용) | "CPU가 뭐야?", "DI 설명해줘" |
| compare | 두 개 이상 개념 비교 | "DI랑 IoC 차이가 뭐야?" |
| recommend | concept_tags 기반 관련 문제 추천 | "비슷한 문제 더 줘" |
| general | 일반 학습 질문 | "이 과목 시험 잘 보려면?" |

**Status**

| status | response content |
| --- | --- |
| 200 | 챗봇 응답 성공 |
| 401 | 인증 실패 (로그인 필요) |
| 403 | 일일 사용 횟수 초과 (5회 제한) |
| 404 | 문제를 찾을 수 없습니다 |

---

## 17. Tutor - 남은 챗봇 사용 횟수 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/tutor/remaining-count |
| **설명** | 오늘 남은 AI 튜터 챗봇 사용 횟수를 반환합니다. (로그인 필수) |
| **인증** | JWT Bearer Token 필수 |

**Request - Header**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| Authorization | Bearer {access_token} | string | - | N |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| remainingCount | 오늘 남은 사용 횟수 (0~5) | number | - | N |
| totalLimit | 일일 총 제한 횟수 | number | - | N |

**Example**

```json
{
  "success": true,
  "remainingCount": 3,
  "totalLimit": 5
}
```

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | 인증 실패 (로그인 필요) |

---

## 18. Tutor - 오래된 챗봇 사용 데이터 삭제

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | DELETE |
| **URL** | /api/tutor/cleanup |
| **설명** | 지정된 일수 이전의 챗봇 사용량(user_chat_limits) 데이터를 삭제합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| days | 삭제 기준 일수 (이보다 오래된 데이터 삭제) | number | optional | Y | 90 (기본값) |

**Response**

| key | 설명 | value 타입 |
| --- | --- | --- |
| success | 성공 여부 | boolean |
| deleted | 삭제된 행 수 | number |
| cutoffDate | 삭제 기준일 | string |
| message | 결과 메시지 | string |

**Status**

| status | response content |
| --- | --- |
| 200 | 삭제 완료 |
| 401 | 인증 실패 (로그인 필요) |
| 403 | 관리자 권한 없음 |

---

## 19. Health - 서버 상태 확인

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/health |
| **설명** | 서버 기본 상태 확인 (헬스체크). |

**Response**

| key | 설명 | value 타입 |
| --- | --- | --- |
| status | 상태 | string ("ok") |
| timestamp | 응답 시각 (ISO 8601) | string |
| uptime | 서버 가동 시간(초) | number |

**Status**

| status | response content |
| --- | --- |
| 200 | 서버 정상 |

---

## 20. Health - 성능 측정

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/health/performance |
| **설명** | DB ping, 과목/시험/문제 조회 등 실제 API 성능을 측정한 결과를 반환합니다. |

**Response**

| key | 설명 | value 타입 |
| --- | --- | --- |
| timestamp | 측정 시각 | string |
| environment | NODE_ENV | string |
| tests | 개별 테스트 결과 배열 | array |
| summary | total_tests, avg_time_ms, min_time_ms, max_time_ms | object |
| error | 실패 시 에러 메시지 | string (optional) |
| status | "failed" (실패 시) | string (optional) |

**Status**

| status | response content |
| --- | --- |
| 200 | 성능 측정 완료 |

---

## 21. Health - DB 연결 상태

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/health/db |
| **설명** | DB 연결 상태 확인. SELECT NOW() 실행 후 결과 반환. |

**Response**

| key | 설명 | value 타입 |
| --- | --- | --- |
| status | "connected" \| "disconnected" | string |
| driver | DB 드라이버명 | string (연결 시) |
| database | DB 이름 | string (연결 시) |
| error | 에러 메시지 (연결 실패 시) | string (optional) |

**Status**

| status | response content |
| --- | --- |
| 200 | DB 연결 상태 응답 (연결/해제 여부는 body 기준) |

---

## 22. Feedback - 피드백 제출

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/feedbacks |
| **설명** | 피드백/문항 이상 제보를 접수합니다. 접수 즉시 전용 GitHub 레포에 Issue를 자동 생성하고 Discord 웹훅으로 알림을 보냅니다. GitHub/Discord 연동이 실패해도 접수(DB 저장) 자체는 성공 처리됩니다. **로그인 필수** (제출 횟수 제한 없음) |
| **인증** | JWT Bearer Token 필수 |

**Request - Header**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| Authorization | Bearer {access_token} | string | - | N |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| type | 피드백 유형 | string ("question_bug" \| "site_bug" \| "suggestion" \| "other") | - | N | "question_bug" |
| content | 피드백 내용 (최대 5000자) | string | - | N | "3번 선택지 정답 표기가 이상해요" |
| questionId | 문항 ID (문항 관련 제보일 때) | number | optional | Y | 101 |
| pageUrl | 제보 시점 페이지 URL (최대 2000자) | string | optional | Y | "https://qknou.kr/exams/1" |

**type → GitHub 라벨 매핑**

| type | GitHub 라벨 |
| --- | --- |
| question_bug | 문항-버그 |
| site_bug | 사이트-버그 |
| suggestion | 기능-제안 |
| other | 기타 |

> ⚠️ 라벨은 레포에 미리 수동으로 생성해둬야 합니다 (없는 라벨을 issue 생성 API에 넘기면 422 에러).

**개인정보 처리 방침**: GitHub Issue 본문/댓글에는 사용자 **이메일을 넣지 않고 내부 `userId`(UUID)만** 표시합니다. 실제 신원 확인이 필요하면 관리자가 DB에서 `userId`로 조회합니다 (private 레포라도 PII를 외부 서비스에 그대로 보관하지 않기 위함). 또한 사용자가 작성한 `content` 원문은 GitHub 마크다운/멘션(`@누군가`)이 그대로 해석되지 않도록 코드 블록으로 감싸서 전송합니다.

**동일 문항 중복 제보 처리**

`type=question_bug`이고 `questionId`가 있는 경우, 같은 문항에 대해 여러 사용자가 각자 이슈를 새로 만들지 않도록 아래 순서로 처리합니다.

1. 같은 `questionId`로 저장된 가장 최근 `feedbacks` row에 연결된 `github_issue_number`가 있는지 조회
2. 있으면 GitHub API로 해당 이슈가 아직 **open** 상태인지 확인
3. open이면 → 새 이슈를 만들지 않고 **기존 이슈에 댓글만 추가**, 이번 제보의 `feedbacks` row는 그 기존 `github_issue_number`를 그대로 참조
   - 댓글에는 반드시 이번 제보자가 작성한 **원문 content를 그대로**(코드 블록으로 감싸서) 포함해야 합니다. 같은 문항이어도 신고자마다 지적하는 내용이나 의견(예: 정답이 2번이라는 사람 vs 4번이라는 사람)이 다를 수 있으므로, "추가 제보가 있습니다" 같은 요약/알림성 댓글로 뭉개면 안 됩니다.
   - 댓글 포맷 예시:
     ```
     **추가 제보** (2026-09-05 10:32)
     - 제보자 ID: {userId}
     - 내용:
     ```
     {content}
     ```
     - 페이지: {pageUrl}
     ```
4. closed거나 기존 이슈가 없으면 → 새 이슈 생성
5. 2번의 GitHub API 조회 자체가 실패하면(네트워크 오류 등) → 안전하게 "기존 이슈 없음"으로 간주하고 새 이슈 생성 (제보 자체가 실패하면 안 됨)

> ⚠️ **알려진 한계**: 같은 문항에 대한 두 제보가 완전히 동시에 들어오면(수 밀리초 이내) 위 1~2번 조회가 서로를 못 보고 이슈가 중복 생성될 수 있습니다. 외부 HTTP 호출(GitHub API)을 DB 트랜잭션 안에 넣기 어려워서 완전히 막지는 않았고, 빈도가 낮고 피해도 "이슈 하나 중복 생성" 정도라 지금은 감수합니다.

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 피드백 ID | number | - | N |
| data.type | 피드백 유형 | string | - | N |
| data.githubIssueUrl | 연결된 GitHub Issue URL. `integrationStatus`가 'failed'면 null | string | optional | Y |
| data.integrationStatus | GitHub 연동 결과: "created"(새 이슈 생성) \| "merged"(기존 이슈에 댓글로 병합) \| "failed"(GitHub 연동 실패, 접수는 성공했지만 이슈 없음) | string | - | N |
| data.createdAt | 생성일 | string (ISO 8601) | - | N |

**Example**

Request:
```json
{
  "type": "question_bug",
  "content": "3번 선택지 정답 표기가 이상해요",
  "questionId": 101,
  "pageUrl": "https://qknou.kr/exams/1"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "id": 12,
    "type": "question_bug",
    "githubIssueUrl": "https://github.com/{org}/qknou-feedback/issues/45",
    "integrationStatus": "created",
    "createdAt": "2026-09-05T10:00:00+09:00"
  }
}
```

**Status**

| status | response content |
| --- | --- |
| 201 | 접수 성공 |
| 400 | 잘못된 요청 (type 값 오류, content 5000자 초과 등) |
| 401 | 인증 실패 (로그인 필요) |
| 404 | questionId에 해당하는 문항을 찾을 수 없음 |

---

## 23. 시험지 등록 - 업로드

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/exam-submissions |
| **설명** | 사용자가 시험지 파일을 업로드합니다. 서버는 `(subjectId, year, examType)` 조합으로 기존 `exams` 테이블과 1차 중복 검증만 하고, 접수 후 OCR(Chandra)과 관리자 검수는 비동기로 진행됩니다. |
| **인증** | JWT Bearer Token 필수 |
| **Content-Type** | multipart/form-data |

**Request - Body (multipart/form-data)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| file | 시험지 파일 (PDF 전용) | binary | - | N | - |
| subjectId | 과목 ID | number | - | N | 3 |
| year | 연도 | number | - | N | 2025 |
| examType | 시험 종류 (1: 1학기 기말, 2: 2학기 기말, 3: 하계 계절학기, 4: 동계 계절학기) | number | - | N | 1 |

**파일 제약**

| 항목 | 값 |
| --- | --- |
| 허용 형식 | PDF만 (확장자가 아니라 파일 앞 5바이트가 `%PDF-`인지 검증) |
| 최대 크기 | 20MB. 초과 시 Multer가 파일을 다 받기도 전에 끊고 **413**을 반환 (Nest 프레임워크 기본 동작) |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 등록 ID | number | - | N |
| data.status | 처리 상태 ("pending") | string | - | N |
| data.createdAt | 등록일 | string (ISO 8601) | - | N |

**중복 방지 (2단 방어)**

1. 업로드 전에 `(subjectId, year, examType)` 조합으로 `exams`(이미 게시됨) + `exam_submissions`의 `pending`/`processing`/`parsed` 건(검수 진행 중)을 조회해서 걸러냄
2. 그 사이 동시에 다른 요청이 먼저 접수했을 수 있으므로, DB에 부분 유니크 인덱스(`UQ_exam_submissions_active`, `status IN (pending,processing,parsed)`만 대상)를 걸어서 **최종적으로는 DB가 막음**. 이 제약에 걸리면 400으로 응답. `failed`/`rejected` 상태는 이 제약에서 제외되어 재업로드 가능.

**Status**

| status | response content |
| --- | --- |
| 201 | 접수 성공 (처리는 비동기) |
| 400 | 이미 등록된 시험지(중복) / PDF 아님 / 유효성 실패 |
| 401 | 인증 실패 (로그인 필요) |
| 413 | 파일 크기 초과 (20MB) |

> ℹ️ 별도의 사전 중복 확인 API는 두지 않기로 했습니다. 프론트는 업로드 버튼 클릭 시 바로 이 API를 호출하고, 중복이면 위 400 응답의 에러 메시지를 그대로 보여주면 됩니다. 중복 판단은 서버(`checkDuplicate`)가 파일 업로드 전에 내부적으로 먼저 수행합니다.

---

## 24. 시험지 등록(관리자) - 검수 대기열 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/admin/exam-submissions |
| **설명** | 관리자가 검수할 시험지 등록 목록을 조회합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**상태 전이**

```
pending → processing → parsed → published
                  └→ failed
parsed  → rejected
failed  → rejected
```

`pending`→`processing`→`parsed`/`failed` 전이는 OCR 워커(아직 미구현, 별도 프로젝트)가 DB를 직접 갱신하는 걸로 가정합니다. Nest 쪽엔 이 전이를 위한 API가 없습니다.

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| status | 상태 필터 | string | optional | Y | "parsed" |
| page | 페이지 번호 (기본 1) | number | optional | Y | 1 |
| limit | 페이지당 개수 (기본 20, 최대 100) | number | optional | Y | 20 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.items[].id | 등록 ID | number | - | N |
| data.items[].uploaderEmail | 업로드한 사용자 이메일 | string | - | N |
| data.items[].subjectName | 과목명 | string | - | N |
| data.items[].year | 연도 | number | - | N |
| data.items[].examType | 시험 종류 | number | - | N |
| data.items[].status | 처리 상태 | string | - | N |
| data.items[].createdAt | 등록일 | string | - | N |
| data.total | 전체 개수 (필터 적용 기준) | number | - | N |
| data.page | 현재 페이지 | number | - | N |
| data.limit | 페이지당 개수 | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |

---

## 25. 시험지 등록(관리자) - 상세 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/admin/exam-submissions/:id |
| **설명** | OCR 파싱 결과(`parsedResult`) 전체를 포함한 상세 정보를 조회합니다. 검수/수정 화면에서 사용. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 등록 ID | number | - | N |
| data.status | 처리 상태 | string | - | N |
| data.fileUrl | 원본 파일 URL | string | - | N |
| data.parsedResult | OCR 파싱 결과. `{ examTitle, questions: [...] }` 형태 (아래 #26 참고). DB 엔티티 구조가 아니라 이 API 고유의 계약임 | object \| null | - | Y |
| data.errorMessage | OCR 실패 사유 (status=failed일 때) | string | optional | Y |
| data.version | 낙관적 락 버전. PATCH 호출 시 그대로 돌려보내야 함 | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |

---

## 26. 시험지 등록(관리자) - 파싱 결과 수정

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | PATCH |
| **URL** | /api/admin/exam-submissions/:id |
| **설명** | 관리자가 OCR 파싱 결과를 검수하며 수정합니다. `status`가 `parsed`일 때만 가능. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| parsedResult.examTitle | 시험 제목 | string | - | N |
| parsedResult.questions[].questionNumber | 문항 번호 | number | - | N |
| parsedResult.questions[].questionText | 지문 | string | - | N |
| parsedResult.questions[].exampleText | 예시/보기 | string | optional | Y |
| parsedResult.questions[].sharedExample | 공통 보기 | string | optional | Y |
| parsedResult.questions[].sharedExampleImageUrls | 공통 보기 이미지 URL | array of string | optional | Y |
| parsedResult.questions[].questionImageUrls | 문항 이미지 URL | array of string | optional | Y |
| parsedResult.questions[].correctAnswers | 정답 번호 배열 | array of number | - | N |
| parsedResult.questions[].choices[].number | 선택지 번호 | number | - | N |
| parsedResult.questions[].choices[].text | 선택지 텍스트 | string | - | N |
| parsedResult.questions[].choices[].imageUrls | 선택지 이미지 URL | array of string | - | Y |
| parsedResult.questions[].explanation | 해설 | string | optional | Y |
| expectedVersion | #25에서 조회한 `version` 값 그대로 | number | - | N |

**동시 수정 방지**: `expectedVersion`이 현재 DB의 `version`과 다르면 (다른 관리자가 먼저 수정) 409. 성공하면 서버가 `version`을 1 증가시키므로, 다음 PATCH 때는 응답으로 받은 새 `version`을 써야 합니다.

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 등록 ID | number | - | N |
| data.version | 갱신된 버전 (다음 PATCH에 사용) | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 수정 성공 |
| 400 | parsedResult 형식 오류 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |
| 409 | `parsed` 상태가 아니거나, `expectedVersion` 불일치(동시 수정 충돌) |

---

## 27. 시험지 등록(관리자) - 게시

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/exam-submissions/:id/publish |
| **설명** | 검수 완료된 `parsedResult`를 실제 `exams`/`questions`에 반영하고 등록 건 상태를 `published`로 변경합니다. `status`가 `parsed`일 때만 가능. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**멱등성**: 이미 `published`인 건을 다시 호출하면 에러 없이 기존 `examId`를 그대로 반환합니다(중복 클릭/재시도 대비). 동일 `(subjectId, year, examType)` 조합으로의 동시 게시는 서버가 advisory lock으로 직렬화해서, 먼저 커밋된 것만 성공하고 나머지는 409를 받습니다.

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.examId | 생성된(또는 기존) 시험 ID | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 게시 성공 (또는 이미 게시되어 있던 examId 반환) |
| 400 | parsedResult가 비어있음 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |
| 409 | `parsed` 상태가 아니거나, 동일 조합의 시험이 이미 존재함 |

---

## 28. 시험지 등록(관리자) - 반려

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/exam-submissions/:id/reject |
| **설명** | `parsed` 또는 `failed` 상태인 등록 건을 반려 처리합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| reason | 반려 사유 (최대 1000자) | string | - | N |

이미 `rejected`인 건을 다시 호출하면 에러 없이 그대로 성공 응답(멱등). `published`인 건은 반려 불가(409).

**Status**

| status | response content |
| --- | --- |
| 200 | 반려 처리 성공 (또는 이미 반려되어 있던 상태 그대로 반환) |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |
| 409 | 반려할 수 없는 상태 (예: 이미 게시됨) |

---

## 29. 업데이트 알림 - 활성 공지 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/notices/active |
| **설명** | 현재 노출 기간(`발행일 ~ 발행일+7일`) 내에 있고 활성화된 업데이트 공지를 조회합니다. 서비스 접속 시 모달로 노출. 로그인 여부와 무관하게 조회 가능. |
| **인증** | 불필요 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data[].id | 공지 ID | number | - | N |
| data[].title | 제목 | string | - | N |
| data[].content | 내용 | string | - | N |
| data[].publishedAt | 발행일 | string | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 (노출할 공지 없으면 `data: []`) |

---

## 30. 업데이트 내역 적재 (관리자, 내부용)

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/update-entries |
| **설명** | 문제 수정/시험 추가 등 개별 업데이트 내역을 누적 저장합니다. 저장 시점에는 사용자에게 노출되지 않습니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| type | 업데이트 유형 | string | - | N | "문제수정" |
| content | 업데이트 내용 | string | - | N | "경영학원론 2019 기말 3번 문항 정답 수정" |

**Status**

| status | response content |
| --- | --- |
| 201 | 저장 성공 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |

---

## 31. 업데이트 알림 발행 (관리자)

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/notices/publish |
| **설명** | 누적된 업데이트 내역 중 선택한 것들을 묶어 하나의 사용자 노출용 공지로 발행합니다. 노출 기간은 발행일로부터 7일 고정. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| title | 공지 제목 | string | - | N | "9월 업데이트 소식" |
| content | 공지 내용 (여러 내역을 조합해 관리자가 직접 작성) | string | - | N | "- 문항 오류 3건 수정\n- 신규 시험 5개 추가" |
| entryIds | 이 공지에 묶을 update_entries ID 목록 | array of number | - | N | [12, 13, 14] |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 공지 ID | number | - | N |
| data.publishedAt | 발행일 | string | - | N |
| data.exposeEndAt | 노출 종료일 (발행일+7일) | string | - | N |

**동시성**: entryIds를 "notice_id가 비어있는 것만" 조건으로 트랜잭션 안에서 원자적으로 UPDATE합니다. 관리자 두 명이 겹치는 entryIds로 동시에 발행을 시도하면 먼저 커밋된 쪽만 성공하고, 나중 쪽은 409로 실패합니다(공지도 함께 롤백되어 빈 공지가 남지 않음).

**Status**

| status | response content |
| --- | --- |
| 201 | 발행 성공 |
| 400 | 존재하지 않는 entryIds 포함 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 409 | 동시에 다른 관리자가 발행해서 entryIds 중 일부가 이미 다른 공지에 묶임 (다시 조회 후 재시도) |

---

## 32. 마이페이지 - 풀이 기록 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/users/me/exam-history |
| **설명** | 지금까지 제출한 시험 풀이 기록을 최신순으로 조회합니다. **과목(subject) + 연도(year) 조합당 최신 1건만 유지됩니다** — 같은 과목·같은 연도 시험을 재응시하면 이전 기록은 지워지고 이번 기록으로 교체됩니다. 과목이 같아도 연도가 다르면 별도 기록으로 남습니다. |
| **인증** | JWT Bearer Token 필수 |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| search | 시험 제목 검색어 | string | optional | Y | "데이터베이스" |
| page | 페이지 번호 (기본 1) | number | optional | Y | 1 |
| limit | 페이지당 개수 (기본 10, 최대 50) | number | optional | Y | 10 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.items[].id | 풀이 기록 ID (상세 조회 #33에 사용) | number | - | N |
| data.items[].examId | 시험 ID | number | - | N |
| data.items[].examTitle | 시험 제목 | string | - | N |
| data.items[].subjectName | 과목명 | string | - | N |
| data.items[].year | 연도 | number | - | N |
| data.items[].examType | 시험 종류 | number | - | N |
| data.items[].totalQuestions | 전체 문항 수 | number | - | N |
| data.items[].correctCount | 맞은 문항 수 | number | - | N |
| data.items[].wrongCount | 틀린 문항 수 | number | - | N |
| data.items[].submittedAt | 제출 시각 | string | - | N |
| data.total | 전체 풀이 기록 수 (검색 필터 적용 기준). 마이페이지 사이드바의 "풀었던 문제 N회" 같은 통계는 검색어 없이 호출한 이 값을 그대로 쓰면 됩니다 | number | - | N |
| data.page | 현재 페이지 | number | - | N |
| data.limit | 페이지당 개수 | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 (기록 없으면 `data.items: []`, `data.total: 0`) |
| 401 | 인증 실패 (로그인 필요) |

**⚠️ 기존 API 변경 사항 (#11 시험 제출)**

`POST /api/exams/:id/submit`은 그대로 두되, `Authorization` 헤더가 있으면 채점 후 결과를 풀이 기록으로 저장합니다. 같은 과목+같은 연도 조합의 기존 기록이 있으면 지우고 이번 기록으로 교체합니다(과목-연도 조합당 최신 1건만 유지, 덮어쓰기). 헤더가 없으면 기존과 동일하게 저장 없이 채점 결과만 반환(비로그인 이용 유지). 헤더가 있는데 토큰이 유효하지 않으면(만료/위조) 401을 반환합니다(무효 토큰을 비로그인으로 조용히 처리하지 않음).

---

## 33. 마이페이지 - 풀이 기록 상세 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/users/me/exam-history/:attemptId |
| **설명** | 풀이 기록 1건의 문항별 정오답을 조회합니다. `attemptId`는 #32 목록 응답의 `data.items[].id`. |
| **인증** | JWT Bearer Token 필수 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 풀이 기록 ID | number | - | N |
| data.exam.id | 시험 ID | number | - | N |
| data.exam.title | 시험 제목 | string | - | N |
| data.exam.subject | 과목명 | string | - | N |
| data.exam.year | 연도 | number | - | N |
| data.exam.examType | 시험 종류 | number | - | N |
| data.totalQuestions | 전체 문항 수 | number | - | N |
| data.correctCount | 맞은 문항 수 | number | - | N |
| data.wrongCount | 틀린 문항 수 | number | - | N |
| data.submittedAt | 제출 시각 | string | - | N |
| data.answers[].questionId | 문항 ID | number | - | N |
| data.answers[].questionNumber | 문항 번호 | number | - | N |
| data.answers[].questionText | 문제 내용 | string | - | N |
| data.answers[].userAnswer | 사용자가 선택한 답 (미선택 시 null) | number \| null | - | Y |
| data.answers[].correctAnswers | 정답 (복수 정답 문항이면 여러 개) | array of number | - | N |
| data.answers[].isCorrect | 정오답 여부 | boolean | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | 인증 실패 (로그인 필요) |
| 404 | 기록을 찾을 수 없음 (본인 기록이 아닌 경우도 404로 응답 — 다른 사람 기록 존재 여부를 유추 못 하게 함) |

---

## 34. 북마크 - 목록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/bookmarks |
| **설명** | 북마크한 문항 목록을 조회합니다. |
| **인증** | JWT Bearer Token 필수 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data[].questionId | 문항 ID | number | - | N |
| data[].questionNumber | 문항 번호 | number | - | N |
| data[].questionText | 문제 내용 | string | - | N |
| data[].examId | 시험 ID | number | - | N |
| data[].examTitle | 시험 제목 | string | - | N |
| data[].subjectName | 과목명 | string | - | N |
| data[].bookmarkedAt | 북마크 생성일 | string | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | 인증 실패 (로그인 필요) |

> ⚠️ 정렬 방식(등록순/과목순/시험순) 미정 — 기본값은 `bookmarkedAt DESC`로 제안.

---

## 35. 북마크 - 등록

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/bookmarks/:questionId |
| **설명** | 문항을 북마크합니다. 이미 북마크된 문항이면 에러 없이 기존 상태를 그대로 반환합니다(idempotent). |
| **인증** | JWT Bearer Token 필수 |

**Status**

| status | response content |
| --- | --- |
| 201 | 등록 성공 |
| 200 | 이미 북마크되어 있던 경우 |
| 401 | 인증 실패 |
| 404 | 문항을 찾을 수 없음 |

---

## 36. 북마크 - 해제

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | DELETE |
| **URL** | /api/bookmarks/:questionId |
| **설명** | 문항 북마크를 해제합니다. |
| **인증** | JWT Bearer Token 필수 |

**Status**

| status | response content |
| --- | --- |
| 200 | 해제 성공 (원래 북마크가 없었어도 200) |
| 401 | 인증 실패 |

---

## 37. 문항 - 단건 공개 조회 (암기모드 공유 진입점)

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/questions/:id |
| **설명** | 문항 하나를 단건 조회합니다. 암기모드 화면 진입 및 공유 링크(`/memorize/{id}` 등)의 데이터 소스로 사용. 로그인 없이도 접근 가능(공유 링크는 비로그인 사용자도 열 수 있어야 함). |
| **인증** | 불필요 (Authorization 헤더가 있으면 `isBookmarked` 채워짐) |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 문항 ID | number | - | N |
| data.questionNumber | 문항 번호 | number | - | N |
| data.text | 문제 지문 | string | - | N |
| data.example | 예시/보기 텍스트 (#10과 동일하게 코드 블록 포맷팅 적용) | string | optional | Y |
| data.sharedExample | 공통 보기 텍스트 | string | optional | Y |
| data.imageUrls | 문항 이미지 URL 배열 | array of string | optional | Y |
| data.choices | 선택지 배열 (#10과 동일 구조) | array | - | N |
| data.correctAnswers | 정답 번호 배열 | array of number | - | N |
| data.explanation | 해설 | string | optional | Y |
| data.exam.id | 시험 ID | number | - | N |
| data.exam.title | 시험 제목 | string | - | N |
| data.exam.subject | 과목명 | string | - | N |
| data.isBookmarked | 북마크 여부 (비로그인 시 null) | boolean | optional | Y |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |
| 401 | Authorization 헤더는 있으나 토큰이 유효하지 않음(만료/위조). 헤더 자체가 없으면 401 없이 비로그인으로 처리됨 |
| 404 | 문항을 찾을 수 없음 |

> ⚠️ 암기모드 특성상 정답/해설을 항상 포함하는 걸로 가정했습니다 (study 모드와 동일). 공유 링크로 들어온 사람에게도 정답까지 보여줄지는 확인 필요합니다.
