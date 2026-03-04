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
| 16~18 | Health | 서버 상태, 성능 측정, DB 연결 |

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
| data.questions[].example | 예시/보기 텍스트 | string | optional | Y | null |
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
| **설명** | 특정 문제의 해설 조회. DB에 해설이 없으면 AI로 실시간 생성 후 반환합니다. |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 문제 ID | number | - | N | 101 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| explanation | 해설 텍스트 | string | - | N |
| generated | 이번 요청에서 새로 생성된 해설인지 여부 | boolean | - | N |

**Example**

```json
{
  "success": true,
  "explanation": "정답은 3번입니다. 불포화대에서는...",
  "generated": false
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
| **설명** | 특정 문제의 해설을 AI로 강제 재생성하여 DB에 덮어씁니다. |

**Request - Path parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| id | 문제 ID | number | - | N | 101 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| explanation | 새로 생성된 해설 텍스트 | string | - | N |
| generated | 재생성 여부 (항상 true) | boolean | - | N |

**Status**

| status | response content |
| --- | --- |
| 201 | 해설 재생성 성공 |
| 404 | 문제를 찾을 수 없습니다 |

---

## 16. Health - 서버 상태 확인

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

## 17. Health - 성능 측정

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

## 18. Health - DB 연결 상태

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
