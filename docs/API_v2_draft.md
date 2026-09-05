# QKNOU API 문서 — v2 고도화 초안 (21~36)

이 문서는 [API.md](./API.md)(1~20번, 기존 운영 API)에 이어지는 **v2 신규/변경 API 초안**입니다.
확정 전까지는 이 파일에서 관리하고, 프론트 협의가 끝나면 `API.md`에 병합합니다.

**목차**

| 번호 | 구분 | 설명 |
| --- | --- | --- |
| 21 | 피드백 | 피드백 제출 (GitHub Issue 자동 생성, 제출 횟수 제한 없음) |
| 22~28 | 시험지 등록 | 사용자 업로드, 사전 중복 확인, 관리자 검수/수정/게시/반려 |
| 29~31 | 업데이트 알림 | 활성 공지 조회, 내역 적재(관리자), 공지 발행(관리자) |
| 32 | 마이페이지 | 최근 시험 풀이 기록 조회 (+ 기존 #11 제출 API 동작 변경) |
| 33~35 | 북마크 | 목록 조회, 등록, 해제 |
| 36 | 문항 | 문항 단건 공개 조회 (암기모드 공유 진입점) |

**공통 규칙**
- 응답 포맷은 기존과 동일하게 `{ success: boolean, data: ... }` 기본.
- 인증이 필요한 API는 기존과 동일하게 `Authorization: Bearer {access_token}` 헤더 + `JwtAuthGuard`.
- 관리자 전용 API는 `JwtAuthGuard` + `AdminGuard`(ADMIN_EMAIL 기반, 기존 방식 그대로) 이중 적용.

---

## 21. Feedback - 피드백 제출

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
| content | 피드백 내용 | string | - | N | "3번 선택지 정답 표기가 이상해요" |
| questionId | 문항 ID (문항 관련 제보일 때) | number | optional | Y | 101 |
| pageUrl | 제보 시점 페이지 URL | string | optional | Y | "https://qknou.kr/exams/1" |

**type → GitHub 라벨 매핑**

| type | GitHub 라벨 |
| --- | --- |
| question_bug | 문항-버그 |
| site_bug | 사이트-버그 |
| suggestion | 기능-제안 |
| other | 기타 |

> ⚠️ 라벨은 레포에 미리 수동으로 생성해둬야 합니다 (없는 라벨을 issue 생성 API에 넘기면 422 에러).

**동일 문항 중복 제보 처리**

`type=question_bug`이고 `questionId`가 있는 경우, 같은 문항에 대해 여러 사용자가 각자 이슈를 새로 만들지 않도록 아래 순서로 처리합니다.

1. 같은 `questionId`로 저장된 가장 최근 `feedbacks` row에 연결된 `github_issue_number`가 있는지 조회
2. 있으면 GitHub API로 해당 이슈가 아직 **open** 상태인지 확인
3. open이면 → 새 이슈를 만들지 않고 **기존 이슈에 댓글만 추가**, 이번 제보의 `feedbacks` row는 그 기존 `github_issue_number`를 그대로 참조
   - 댓글에는 반드시 이번 제보자가 작성한 **원문 content를 그대로** 포함해야 합니다. 같은 문항이어도 신고자마다 지적하는 내용이나 의견(예: 정답이 2번이라는 사람 vs 4번이라는 사람)이 다를 수 있으므로, "추가 제보가 있습니다" 같은 요약/알림성 댓글로 뭉개면 안 됩니다.
   - 댓글 포맷 예시:
     ```
     **추가 제보** (2026-09-05 10:32)
     - 제보자: {user.email}
     - 내용: {content}
     - 페이지: {pageUrl}
     ```
4. closed거나 기존 이슈가 없으면 → 새 이슈 생성
5. 2번의 GitHub API 조회 자체가 실패하면(네트워크 오류 등) → 안전하게 "기존 이슈 없음"으로 간주하고 새 이슈 생성 (제보 자체가 실패하면 안 됨)

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 피드백 ID | number | - | N |
| data.type | 피드백 유형 | string | - | N |
| data.githubIssueUrl | 연결된 GitHub Issue URL (신규 생성이든 기존 이슈 재사용이든 항상 채워짐, GitHub 연동 자체가 실패한 경우만 null) | string | optional | Y |
| data.isNewIssue | 새로 이슈를 생성했는지(true) / 기존 이슈에 댓글로 합쳐졌는지(false) | boolean | - | N |
| data.createdAt | 생성일 | string (ISO 8601) | - | N |

**Example**

```json
// Request
{
  "type": "question_bug",
  "content": "3번 선택지 정답 표기가 이상해요",
  "questionId": 101,
  "pageUrl": "https://qknou.kr/exams/1"
}

// Response
{
  "success": true,
  "data": {
    "id": 12,
    "type": "question_bug",
    "githubIssueUrl": "https://github.com/{org}/qknou-feedback/issues/45",
    "isNewIssue": true,
    "createdAt": "2026-09-05T10:00:00+09:00"
  }
}
```

**Status**

| status | response content |
| --- | --- |
| 201 | 접수 성공 |
| 400 | 잘못된 요청 (type 값 오류, content 누락 등) |
| 401 | 인증 실패 (로그인 필요) |
| 404 | questionId에 해당하는 문항을 찾을 수 없음 |

---

## 22. 시험지 등록 - 업로드

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
| 허용 형식 | PDF만 (`application/pdf`, 확장자가 아니라 실제 매직바이트 `%PDF-` 검증) |
| 최대 크기 | 20MB (Multer `fileSize` 제한으로 서버 메모리에 다 올라오기 전에 차단) |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.id | 등록 ID | number | - | N |
| data.status | 처리 상태 ("pending") | string | - | N |
| data.createdAt | 등록일 | string (ISO 8601) | - | N |

**Status**

| status | response content |
| --- | --- |
| 201 | 접수 성공 (처리는 비동기) |
| 400 | 이미 등록된 시험지 (중복) / 유효성 실패 / 파일 형식 오류(PDF 아님) / 크기 초과(20MB) |
| 401 | 인증 실패 (로그인 필요) |

---

## 23. 시험지 등록 - 사전 중복 확인

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/exam-submissions/check |
| **설명** | 업로드 전에 `(subjectId, year, examType)` 조합이 이미 등록돼 있는지 미리 확인합니다. 사용자 개인의 업로드 이력을 보여주는 API가 아니라, 중복 업로드를 막기 위한 사전 확인용입니다. |
| **인증** | 불필요 |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| subjectId | 과목 ID | number | - | N | 3 |
| year | 연도 | number | - | N | 2025 |
| examType | 시험 종류 | number | - | N | 1 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.blocked | 업로드 가능 여부 (true면 업로드 막아야 함) | boolean | - | N |
| data.reason | 차단 사유 ("already_published": 이미 게시됨 \| "already_in_review": 검수 진행 중) | string | optional | Y |

`status`가 `rejected`(반려)나 `failed`(OCR 실패)였던 건은 차단 대상에서 제외합니다 — 새로 다시 올릴 수 있어야 하니까요.

**Example**

```json
{
  "success": true,
  "data": {
    "blocked": true,
    "reason": "already_in_review"
  }
}
```

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 |

---

## 24. 시험지 등록(관리자) - 검수 대기열 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/admin/exam-submissions |
| **설명** | 관리자가 검수할 시험지 등록 목록을 조회합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Query parameter**

| key | 설명 | value 타입 | 옵션 | Nullable | 예시 |
| --- | --- | --- | --- | --- | --- |
| status | 상태 필터 | string | optional | Y | "parsed" |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data[].id | 등록 ID | number | - | N |
| data[].uploaderEmail | 업로드한 사용자 이메일 | string | - | N |
| data[].subjectName | 과목명 | string | - | N |
| data[].year | 연도 | number | - | N |
| data[].examType | 시험 종류 | number | - | N |
| data[].status | 처리 상태 | string | - | N |
| data[].questionCount | OCR로 파싱된 문항 수 (parsed 이후) | number | optional | Y |
| data[].createdAt | 등록일 | string | - | N |

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
| data.parsedResult | OCR 파싱 결과 (문항 배열, `questions` 엔티티와 동일 구조) | object \| null | - | Y |
| data.errorMessage | OCR 실패 사유 (status=failed일 때) | string | optional | Y |

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
| **설명** | 관리자가 OCR 파싱 결과를 검수하며 수정합니다. 게시 전까지 여러 번 호출 가능. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| parsedResult | 수정된 문항 배열 (전체 교체) | object | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 수정 성공 |
| 400 | parsedResult 형식 오류 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |

---

## 27. 시험지 등록(관리자) - 게시

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/exam-submissions/:id/publish |
| **설명** | 검수 완료된 `parsedResult`를 실제 `exams`/`questions`에 반영하고 등록 건 상태를 `published`로 변경합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data.examId | 새로 생성된 시험 ID | number | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 게시 성공 |
| 400 | parsedResult가 비어있거나 유효하지 않음 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |
| 409 | 그 사이 동일 조합(subjectId/year/examType)의 시험이 이미 게시됨 |

---

## 28. 시험지 등록(관리자) - 반려

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | POST |
| **URL** | /api/admin/exam-submissions/:id/reject |
| **설명** | 등록 건을 반려 처리합니다. |
| **인증** | JWT Bearer Token + 관리자 권한 필수 |

**Request - Body (JSON)**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| reason | 반려 사유 | string | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 반려 처리 성공 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |
| 404 | 등록 건을 찾을 수 없음 |

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

**Status**

| status | response content |
| --- | --- |
| 201 | 발행 성공 |
| 400 | entryIds가 비어있거나 이미 다른 공지에 묶인 내역 포함 |
| 401 | 인증 실패 |
| 403 | 관리자 권한 없음 |

---

## 32. 마이페이지 - 최근 시험 풀이 기록 조회

### **기본 정보**

| 항목 | 내용 |
| --- | --- |
| **Method** | GET |
| **URL** | /api/users/me/exam-history |
| **설명** | 가장 최근에 제출한 시험 1건과 문항별 정오답을 조회합니다. 여러 건을 누적하지 않고 항상 최신 1건만 존재합니다. |
| **인증** | JWT Bearer Token 필수 |

**Response**

| key | 설명 | value 타입 | 옵션 | Nullable |
| --- | --- | --- | --- | --- |
| success | 성공 여부 | boolean | - | N |
| data | 풀이 기록 (없으면 null) | object \| null | - | Y |
| data.exam.id | 시험 ID | number | - | N |
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
| data.answers[].userAnswer | 사용자가 선택한 답 (미선택 시 null, 기존 제출 API가 문항당 단일 선택만 지원) | number \| null | - | Y |
| data.answers[].correctAnswers | 정답 (복수 정답 문항이면 여러 개) | array of number | - | N |
| data.answers[].isCorrect | 정오답 여부 | boolean | - | N |

**Status**

| status | response content |
| --- | --- |
| 200 | 조회 성공 (풀이 기록 없으면 `data: null`) |
| 401 | 인증 실패 (로그인 필요) |

**⚠️ 기존 API 변경 사항 (#11 시험 제출)**

`POST /api/exams/:id/submit`은 그대로 두되, `Authorization` 헤더가 있으면 채점 후 결과를 위 기록으로 저장(있으면 덮어쓰기)하도록 동작을 추가합니다. 헤더가 없으면 기존과 동일하게 저장 없이 채점 결과만 반환(비로그인 이용 유지).

---

## 33. 북마크 - 목록 조회

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

## 34. 북마크 - 등록

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

## 35. 북마크 - 해제

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

## 36. 문항 - 단건 공개 조회 (암기모드 공유 진입점)

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
| 404 | 문항을 찾을 수 없음 |

> ⚠️ 암기모드 특성상 정답/해설을 항상 포함하는 걸로 가정했습니다 (study 모드와 동일). 공유 링크로 들어온 사람에게도 정답까지 보여줄지는 확인 필요합니다.
