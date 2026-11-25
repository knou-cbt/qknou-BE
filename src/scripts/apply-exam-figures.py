#!/usr/bin/env python3
"""rebuild-exam-figures.py 결과(plan.json)를 반영한다.

1) crops/*.png를 R2 exam-images/<시험>/v2/ 에 업로드
2) 로컬 DB 문항을 plan대로 UPDATE (--apply일 때만, 아니면 dry-run)
3) 운영 반영용 SQL 릴리스 폴더 생성: <release-dir>/{SQL, SHA256SUMS, RELEASE.md}
   운영 SQL은 id 대신 과목명·연도·exam_type·시험 제목·문항 번호로 찾아 내용 컬럼만 바꾼다(정답·해설 유지).

사용 예:
  python3 src/scripts/apply-exam-figures.py --release 20261125-4                    # dry-run
  python3 src/scripts/apply-exam-figures.py --release 20261125-4 --apply
  → ~/qknou-release/20261125-4/ 를 docs/HANDOVER.md "운영 배포" 절차대로 업로드

주의: 반영 전에 로컬 questions 테이블을 백업해 두고, 운영과 같은 상태의 DB 사본에 SQL을 먼저 실행해 볼 것.
필요 패키지: boto3 psycopg2-binary
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from r2_env import load_env_file, r2_client  # noqa: E402

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

COLS = ["question_text", "example_text", "shared_example", "shared_example_image_urls", "question_image_urls", "choices"]
JSONC = {"shared_example_image_urls", "question_image_urls", "choices"}


def lit(v, json_col=False):
    if v is None:
        return "NULL"
    if json_col:
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--release", required=True, help="YYYYMMDD-n (운영 promote.log에서 안 쓴 이름)")
    ap.add_argument("--fix-dir", default="tmp/figure-fix")
    ap.add_argument("--release-dir", help="기본: ~/qknou-release/<release>")
    ap.add_argument("--env-file", default=".env.development")
    ap.add_argument("--apply", action="store_true", help="R2 업로드와 로컬 DB 반영을 실제로 수행")
    args = ap.parse_args()

    load_env_file(args.env_file)
    s3, bucket, dom = r2_client()
    db = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    rdir = Path(args.release_dir or Path.home() / "qknou-release" / args.release)

    sql = [f"-- {args.release}: 시험 문항 그림·텍스트 정리 (OCR이 그림을 설명문/표 텍스트로 바꿔 넣은 문제).",
           "-- 그림은 PDF에서 잘라 R2(exam-images/<시험>/v2/)에 올려 둠. 시험 제목·문항 번호로 찾아 내용 컬럼만 UPDATE (정답·해설은 그대로).",
           "BEGIN;"]
    uploaded, nq, titles = 0, 0, []
    for pf in sorted(Path(args.fix_dir).glob("*/plan.json")):
        p = json.loads(pf.read_text(encoding="utf-8"))
        if not p["plan"]:
            continue
        title, base = p["title"], pf.parent
        titles.append(title)
        cur.execute("select e.year, e.exam_type, s.name from exams e join subjects s on s.id=e.subject_id where e.id=%s", (p["exam_id"],))
        ex = cur.fetchone()
        urlmap = {}

        def conv(v):
            nonlocal uploaded
            if isinstance(v, str) and v.startswith("crops/"):
                if v not in urlmap:
                    key = f"exam-images/{title}/v2/{v.split('/', 1)[1]}"
                    if args.apply:
                        s3.upload_file(str(base / v), bucket, key, ExtraArgs={"ContentType": "image/png"})
                    uploaded += 1
                    urlmap[v] = f"{dom}/{key}"
                return urlmap[v]
            if isinstance(v, list):
                return [conv(x) for x in v]
            if isinstance(v, dict):
                return {k: conv(x) for k, x in v.items()}
            return v

        sql.append(f"\n-- {title}")
        exam_type = "NULL" if ex["exam_type"] is None else ex["exam_type"]
        for item in p["plan"]:
            new = {k: conv(v) for k, v in item["new"].items()}
            cols = [c for c in COLS if c in new]
            nq += 1
            sets = ", ".join(f"{c} = {lit(new[c], c in JSONC)}" for c in cols)
            sql.append(
                f"UPDATE questions q SET {sets} FROM exams e JOIN subjects s ON s.id = e.subject_id"
                f" WHERE q.exam_id = e.id AND s.name = {lit(ex['name'])} AND e.year = {ex['year']}"
                f" AND e.exam_type IS NOT DISTINCT FROM {exam_type}"
                f" AND e.title = {lit(title)} AND q.question_number = {item['qn']};")
            if args.apply:
                cur.execute(
                    f"update questions set {', '.join(f'{c}=%s' for c in cols)} where id=%s",
                    [json.dumps(new[c], ensure_ascii=False) if (c in JSONC and new[c] is not None) else new[c] for c in cols] + [item["id"]])
    sql.append("COMMIT;")
    if args.apply:
        db.commit()

    rdir.mkdir(parents=True, exist_ok=True)
    name = f"{args.release.replace('-', '_')}_fix_exam_figures.sql"
    (rdir / name).write_text("\n".join(sql) + "\n", encoding="utf-8")
    sha = hashlib.sha256((rdir / name).read_bytes()).hexdigest()
    (rdir / "SHA256SUMS").write_text(f"{sha}  {name}\n")
    (rdir / "RELEASE.md").write_text(f"""# {args.release}

- 작성: {date.today().isoformat()}
- 이미지: 변경 없음
- DB 마이그레이션: 있음 — {name}
- 환경변수 변경: 없음

## 변경 내용
- 시험 {len(titles)}개, {nq}문항의 그림·텍스트 정리: {', '.join(titles)}
- OCR이 그림을 설명문/마크다운 표로 바꿔 넣은 부분을 지우고, PDF에서 잘라낸 그림(R2 exam-images/…/v2/)으로 교체
- 시험 제목·문항 번호로 찾아 내용 컬럼만 UPDATE (정답·해설은 그대로), 앱 재시작 불필요
""", encoding="utf-8")
    print(("APPLIED" if args.apply else "DRY-RUN"), f"문항 {nq}, 그림 {uploaded} → {rdir / name}")


if __name__ == "__main__":
    main()
