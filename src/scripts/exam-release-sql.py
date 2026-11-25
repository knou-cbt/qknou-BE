#!/usr/bin/env python3
"""로컬 DB의 시험(과목·시험·문항)을 운영 반영용 SQL 릴리스로 만든다.

- 과목: 같은 이름이 없을 때만 INSERT
- 시험: 같은 과목·연도·exam_type 시험이 이미 있으면 그 시험은 통째로 건너뜀(문항 섞임 방지)
- 다시 실행해도 중복으로 들어가지 않고, 기존 데이터는 바꾸지 않는다. 해설은 넣지 않는다.
- 문항 그림 URL은 그대로 들어가므로 R2에 먼저 올라가 있어야 한다 (upload-local-images-r2.py).

사용 예 (로컬 DB의 exam id):
  python3 src/scripts/exam-release-sql.py --release 20261125-3 --exam-ids 5,6,7 \\
      --note "자료구조 2015·2016, 컴퓨터구조 2015 (2학기 기말)"
결과: ~/qknou-release/<release>/{SQL, SHA256SUMS, RELEASE.md}
운영 반영 전에 빈 DB와 운영과 비슷한 DB 사본에서 두 번씩 실행해 보고 내용을 비교할 것.
필요 패키지: psycopg2-binary
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from r2_env import load_env_file  # noqa: E402

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

QCOLS = ["question_number", "question_text", "example_text", "shared_example",
         "shared_example_image_urls", "question_image_urls", "correct_answers", "choices"]


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (list, dict)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", required=True, help="YYYYMMDD-n (운영 promote.log에서 안 쓴 이름)")
    ap.add_argument("--exam-ids", required=True, help="쉼표 구분 exam id")
    ap.add_argument("--note", default="", help="SQL 첫 줄·RELEASE.md에 적을 설명")
    ap.add_argument("--slug", default="add_exams", help="SQL 파일 이름 뒷부분")
    ap.add_argument("--release-dir", help="기본: ~/qknou-release/<release>")
    ap.add_argument("--env-file", default=".env.development")
    args = ap.parse_args()

    load_env_file(args.env_file)
    ids = [int(x) for x in args.exam_ids.split(",")]
    db = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("select e.*, s.name sname from exams e join subjects s on s.id=e.subject_id where e.id = any(%s) order by e.id", (ids,))
    exams = cur.fetchall()
    if len(exams) != len(ids):
        raise SystemExit(f"없는 exam id가 있습니다: {sorted(set(ids) - {e['id'] for e in exams})}")

    L = [f"-- {args.release}: 시험 {len(exams)}개 추가. {args.note}".rstrip(),
         "-- 과목은 이름이 같은 게 없을 때만 추가. 같은 과목·연도·학기(exam_type)의 시험이 이미 있으면 그 시험은 통째로 건너뜀(문항 섞임 방지).",
         "-- 다시 실행해도 중복으로 들어가지 않음. 기존 데이터는 바꾸지 않음. 문항 그림은 R2에 먼저 올려 둠.",
         "BEGIN;"]
    subjects = sorted({e["sname"] for e in exams})
    for s in subjects:
        L.append(f"INSERT INTO subjects (name) SELECT {lit(s)} WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE name = {lit(s)});")
    nq = 0
    for e in exams:
        cur.execute("select * from questions where exam_id=%s order by question_number", (e["id"],))
        qs = cur.fetchall()
        nq += len(qs)
        sid = f"(SELECT id FROM subjects WHERE name = {lit(e['sname'])} ORDER BY id LIMIT 1)"
        rows = ",\n  ".join("(" + ", ".join(lit(q[c]) for c in QCOLS) + ")" for q in qs)
        L += ["", f"-- {e['title']} ({len(qs)}문항)",
              f"WITH new_exam AS (\n  INSERT INTO exams (subject_id, year, exam_type, title, total_questions)\n"
              f"  SELECT {sid}, {e['year']}, {lit(e['exam_type'])}, {lit(e['title'])}, {len(qs)}\n"
              f"  WHERE NOT EXISTS (SELECT 1 FROM exams WHERE subject_id = {sid} AND year = {e['year']}"
              f" AND exam_type IS NOT DISTINCT FROM {lit(e['exam_type'])})\n  RETURNING id\n)",
              "INSERT INTO questions (exam_id, question_number, question_text, example_text, shared_example,"
              " shared_example_image_urls, question_image_urls, correct_answers, choices)",
              "SELECT new_exam.id, v.qn, v.qt, v.et, v.se, v.sei::jsonb, v.qi::jsonb, v.ca::jsonb, v.ch::jsonb FROM new_exam, (VALUES\n  "
              + rows + "\n) AS v(qn, qt, et, se, sei, qi, ca, ch);"]
    L.append("COMMIT;")

    rdir = Path(args.release_dir or Path.home() / "qknou-release" / args.release)
    rdir.mkdir(parents=True, exist_ok=True)
    name = f"{args.release.replace('-', '_')}_{args.slug}.sql"
    (rdir / name).write_text("\n".join(L) + "\n", encoding="utf-8")
    sha = hashlib.sha256((rdir / name).read_bytes()).hexdigest()
    (rdir / "SHA256SUMS").write_text(f"{sha}  {name}\n")
    (rdir / "RELEASE.md").write_text(f"""# {args.release}

- 작성: {date.today().isoformat()}
- 이미지: 변경 없음
- DB 마이그레이션: 있음 — {name}
- 환경변수 변경: 없음

## 변경 내용
- 과목 {', '.join(subjects)} (없으면 추가), 시험 {len(exams)}개(문항 {nq}개) 추가. {args.note}
- 문항 그림은 R2에 먼저 올려 둠
- 없을 때만 INSERT하므로 기존 데이터는 바뀌지 않음, 앱 재시작 불필요
""", encoding="utf-8")
    print(f"{rdir / name}: 시험 {len(exams)}개, 문항 {nq}개")


if __name__ == "__main__":
    main()
