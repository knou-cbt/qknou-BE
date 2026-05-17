#!/usr/bin/env python3
"""
structured-questions.json → 실제 API 응답 포맷 JSON 변환 스크립트.

사용법:
  python3 src/scripts/generate-mock-json.py

출력: tmp/mock/{과목}-{연도}.json

이미지 URL은 http://localhost:8080/tmp/parsed/... 로 변환됩니다.
JSON 생성 후 프로젝트 루트에서 아래 명령어로 이미지 서버를 띄우세요:
  python3 -m http.server 8080
"""

import json
from pathlib import Path

BASE_URL = "http://localhost:8080"

TARGETS = [
    ("tmp/parsed/알고리즘/2015-249-알고리즘-3학년-3교시", "알고리즘", 2015),
    ("tmp/parsed/알고리즘/2016-250-알고리즘-3학년-3교시-1과목", "알고리즘", 2016),
    ("tmp/parsed/알고리즘/2017-252-알고리즘-3학년-3교시-(3p)", "알고리즘", 2017),
    ("tmp/parsed/알고리즘/2018-255-알고리즘-3학년-3교시", "알고리즘", 2018),
    ("tmp/parsed/알고리즘/2019-256-알고리즘-3학년-3교시", "알고리즘", 2019),
    ("tmp/parsed/이산수학/2015-244-이산수학=2학년-2교시", "이산수학", 2015),
    ("tmp/parsed/이산수학/2016-245-이산수학-2학년-2교시-2과목", "이산수학", 2016),
    ("tmp/parsed/이산수학/2017-247-이산수학-2학년-2교시", "이산수학", 2017),
    ("tmp/parsed/이산수학/2018-250-이산수학-2학년-2교시", "이산수학", 2018),
    ("tmp/parsed/이산수학/2019-251-이산수학-2학년-2교시", "이산수학", 2019),
    ("tmp/parsed/운영체제/2016-251-운영체제-3학년-3교시-2과목", "운영체제", 2016),
    ("tmp/parsed/운영체제/2017-253-운영체제-3학년-3교시", "운영체제", 2017),
    ("tmp/parsed/운영체제/2018-256-운영체제-3학년-3교시", "운영체제", 2018),
    ("tmp/parsed/운영체제/2019-257-운영체제-3학년-3교시", "운영체제", 2019),
    ("tmp/parsed/소웨공/2017-257-소프트웨어공학-4학년-3교시-(3p)", "소프트웨어공학", 2017),
    ("tmp/parsed/소웨공/2018-260-소프트웨어공학-4학년-3교시-(3p)", "소프트웨어공학", 2018),
    ("tmp/parsed/소웨공/2019-261-소프트웨어공학-4학년-3교시-(3p)", "소프트웨어공학", 2019),
    ("tmp/parsed/정통망/2016-253-정보통신망-4학년2교시-1과목", "정보통신망", 2016),
    ("tmp/parsed/정통망/2017-255-정보통신망-4학년-2교시", "정보통신망", 2017),
    ("tmp/parsed/정통망/2018-258-정보통신망-4학년-2교시", "정보통신망", 2018),
    ("tmp/parsed/정통망/2019-259-정보통신망-4학년-2교시", "정보통신망", 2019),
]


def to_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{BASE_URL}/{path}"


def to_url_list(paths: list | None) -> list | None:
    if not paths:
        return None
    return [to_url(p) for p in paths]


def convert(out_dir: str, subject: str, year: int) -> dict:
    exam_dir = Path(out_dir)
    report = json.loads((exam_dir / "report.json").read_text(encoding="utf-8"))
    questions_raw = json.loads(
        (exam_dir / "structured-questions.json").read_text(encoding="utf-8")
    )

    meta = report.get("metadata", {})
    title = meta.get("subjectName", subject)

    questions = []
    for i, q in enumerate(questions_raw):
        choices = []
        for c in q.get("choices", []):
            choices.append(
                {
                    "number": c["number"],
                    "text": c["text"],
                    "imageUrls": to_url_list(c.get("imageUrls")),
                }
            )

        questions.append(
            {
                "id": i + 1,
                "number": q["questionNumber"],
                "text": q["questionText"],
                "example": q.get("exampleText"),
                "sharedExample": q.get("sharedExample"),
                "sharedExampleImageUrls": to_url_list(
                    q.get("sharedExampleImageUrls")
                ),
                "imageUrls": to_url_list(q.get("questionImageUrls")),
                "choices": choices,
                "conceptTags": q.get("conceptTags"),
                "correctAnswers": q.get("correctAnswers"),
                "explanation": q.get("explanation"),
            }
        )

    return {
        "success": True,
        "data": {
            "exam": {
                "id": 1,
                "title": title,
                "subject": subject,
                "totalQuestions": len(questions),
                "year": year,
            },
            "questions": questions,
        },
    }


def main():
    out_dir = Path("tmp/mock")
    out_dir.mkdir(parents=True, exist_ok=True)

    for exam_path, subject, year in TARGETS:
        result = convert(exam_path, subject, year)
        out_file = out_dir / f"{subject}-{year}.json"
        out_file.write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        count = len(result["data"]["questions"])
        print(f"[OK] {out_file}  ({count}문항)")

    print()
    print("이미지 서버 실행 (프로젝트 루트에서):")
    print("  python3 -m http.server 8080")
    print()
    print("생성된 JSON 파일:")
    for exam_path, subject, year in TARGETS:
        print(f"  http://localhost:8080/tmp/mock/{subject}-{year}.json")


if __name__ == "__main__":
    main()
