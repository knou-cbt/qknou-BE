#!/usr/bin/env python3
"""
update-answers-from-csv.py — refs/answers/*.csv 로 DB correct_answers 업데이트

전략: DB 전체 매핑을 3번의 bulk SELECT로 메모리에 올린 뒤
      단일 UPDATE로 처리해 라운드트립 최소화.

Usage:
  python3 -u src/scripts/update-answers-from-csv.py [--dry-run]
"""

import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extensions
    import psycopg2.extras
except ImportError:
    print("[ERROR] psycopg2가 없습니다: pip install psycopg2-binary")
    sys.exit(1)

ANSWERS_DIR = Path("refs/answers")
DRY_RUN = "--dry-run" in sys.argv


def get_db_url() -> str:
    env_path = Path("env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("DIRECT_URL="):
                return line.split("=", 1)[1].strip().strip('"')
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("[ERROR] DB URL을 찾을 수 없습니다.")
        sys.exit(1)
    return url


def parse_answer(ans_str: str) -> list[int]:
    return [int(x) for x in ans_str.strip().split(",") if x.strip()]


def load_all_csv() -> dict[tuple, list[tuple]]:
    """CSV 전체 로드 → {(subject_name, year, semester): [(q_num, answers_json), ...]}"""
    grouped: dict[tuple, list[tuple]] = defaultdict(list)
    for csv_path in sorted(ANSWERS_DIR.glob("*.csv")):
        print(f"[..] {csv_path.name} 로드 중")
        with csv_path.open(encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                key = (row["subject_name"].strip(), int(row["year"]), int(row["semester"]))
                grouped[key].append((int(row["question_number"]), json.dumps(parse_answer(row["answer"]))))
    return grouped


def main():
    url = get_db_url()
    conn = psycopg2.connect(url, options="-c statement_timeout=0")
    conn.set_isolation_level(psycopg2.extensions.ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    cur.execute("SET statement_timeout = 0")

    # ── 1. CSV 전체 로드 ──────────────────────────────────────────
    csv_data = load_all_csv()
    print(f"\n[..] CSV 로드 완료: {len(csv_data)}개 (과목×연도×학기)")

    # ── 2. DB 매핑 bulk 로드 (3 쿼리) ────────────────────────────
    print("[..] DB 매핑 로드 중...")

    cur.execute("SELECT id, name FROM subjects")
    subject_map = {name: sid for sid, name in cur.fetchall()}
    print(f"     subjects: {len(subject_map)}개")

    # exam_type 1=1학기기말, 2=2학기기말
    cur.execute("SELECT id, subject_id, year, exam_type FROM exams WHERE exam_type IN (1, 2)")
    exam_map: dict[tuple, int] = {}  # (subject_id, year, exam_type) -> exam_id
    for eid, sid, yr, et in cur.fetchall():
        exam_map[(sid, yr, et)] = eid
    print(f"     exams: {len(exam_map)}개")

    cur.execute("SELECT exam_id, MIN(question_number) FROM questions GROUP BY exam_id")
    q_min_map: dict[int, int] = {eid: qmin for eid, qmin in cur.fetchall()}
    print(f"     question min 번호: {len(q_min_map)}개 exam")

    # ── 3. 업데이트 페이로드 조립 ────────────────────────────────
    print("\n[..] 업데이트 페이로드 조립 중...")

    # (exam_id, q_num, answers_json) 전체 목록
    payload: list[tuple] = []
    skipped_subject = 0
    skipped_exam = 0

    for (subject_name, year, semester), q_rows in sorted(csv_data.items()):
        sid = subject_map.get(subject_name)
        if sid is None:
            skipped_subject += 1
            continue

        # CSV semester로 먼저 찾고, 없으면 반대 학기 exam으로 fallback
        exam_id = exam_map.get((sid, year, semester))
        if exam_id is None:
            other = 2 if semester == 1 else 1
            exam_id = exam_map.get((sid, year, other))
        if exam_id is None:
            skipped_exam += 1
            continue

        # offset: CSV는 1부터, DB는 다를 수 있음
        db_min = q_min_map.get(exam_id, 1)
        csv_min = min(q for q, _ in q_rows)
        offset = db_min - csv_min

        # question_number 중복 dedup (학년별 중복 → 첫 번째 학년 기준)
        seen: set[int] = set()
        for q_num, answers_json in q_rows:
            q_db = q_num + offset
            if q_db not in seen:
                seen.add(q_db)
                payload.append((exam_id, q_db, answers_json))

    print(f"     업데이트 대상: {len(payload)}개 문항")
    print(f"     스킵 (과목 없음): {skipped_subject}개, 스킵 (시험 없음): {skipped_exam}개")

    if not payload:
        print("[WARN] 업데이트할 항목이 없습니다.")
        return

    # ── 4. 단일 bulk UPDATE ───────────────────────────────────────
    if DRY_RUN:
        print(f"\n[DRY-RUN] 실제 업데이트 없이 종료. 대상: {len(payload)}개")
        return

    print("\n[..] bulk UPDATE 실행 중...")
    psycopg2.extras.execute_values(
        cur,
        """
        UPDATE questions AS q
        SET correct_answers = v.answers::jsonb
        FROM (VALUES %s) AS v(exam_id, qnum, answers)
        WHERE q.exam_id = v.exam_id::int
          AND q.question_number = v.qnum::int
        """,
        payload,
        template="(%s, %s, %s)",
        page_size=1000,
    )
    print(f"\n완료 — {len(payload)}개 문항 업데이트 시도, 스킵 {skipped_subject + skipped_exam}개")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
