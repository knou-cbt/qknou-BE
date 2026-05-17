#!/usr/bin/env python3
"""
answer-sheet-to-csv.py — KNOU 기말시험 정답표 PDF → CSV 변환

Usage:
  python3 src/scripts/answer-sheet-to-csv.py [--out tmp/answers.csv]
"""

import argparse
import csv
import re
import sys
from pathlib import Path

try:
    import fitz
except ImportError:
    print("[ERROR] PyMuPDF가 없습니다: pip install PyMuPDF")
    sys.exit(1)

# 중복정답 코드 → 답 문자열
MULTI_ANS: dict[str, str] = {
    "A": "1,2", "B": "1,3", "C": "1,4",
    "D": "2,3", "E": "2,4", "F": "3,4",
    "G": "1,2,3", "H": "1,2,4", "I": "1,3,4",
    "J": "2,3,4", "K": "1,2,3,4",
}

ANSWER_CHARS = set("1234ABCDEFGHIJK")
IDEOGRAPHIC_SPACE = "　"

RANGE_HDR = re.compile(r"^(\d+)~(\d+)$")
BLOCK5_RE = re.compile(r"^[1-4A-K　]{5}$")
SPACED5_RE = re.compile(r"^[1-4A-K] [1-4A-K] [1-4A-K] [1-4A-K] [1-4A-K]$")
SINGLE_RE = re.compile(r"^[1-4A-K]$")


def decode_char(c: str) -> str | None:
    """'1'-'4' 또는 'A'-'K' → answer string. 공백/무효 → None."""
    c = c.strip().upper()
    if not c or c == IDEOGRAPHIC_SPACE:
        return None
    if c in MULTI_ANS:
        return MULTI_ANS[c]
    if c in "1234":
        return c
    return None


def decode_group(line: str) -> list[str | None]:
    """한 그룹 라인을 5개 답으로 분해."""
    line = line.strip()
    if BLOCK5_RE.match(line):
        return [decode_char(c) for c in line]
    if SPACED5_RE.match(line):
        return [decode_char(c) for c in line.split()]
    return []


def detect_page_format(page_blocks: list[tuple]) -> tuple[str, int]:
    """
    페이지 블록에서 포맷과 시작 문항번호를 감지.

    Returns:
        (format, start_q):
            format: 'grouped' | 'individual'
            start_q: 36 or 1
    """
    all_text = "\n".join(text for *_, text, _ in page_blocks if isinstance(text, str))

    has_36_40 = bool(re.search(r"36~40", all_text))
    has_1_5 = bool(re.search(r"1~5", all_text))

    # 2020 1학기: 개별 번호 열 (1, 2, 3 ... 35)
    # 특징: 5자 블록이나 스페이스-5 패턴이 없고, 단일 digit 라인만 있음
    has_grouped_data = False
    for *_, text, _ in page_blocks:
        if not isinstance(text, str):
            continue
        for line in text.splitlines():
            line = line.strip()
            if BLOCK5_RE.match(line) or SPACED5_RE.match(line):
                has_grouped_data = True
                break
        if has_grouped_data:
            break

    if not has_grouped_data:
        fmt = "individual"
    else:
        fmt = "grouped"

    start_q = 36 if has_36_40 else 1
    return fmt, start_q


def parse_data_block(text: str, fmt: str, start_q: int) -> dict | None:
    """
    단일 블록 텍스트를 파싱하여 subject 정보를 반환.

    Returns:
        {grade, subject, answers: {q_num: answer_str}} or None
    """
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return None

    grade = None
    subject_parts: list[str] = []
    answer_groups: list[str] = []   # grouped format
    answer_singles: list[str] = []  # individual format

    grade_found = False
    for line in lines:
        stripped = line.strip()

        # 학년 (단일 숫자 1-4, 아직 그레이드 미감지)
        if not grade_found and re.match(r"^[1-4]$", stripped):
            grade = int(stripped)
            grade_found = True
            continue

        # 답 그룹 라인 (grouped format)
        if fmt == "grouped" and (BLOCK5_RE.match(stripped) or SPACED5_RE.match(stripped)):
            answer_groups.append(stripped)
            continue

        # 개별 답 라인 (individual format)
        if fmt == "individual" and SINGLE_RE.match(stripped) and grade_found:
            answer_singles.append(stripped)
            continue

        # 나머지 → 과목명
        if stripped and not RANGE_HDR.match(stripped) and stripped not in ("학년", "교과목명"):
            subject_parts.append(stripped)

    if grade is None:
        return None

    subject = "".join(subject_parts).strip()
    if not subject:
        return None

    answers: dict[int, str] = {}

    if fmt == "grouped":
        for i, grp in enumerate(answer_groups):
            decoded = decode_group(grp)
            for j, ans in enumerate(decoded):
                if ans is not None:
                    q = start_q + i * 5 + j
                    answers[q] = ans

    elif fmt == "individual":
        for i, single in enumerate(answer_singles):
            ans = decode_char(single)
            if ans is not None:
                q = start_q + i
                answers[q] = ans

    if not answers:
        return None

    return {"grade": grade, "subject": subject, "answers": answers}


