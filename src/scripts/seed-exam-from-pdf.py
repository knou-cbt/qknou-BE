#!/usr/bin/env python3
"""
validate-pdf-parse.py 출력 결과를 DB에 저장하는 스크립트.

사용 예:
  python3 src/scripts/seed-exam-from-pdf.py \\
    --out-dir "tmp/pdf-validate/252-알고리즘-3학년-3교시-(3p)" \\
    --subject-name "알고리즘" \\
    --year 2024 \\
    --exam-type 1

  # 과목 ID를 직접 지정할 경우:
  python3 src/scripts/seed-exam-from-pdf.py \\
    --out-dir "tmp/pdf-validate/..." \\
    --subject-id 5

  # 실제 저장 없이 내용 미리보기:
  python3 src/scripts/seed-exam-from-pdf.py \\
    --out-dir "tmp/pdf-validate/..." \\
    --subject-name "알고리즘" \\
    --dry-run
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[ERROR] psycopg2가 설치되지 않았습니다: pip install psycopg2-binary")
    sys.exit(1)

try:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError
except ImportError:
    boto3 = None


def load_dotenv():
    env_path = Path(".env")
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        key = k.strip()
        val = v.strip().strip("\"' ")
        if not os.getenv(key):
            os.environ[key] = val


def get_db_connection():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL 환경변수가 없습니다.")
    # pgbouncer=true 파라미터 제거 (psycopg2 미지원)
    db_url = re.sub(r"[?&]pgbouncer=true", "", db_url).rstrip("?")
    return psycopg2.connect(db_url)


def make_r2_client():
    if boto3 is None:
        return None, None, None
    endpoint = os.getenv("R2_ENDPOINT")
    key_id = os.getenv("R2_ACCESS_KEY_ID")
    secret = os.getenv("R2_SECRET_ACCESS_KEY")
    bucket = os.getenv("R2_BUCKET_NAME")
    public_domain = os.getenv("R2_PUBLIC_DOMAIN", "").rstrip("/")
    if not all([endpoint, key_id, secret, bucket]):
        return None, None, None
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
    )
    return client, bucket, public_domain


def upload_image_to_r2(local_path: str, r2_key: str, client, bucket: str, public_domain: str) -> str | None:
    if not Path(local_path).exists():
        return None
    try:
        ext = Path(local_path).suffix.lower()
        content_type = "image/png" if ext == ".png" else "image/jpeg"
        client.upload_file(local_path, bucket, r2_key, ExtraArgs={"ContentType": content_type})
        return f"{public_domain}/{r2_key}"
    except Exception as e:
        print(f"  [WARN] R2 업로드 실패: {local_path} → {e}")
        return None


def upload_question_images(q: dict, pdf_stem: str, r2_client, bucket: str, public_domain: str) -> dict:
    """question의 모든 이미지를 R2에 업로드하고 URL로 교체."""
    q = dict(q)
    q_no = q["questionNumber"]

    # questionImageUrls 업로드
    if q.get("questionImageUrls"):
        uploaded = []
        for local_path in q["questionImageUrls"]:
            fname = Path(local_path).name
            key = f"exam-images/{pdf_stem}/q{q_no:03d}/{fname}"
            url = upload_image_to_r2(local_path, key, r2_client, bucket, public_domain)
            uploaded.append(url or local_path)
        q["questionImageUrls"] = uploaded

    # choices[].imageUrls 업로드
    choices = []
    for c in q.get("choices") or []:
        c = dict(c)
        if c.get("imageUrls"):
            img_urls = c["imageUrls"] if isinstance(c["imageUrls"], list) else [c["imageUrls"]]
            uploaded = []
            for local_path in img_urls:
                fname = Path(local_path).name
                key = f"exam-images/{pdf_stem}/q{q_no:03d}/{fname}"
                url = upload_image_to_r2(local_path, key, r2_client, bucket, public_domain)
                uploaded.append(url or local_path)
            c["imageUrls"] = uploaded
        choices.append(c)
    q["choices"] = choices
    return q


def get_or_create_subject(cur, subject_name: str) -> int:
    cur.execute("SELECT id FROM subjects WHERE name = %s LIMIT 1", (subject_name,))
    row = cur.fetchone()
    if row:
        print(f"[OK] 기존 subject 사용 — id={row[0]}, name={subject_name}")
        return row[0]
    cur.execute(
        "INSERT INTO subjects (name) VALUES (%s) RETURNING id",
        (subject_name,),
    )
    new_id = cur.fetchone()[0]
    print(f"[OK] 새 subject 생성 — id={new_id}, name={subject_name}")
    return new_id


def parse_exam_type_from_text(text: str | None) -> int | None:
    if not text:
        return None
    t = text
    if "하계" in t:
        return 3
    if "동계" in t:
        return 4
    if "기말" in t:
        if "2학기" in t or "2 학기" in t:
            return 2
        if "1학기" in t or "1 학기" in t:
            return 1
    return None


def main():
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="PDF 파싱 결과(validate-pdf-parse.py)를 DB에 저장"
    )
    parser.add_argument(
        "--out-dir",
        required=True,
        help="validate-pdf-parse.py 출력 디렉토리 (report.json, structured-questions.json 위치)",
    )
    parser.add_argument("--subject-name", help="과목 이름 (없으면 신규 생성)")
    parser.add_argument("--subject-id", type=int, help="과목 ID (직접 지정, --subject-name보다 우선)")
    parser.add_argument(
        "--year",
        type=int,
        help="시험 연도 (report.json 메타데이터보다 우선 적용)",
    )
    parser.add_argument(
        "--exam-type",
        type=int,
        choices=[1, 2, 3, 4],
        help="시험 타입 (1: 1학기기말, 2: 2학기기말, 3: 하계계절, 4: 동계계절)",
    )
    parser.add_argument("--title", help="시험 제목 (기본값: PDF 파일명)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="실제 저장 없이 삽입될 내용만 출력",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    report_path = out_dir / "report.json"
    questions_path = out_dir / "structured-questions.json"

    if not report_path.exists():
        print(f"[ERROR] report.json이 없습니다: {report_path}")
        sys.exit(1)
    if not questions_path.exists():
        print(f"[ERROR] structured-questions.json이 없습니다: {questions_path}")
        sys.exit(1)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    questions = json.loads(questions_path.read_text(encoding="utf-8"))

    # 메타데이터에서 연도/시험유형/과목명 추출 (CLI 인수가 우선)
    meta = report.get("metadata", {})
    year = args.year or meta.get("year")
    title = args.title or Path(report.get("pdf_path", "")).stem or out_dir.name
    subject_name = args.subject_name or (None if args.subject_id else meta.get("subjectName"))

    # examType 결정: CLI > 메타데이터 직접 파싱 > semester + examType 조합
    exam_type = args.exam_type
    if not exam_type:
        exam_type = parse_exam_type_from_text(meta.get("examType"))
    if not exam_type:
        # "기말시험" + semester 숫자로 결정
        et = meta.get("examType", "")
        sem = meta.get("semester")
        if "기말" in (et or "") and sem in (1, 2):
            exam_type = sem  # 1학기기말=1, 2학기기말=2
        elif "하계" in (et or "") or sem == "하계":
            exam_type = 3
        elif "동계" in (et or "") or sem == "동계":
            exam_type = 4

    # 입력 검증
    if not args.subject_id and not subject_name:
        print(
            "[ERROR] 과목명을 자동 파싱하지 못했습니다. --subject-name 또는 --subject-id를 지정해주세요."
        )
        sys.exit(1)
    if not year:
        print(
            "[ERROR] 연도를 인식하지 못했습니다. --year 옵션으로 직접 지정하세요."
        )
        sys.exit(1)

    # 정보 요약 출력
    subject_label = f"ID={args.subject_id}" if args.subject_id else subject_name
    exam_type_labels = {1: "1학기기말", 2: "2학기기말", 3: "하계계절", 4: "동계계절"}
    exam_type_label = exam_type_labels.get(exam_type, f"{exam_type}(알 수 없음)") if exam_type else "미지정"
    anomalies = report.get("choice_count_anomalies", [])
    needs_recovery = report.get("needs_non_text_recovery", [])

    print(f"\n{'=' * 50}")
    print(f"  과목     : {subject_label}")
    print(f"  연도     : {year}")
    print(f"  시험타입 : {exam_type_label}")
    print(f"  제목     : {title}")
    print(f"  문항 수  : {len(questions)}")
    if anomalies:
        print(f"  [WARN] 선택지 4개 미만 문항: {anomalies}")
    if needs_recovery:
        print(f"  [WARN] 이미지 포함 문항 (correct_answers 수동 입력 필요): {needs_recovery}")
    print(f"{'=' * 50}\n")

    if args.dry_run:
        print("[DRY RUN] 아래 내용이 저장될 예정입니다 (실제 저장 안 함):\n")
        for q in questions[:5]:
            choices_preview = [
                f"{'①②③④'[c['number']-1]}{c.get('text','')[:20]}"
                for c in q.get("choices", [])
            ]
            print(
                f"  Q{q['questionNumber']:3d} | {(q.get('questionText') or '')[:50]:<50} | "
                + " ".join(choices_preview)
            )
        if len(questions) > 5:
            print(f"  ... 외 {len(questions) - 5}개")
        print("\n[DRY RUN] 종료. 실제 저장하려면 --dry-run을 제거하세요.")
        return

    # R2 클라이언트 초기화
    r2_client, r2_bucket, r2_public_domain = make_r2_client()
    if r2_client:
        print("[OK] R2 클라이언트 초기화 완료")
    else:
        print("[WARN] R2 환경변수 없음 — 이미지는 로컬 경로로 저장됩니다.")

    pdf_stem = Path(report.get("pdf_path", out_dir.name)).stem

    # 이미지 R2 업로드 (이미지 있는 문항만)
    if r2_client:
        img_questions = [q for q in questions if q.get("questionImageUrls") or
                         any(c.get("imageUrls") for c in (q.get("choices") or []))]
        if img_questions:
            print(f"[..] 이미지 R2 업로드 중 ({len(img_questions)}개 문항)...")
            questions = [
                upload_question_images(q, pdf_stem, r2_client, r2_bucket, r2_public_domain)
                if (q.get("questionImageUrls") or any(c.get("imageUrls") for c in (q.get("choices") or [])))
                else q
                for q in questions
            ]
            print("[OK] R2 업로드 완료")

    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                # subject 처리
                if args.subject_id:
                    cur.execute("SELECT id FROM subjects WHERE id = %s", (args.subject_id,))
                    if not cur.fetchone():
                        print(f"[ERROR] subject id={args.subject_id}가 존재하지 않습니다.")
                        sys.exit(1)
                    subject_id = args.subject_id
                    print(f"[OK] subject 확인 — id={subject_id}")
                else:
                    subject_id = get_or_create_subject(cur, subject_name)

                # exam 삽입
                cur.execute(
                    """
                    INSERT INTO exams (subject_id, year, exam_type, title, total_questions)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (subject_id, year, exam_type, title, len(questions)),
                )
                exam_id = cur.fetchone()[0]
                print(f"[OK] exams 삽입 — id={exam_id}")

                # questions 일괄 삽입
                rows = []
                for q in questions:
                    q_img = q.get("questionImageUrls") or None
                    rows.append(
                        (
                            exam_id,
                            q["questionNumber"],
                            q.get("questionText") or "",
                            q.get("exampleText"),
                            q.get("sharedExample"),
                            json.dumps(q_img) if q_img else None,
                            json.dumps([]),          # correct_answers — 추후 수동 입력
                            json.dumps(q.get("choices") or []),
                        )
                    )

                psycopg2.extras.execute_batch(
                    cur,
                    """
                    INSERT INTO questions (
                        exam_id, question_number, question_text,
                        example_text, shared_example, question_image_urls,
                        correct_answers, choices
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    rows,
                    page_size=50,
                )
                print(f"[OK] questions 삽입 — {len(rows)}개")

    finally:
        conn.close()

    print(f"\n완료. exam_id={exam_id}")
    if anomalies or needs_recovery:
        print(
            "\n[TODO] 아래 문항의 correct_answers를 직접 UPDATE해야 합니다:\n"
            f"  UPDATE questions SET correct_answers = '[정답번호]' WHERE exam_id = {exam_id} AND question_number IN (...);"
        )


if __name__ == "__main__":
    main()
