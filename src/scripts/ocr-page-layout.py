#!/usr/bin/env python3
"""시험지 페이지 이미지의 레이아웃(블록 종류·위치)을 Datalab API로 받아 저장한다.

validate-pdf-parse.py가 만든 페이지 이미지(tmp/pdf-validate/<시험>/pages/page_XX.png)를
Datalab /api/v1/convert(output_format=json)에 보내고, 결과의 json(블록 트리)만 저장한다.
rebuild-exam-figures.py가 이 결과로 그림 영역을 잘라낸다.

API 키: 환경변수 DATALAB_API_KEY, 없으면 `datalab login`이 저장한 ~/.config/datalab/config.json
페이지당 1~3분 걸리므로 --jobs로 병렬 처리. 이미 받은 페이지는 건너뛴다.

사용 예:
  python3 src/scripts/ocr-page-layout.py "2019-컴퓨터구조-3학년-2학기" "2018-컴퓨터구조-3학년-2학기" --jobs 6
결과: tmp/pdf-layout/<시험>/page_XX/page.json
"""

import argparse
import json
import os
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://api.datalab.to/api/v1/convert"


def api_key() -> str:
    key = os.getenv("DATALAB_API_KEY")
    if key:
        return key
    base = Path(os.getenv("XDG_CONFIG_HOME") or Path.home() / ".config")
    cfg = base / "datalab" / "config.json"
    if cfg.exists():
        key = json.loads(cfg.read_text(encoding="utf-8")).get("api_key")
        if key:
            return key
    raise SystemExit("DATALAB_API_KEY가 없습니다 (환경변수 또는 `datalab login`).")


def fetch_layout(img: Path, out: Path, key: str, timeout: int = 600) -> str:
    out.mkdir(parents=True, exist_ok=True)
    b = uuid.uuid4().hex
    body = (
        f"--{b}\r\nContent-Disposition: form-data; name=\"output_format\"\r\n\r\njson\r\n"
        f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{img.name}\"\r\n"
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + img.read_bytes() + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(API, data=body, headers={"X-Api-Key": key, "Content-Type": f"multipart/form-data; boundary={b}"})
    submitted = json.load(urllib.request.urlopen(req, timeout=60))
    if not submitted.get("success"):
        return f"submit 실패: {submitted.get('error')}"
    url = submitted["request_check_url"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(3)
        d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers={"X-Api-Key": key}), timeout=60))
        if d.get("status") == "complete":
            if not d.get("json"):
                return "결과에 json 없음"
            (out / "page.json").write_text(json.dumps(d["json"], ensure_ascii=False), encoding="utf-8")
            return "ok"
        if d.get("status") == "error":
            return f"error: {d.get('error')}"
    return "timeout"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("titles", nargs="+", help="tmp/pdf-validate 아래 시험 폴더 이름")
    ap.add_argument("--pdf-validate-dir", default="tmp/pdf-validate")
    ap.add_argument("--out-dir", default="tmp/pdf-layout")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--force", action="store_true", help="이미 받은 페이지도 다시 받기")
    args = ap.parse_args()

    key = api_key()
    jobs = []
    for title in args.titles:
        pages = sorted((Path(args.pdf_validate_dir) / title / "pages").glob("page_*.png"))
        if not pages:
            print(f"[SKIP] 페이지 이미지 없음: {title}")
        for p in pages:
            out = Path(args.out_dir) / title / p.stem
            done = (out / "page.json").exists() and (out / "page.json").stat().st_size > 1000
            if done and not args.force:
                continue
            jobs.append((p, out))
    print(f"받을 페이지 {len(jobs)}개")

    def run(job):
        p, out = job
        try:
            r = fetch_layout(p, out, key)
        except Exception as e:  # noqa: BLE001 — 한 페이지 실패가 전체를 멈추지 않게
            r = f"예외: {e}"
        print(f"  {p.parent.parent.name}/{p.name}: {r}")
        return r == "ok"

    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        ok = sum(ex.map(run, jobs))
    print(f"완료 {ok}/{len(jobs)}")
    if ok != len(jobs):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
