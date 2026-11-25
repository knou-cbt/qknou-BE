#!/usr/bin/env python3
"""DB에 로컬 파일 경로(tmp/... 등)로 저장된 문항 이미지를 R2에 올리고 URL로 바꾼다.

seed-exam-from-pdf.py는 boto3나 R2 환경변수가 없으면 이미지를 로컬 경로 그대로 저장한다.
그렇게 들어간 문항을 찾아 exam-images/<시험 폴더>/q###/<파일> 로 업로드하고
question_image_urls / shared_example_image_urls / choices[].imageUrls 를 공개 URL로 바꾼다.
파일이 하나라도 없으면 전체를 롤백한다.

사용 예:
  python3 src/scripts/upload-local-images-r2.py            # dry-run
  python3 src/scripts/upload-local-images-r2.py --apply
필요 패키지: boto3 psycopg2-binary
"""

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from r2_env import load_env_file, r2_client  # noqa: E402

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

LOCAL_IMG = r'"[^h"][^"]*\.(png|jpe?g|gif|webp)"'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=".", help="상대 경로의 기준 (저장소 루트)")
    ap.add_argument("--env-file", default=".env.development")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    load_env_file(args.env_file)
    s3, bucket, dom = r2_client()
    repo = Path(args.repo).resolve()
    db = psycopg2.connect(os.environ["DATABASE_URL"])
    uploaded, missing = set(), []

    def conv(p, qno, prefix=""):
        if not isinstance(p, str) or p.startswith("http"):
            return p
        fp = Path(p) if Path(p).is_absolute() else repo / p
        parts = Path(p).parts
        stem = parts[parts.index("images") - 1] if "images" in parts else fp.parent.parent.name
        key = f"exam-images/{stem}/q{qno:03d}/{prefix}{fp.name}"
        if not fp.exists():
            missing.append(p)
            return p
        if key not in uploaded:
            if args.apply:
                ct = mimetypes.guess_type(fp.name)[0] or "image/png"
                s3.upload_file(str(fp), bucket, key, ExtraArgs={"ContentType": ct})
            uploaded.add(key)
        return f"{dom}/{key}"

    n = 0
    with db, db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select id, question_number, question_image_urls, shared_example_image_urls, choices from questions"
            " where question_image_urls::text ~ %s or shared_example_image_urls::text ~ %s or choices::text ~ %s order by id",
            (LOCAL_IMG, LOCAL_IMG, LOCAL_IMG))
        for r in cur.fetchall():
            qn = r["question_number"]
            qi = [conv(u, qn) for u in r["question_image_urls"]] if r["question_image_urls"] else r["question_image_urls"]
            si = [conv(u, qn, "shared_") for u in r["shared_example_image_urls"]] if r["shared_example_image_urls"] else r["shared_example_image_urls"]
            ch = r["choices"]
            for c in ch:
                if c.get("imageUrls"):
                    v = c["imageUrls"] if isinstance(c["imageUrls"], list) else [c["imageUrls"]]
                    c["imageUrls"] = [conv(u, qn) for u in v]
            n += 1
            if args.apply:
                cur.execute(
                    "update questions set question_image_urls=%s, shared_example_image_urls=%s, choices=%s where id=%s",
                    (json.dumps(qi, ensure_ascii=False) if qi is not None else None,
                     json.dumps(si, ensure_ascii=False) if si is not None else None,
                     json.dumps(ch, ensure_ascii=False), r["id"]))
        if missing:
            print(f"파일 없음 {len(missing)}개:")
            for m in missing[:20]:
                print("  ", m)
            if args.apply:
                raise SystemExit("파일 누락 — 롤백")
    print(("APPLIED" if args.apply else "DRY-RUN"), f"문항 {n}, 파일 {len(uploaded)}")


if __name__ == "__main__":
    main()
