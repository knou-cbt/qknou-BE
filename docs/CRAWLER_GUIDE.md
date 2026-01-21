# 크롤러 사용 가이드

## 📚 개요

방송대 기출문제를 크롤링하여 데이터베이스에 저장하는 크롤러입니다.

## 🎯 주요 기능

1. **단일 시험지 크롤링** - 특정 시험지 URL 하나만 크롤링
2. **전체 자동 크롤링** - 메인 페이지에서 모든 과목의 모든 시험지 자동 크롤링
3. **에러 로그 관리** - 실패한 크롤링 자동 기록 및 재시도 지원

## 🚀 사용 방법

### 1. 단일 시험지 크롤링

```bash
# 기본 크롤링
yarn crawl https://allaclass.tistory.com/855

# 기존 데이터가 있으면 덮어쓰기
yarn crawl https://allaclass.tistory.com/855 --retry
```

### 2. 전체 자동 크롤링

```bash
# 모든 과목 크롤링 (기본 딜레이: 1000ms)
yarn crawl https://allaclass.tistory.com/2365 --all

# 딜레이 조정 (서버 부담 감소)
yarn crawl https://allaclass.tistory.com/2365 --all --delay=2000

# 기존 데이터 덮어쓰기 모드
yarn crawl https://allaclass.tistory.com/2365 --all --retry
```

## 📊 크롤링 결과

### 성공 시
```
[1/150] 📖 과목: 경영학원론
  📄 3개 시험지 발견
  [1/3] 크롤링: https://allaclass.tistory.com/855
  ✅ 크롤링 완료!
     - 시험 ID: 1
     - 제목: 경영학원론
     - 문제 수: 20
  [2/3] 크롤링: https://allaclass.tistory.com/856
  ...

============================================================
✅ 크롤링 완료!
   - 성공: 450개
   - 실패: 5개
============================================================
```

### 실패 시 (에러 로그 자동 생성)
```
[10/150] 📖 과목: 통계학
  📄 2개 시험지 발견
  [1/2] 크롤링: https://allaclass.tistory.com/920
  ❌ 실패: 시험 연도를 추출할 수 없습니다. HTML 구조를 확인하세요.

============================================================
✅ 크롤링 완료!
   - 성공: 448개
   - 실패: 7개

⚠️  실패 목록:
   [exam] 통계학 - https://allaclass.tistory.com/920
      사유: 시험 연도를 추출할 수 없습니다. HTML 구조를 확인하세요.
   [exam] 회계학 - https://allaclass.tistory.com/950
      사유: 정답표를 찾을 수 없습니다. HTML 구조를 확인하세요.

📝 로그 파일 저장:
   - 상세 에러 로그: C:\...\logs\crawl\crawl-errors-2026-01-19.json
   - 실패 URL 목록: C:\...\logs\crawl\failed-urls-2026-01-19-10-30-45-123.txt
   💡 재시도: cat C:\...\logs\crawl\failed-urls-2026-01-19-10-30-45-123.txt | while read url; do yarn crawl "$url" --retry; done
============================================================
```

## 🔄 실패한 크롤링 재시도

### Windows (Git Bash)
```bash
cat logs/crawl/failed-urls-2026-01-19-10-30-45-123.txt | while read url; do
  yarn crawl "$url" --retry
  sleep 1
done
```

### Windows (PowerShell)
```powershell
Get-Content logs/crawl/failed-urls-2026-01-19-10-30-45-123.txt | ForEach-Object {
  yarn crawl $_ --retry
  Start-Sleep -Seconds 1
}
```

### Linux/Mac
```bash
cat logs/crawl/failed-urls-2026-01-19-10-30-45-123.txt | while read url; do
  yarn crawl "$url" --retry
  sleep 1
done
```

## 📁 로그 파일 구조

### 1. 상세 에러 로그 (JSON)
**경로**: `logs/crawl/crawl-errors-YYYY-MM-DD.json`

```json
[
  {
    "timestamp": "2026-01-19T10:30:45.123Z",
    "url": "https://allaclass.tistory.com/855",
    "subjectName": "경영학원론",
    "errorType": "exam",
    "errorMessage": "시험 연도를 추출할 수 없습니다.",
    "stackTrace": "Error: 시험 연도를 추출할 수 없습니다...\n    at ..."
  }
]
```

### 2. 실패 URL 목록 (텍스트)
**경로**: `logs/crawl/failed-urls-YYYY-MM-DD-HH-MM-SS-mmm.txt`

```
https://allaclass.tistory.com/855
https://allaclass.tistory.com/856
https://allaclass.tistory.com/857
```

## 🛠️ 트러블슈팅

### 문제: "시험 연도를 추출할 수 없습니다"
- **원인**: HTML 구조 변경 또는 비정상적인 페이지
- **해결**: 해당 URL 직접 확인 후 크롤링 로직 수정 필요

### 문제: "정답표를 찾을 수 없습니다"
- **원인**: 정답이 공개되지 않은 시험
- **해결**: 해당 시험은 건너뛰기

### 문제: "알 수 없는 시험 타입"
- **원인**: 기말/계절학기 외의 새로운 시험 유형
- **해결**: `exam-type.enum.ts`에 새 타입 추가 필요

### 문제: 크롤링이 너무 느림
- **해결**: `--delay` 값을 줄이기 (단, 서버 차단 주의)
```bash
yarn crawl URL --all --delay=500  # 기본 1000ms → 500ms
```

### 문제: 서버에서 차단됨 (429 Too Many Requests)
- **해결**: `--delay` 값을 늘리기
```bash
yarn crawl URL --all --delay=3000  # 3초 대기
```

## 📈 성능 최적화 팁

1. **적절한 딜레이 설정**
   - 안정성: 2000ms 이상
   - 균형: 1000ms (기본값)
   - 빠른 크롤링: 500ms (차단 위험)

2. **분할 크롤링**
   ```bash
   # 특정 과목만 크롤링 (코드 수정 필요)
   # subjectFilter 옵션 활용
   ```

3. **재시도 전략**
   - 1차 크롤링: 빠른 속도로 시도
   - 실패한 것만 2차 재시도: 느린 속도로

## 🔐 주의사항

1. **서버 부담 고려**
   - 과도한 요청으로 서버에 부담을 주지 않도록 주의
   - 딜레이는 최소 500ms 이상 권장

2. **저작권**
   - 크롤링한 데이터는 개인 학습 목적으로만 사용
   - 무단 재배포 금지

3. **데이터 백업**
   - 크롤링 전 DB 백업 권장
   - `--retry` 옵션 사용 시 기존 데이터 덮어씀

## 📞 문의

문제가 발생하면 로그 파일과 함께 이슈 등록 부탁드립니다.
