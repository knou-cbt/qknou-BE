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
| 18~20 | Health | 서버 상태, 성능 측정, DB 연결 |

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
| **설명** | 시험 답안 제출 및 채점 결과 수신 |

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

## 18. Health - 서버 상태 확인

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

## 19. Health - 성능 측정

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

## 20. Health - DB 연결 상태

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