def parse_pdf(pdf_path: Path) -> list[dict]:
    """
    정답표 PDF 한 파일을 파싱하여 rows 반환.

    Returns list of:
        {year, semester, grade, subject_name, question_number, answer}
    """
    fname = pdf_path.name

    # 연도 추출
    year_m = re.search(r"(\d{4})", fname)
    if not year_m:
        print(f"[WARN] 연도 감지 실패: {fname}")
        return []
    year = int(year_m.group(1))

    # 학기 추출
    sem_m = re.search(r"([12])학기", fname)
    semester = int(sem_m.group(1)) if sem_m else 1

    doc = fitz.open(str(pdf_path))
    results: list[dict] = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        raw_blocks = page.get_text("blocks")
        # block: (x0, y0, x1, y1, text, block_no, block_type)
        # block_type 1 = image, skip
        blocks = [b for b in raw_blocks if len(b) >= 5 and isinstance(b[4], str)]

        fmt, start_q = detect_page_format(
            [(b[0], b[1], b[2], b[3], b[4], 0) for b in blocks]
        )

        seen_keys: set[tuple] = set()

        for block in blocks:
            text = block[4]
            # 헤더/주석 블록 건너뜀 (과목명+학년+답 패턴이 없으면 스킵)
            if "학년" in text or "교과목명" in text:
                continue
            if "중복정답" in text or "대 조 표" in text:
                continue
            if "정답 또는" in text or "☞" in text:
                continue

            parsed = parse_data_block(text, fmt, start_q)
            if parsed is None:
                continue

            key = (parsed["grade"], parsed["subject"])
            if key in seen_keys:
                continue
            seen_keys.add(key)

            for q_num, ans in sorted(parsed["answers"].items()):
                results.append(
                    {
                        "year": year,
                        "semester": semester,
                        "grade": parsed["grade"],
                        "subject_name": parsed["subject"],
                        "question_number": q_num,
                        "answer": ans,
                    }
                )

    doc.close()
    return results


def main() -> None:
    ap = argparse.ArgumentParser(description="기말시험 정답표 PDF → CSV (연도별)")
    ap.add_argument(
        "--pdf-dir",
        default="refs/기말시험 정답표(2014~2020)_real",
        help="PDF 폴더 경로",
    )
    ap.add_argument("--out-dir", default="tmp/answers", help="출력 CSV 폴더 경로")
    args = ap.parse_args()

    pdf_dir = Path(args.pdf_dir)
    if not pdf_dir.exists():
        print(f"[ERROR] PDF 폴더가 없습니다: {pdf_dir}")
        sys.exit(1)

    pdfs = sorted(pdf_dir.rglob("*.pdf"))
    if not pdfs:
        print(f"[ERROR] PDF 파일이 없습니다: {pdf_dir}")
        sys.exit(1)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    fieldnames = ["year", "semester", "grade", "subject_name", "question_number", "answer"]

    # Group by (year, semester) → separate CSV per file
    from collections import defaultdict
    year_sem_rows: dict[tuple, list[dict]] = defaultdict(list)

    for pdf_path in pdfs:
        print(f"[..] {pdf_path.name}")
        rows = parse_pdf(pdf_path)
        subjects = len({(r["year"], r["semester"], r["subject_name"]) for r in rows})
        print(f"  → {subjects} 과목, {len(rows)} 문항")
        for row in rows:
            year_sem_rows[(row["year"], row["semester"])].append(row)

    if not year_sem_rows:
        print("[WARN] 파싱된 데이터가 없습니다.")
        sys.exit(1)

    total_subjects = 0
    total_rows = 0
    for (year, semester), rows in sorted(year_sem_rows.items()):
        sem_label = f"{semester}학기"
        out_path = out_dir / f"{year}-{sem_label}.csv"
        with out_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        subj_count = len({r["subject_name"] for r in rows})
        total_subjects += subj_count
        total_rows += len(rows)
        print(f"  → {out_path.name}: {subj_count} 과목, {len(rows)} 문항")

    print(f"\n완료: {total_subjects} 과목 (중복포함), {total_rows} 문항 → {out_dir}/")


if __name__ == "__main__":
    main()
