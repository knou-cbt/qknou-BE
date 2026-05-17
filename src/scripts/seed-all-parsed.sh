#!/usr/bin/env bash
# tmp/parsed/ 아래의 모든 파싱된 시험을 DB에 일괄 저장
# 사용법: bash src/scripts/seed-all-parsed.sh [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PARSED_DIR="$PROJECT_ROOT/tmp/parsed"
SEED_SCRIPT="$SCRIPT_DIR/seed-exam-from-pdf.py"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
  echo "[DRY-RUN MODE] 실제 저장 없이 내용만 출력합니다."
fi

declare -A SUBJECT_MAP=(
  ["알고리즘"]="알고리즘"
  ["이산수학"]="이산수학"
  ["운영체제"]="운영체제"
  ["정통망"]="정보통신망"
  ["소웨공"]="소프트웨어공학"
)

SUCCESS=0
FAIL=0
FAIL_LIST=()

for folder_name in "${!SUBJECT_MAP[@]}"; do
  subject_name="${SUBJECT_MAP[$folder_name]}"
  subject_dir="$PARSED_DIR/$folder_name"

  if [[ ! -d "$subject_dir" ]]; then
    echo "[SKIP] 폴더 없음: $subject_dir"
    continue
  fi

  for exam_dir in "$subject_dir"/*/; do
    [[ -d "$exam_dir" ]] || continue

    report="$exam_dir/report.json"
    questions="$exam_dir/structured-questions.json"

    if [[ ! -f "$report" || ! -f "$questions" ]]; then
      echo "[SKIP] report.json 또는 structured-questions.json 없음: $exam_dir"
      continue
    fi

    echo ""
    echo "▶ $exam_dir"
    echo "  subject: $subject_name"

    if python3 "$SEED_SCRIPT" \
        --out-dir "$exam_dir" \
        --subject-name "$subject_name" \
        --exam-type 1 \
        $DRY_RUN; then
      echo "  [OK]"
      ((SUCCESS++)) || true
    else
      echo "  [FAIL]"
      FAIL_LIST+=("$exam_dir")
      ((FAIL++)) || true
    fi
  done
done

echo ""
echo "=============================="
echo "완료: 성공 $SUCCESS / 실패 $FAIL"
if [[ ${#FAIL_LIST[@]} -gt 0 ]]; then
  echo "실패 목록:"
  for f in "${FAIL_LIST[@]}"; do
    echo "  - $f"
  done
fi
