#!/usr/bin/env python
from __future__ import annotations
import argparse
import csv
import json
import os
import re
import shutil
import time
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


def ensure_api_keys_from_dotenv():
    required_keys = ["DATALAB_API_KEY"]
    if all(os.getenv(k) for k in required_keys):
        return
    env_path = Path(".env")
    if not env_path.exists():
        return
    try:
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            key = k.strip()
            if key in required_keys and not os.getenv(key):
                os.environ[key] = v.strip().strip("\"' ")
    except Exception:
        return


OCR_CORRECTIONS: dict[str, str] = {
    "밀즐친": "밑줄친",
    "밀줄친": "밑줄친",
    "밀줄": "밑줄",
    "밀즐": "밑줄",
    "졌음": "않음",  # 자주 오인식되는 부정 표현
}


_IMG_TAG_RE = re.compile(r"!\[(.+?)\]\(([^)]+)\)", re.DOTALL)


def _remove_chandra_alt_duplicates(text: str) -> str:
    """Chandra가 ![alt](url) 뒤에 alt 텍스트를 반복 출력하는 패턴 제거.

    두 가지 케이스:
    1. 같은 줄: ![alt](url) alt_text  →  ![alt](url)
    2. 다음 줄: ![alt](url)\n\nalt_text  →  ![alt](url)
    """
    # 케이스 1: 같은 줄 — ![alt](url) 뒤의 텍스트가 alt와 동일하면 제거
    def _strip_same_line(m: re.Match) -> str:
        full_tag = m.group(0)
        alt = m.group(1).strip()
        rest = m.group(3).strip() if m.group(3) else ""
        if alt and rest and len(alt) > 20:
            # rest가 alt의 앞부분으로 시작하면 제거
            if rest.startswith(alt[:40]) or alt.startswith(rest[:40]):
                return full_tag[: full_tag.index(m.group(3))]
        return full_tag

    text = re.sub(
        r"(!\[([^\]]*)\]\([^)]+\))([ \t]+[^\n!]+)?",
        lambda m: (
            m.group(1)
            if m.group(3) and m.group(2).strip() and len(m.group(2).strip()) > 20
               and (m.group(3).strip().startswith(m.group(2).strip()[:40]) or
                    m.group(2).strip().startswith(m.group(3).strip()[:40]))
            else m.group(0)
        ),
        text,
    )

    # 케이스 2: 다음 줄 — 이미지 태그 다음 비어있는 줄 건너뛰고 alt와 동일한 줄 제거
    lines = text.split("\n")
    result = []
    i = 0
    while i < len(lines):
        result.append(lines[i])
        imgs_in_line = _IMG_TAG_RE.findall(lines[i])
        if imgs_in_line:
            j = i + 1
            while j < len(lines):
                stripped = lines[j].strip()
                if not stripped:
                    j += 1
                    continue
                if any(
                    len(alt) > 20 and (
                        stripped.startswith(alt.strip()[:40]) or
                        alt.strip().startswith(stripped[:40])
                    )
                    for alt, _ in imgs_in_line
                ):
                    j += 1
                else:
                    break
            i = j
        else:
            i += 1
    return "\n".join(result)


def apply_ocr_corrections(text: str) -> str:
    text = _remove_chandra_alt_duplicates(text)
    for wrong, correct in OCR_CORRECTIONS.items():
        text = text.replace(wrong, correct)
    return text


QUESTION_NUMBER_PATTERNS = [
    re.compile(r"(?m)^\s*(\d{1,3})[.)]\s+"),
    re.compile(r"(?m)^\s*(\d{1,3})(?=[가-힣A-Za-z①②③④⑤])"),
]
QUESTION_SPLIT_PATTERN = re.compile(r"(?m)^\s*(\d{1,3})[.)]\s*")
CHOICE_MARKER_PATTERN = re.compile(r"(①|②|③|④)")



@dataclass
class PageSummary:
    page: int
    text_chars: int
    image_count: int
    extracted_text_preview: str


def parse_question_numbers(text: str):
    numbers = set()
    for pattern in QUESTION_NUMBER_PATTERNS:
        for m in pattern.finditer(text or ""):
            try:
                n = int(m.group(1))
                if 1 <= n <= 200:
                    numbers.add(n)
            except Exception:
                pass
    return sorted(numbers)



def run_chandra_ocr(image_path: Path, timeout: int = 180) -> tuple[str | None, str | None]:
    api_key = os.getenv("DATALAB_API_KEY")
    if not api_key:
        return None, "datalab_api_key_not_found"
    try:
        import http.client
        import ssl

        with open(image_path, "rb") as f:
            file_data = f.read()
        ext = image_path.suffix.lower().lstrip(".")
        mime = "image/png" if ext == "png" else f"image/{ext}"
        boundary = "ChandraFormBoundary7MA4YWxkTrZu0gW"

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="output_format"\r\n\r\nmarkdown\r\n'
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{image_path.name}"\r\n'
            f"Content-Type: {mime}\r\n\r\n"
        ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

        ctx = ssl.create_default_context()
        conn = http.client.HTTPSConnection("api.datalab.to", context=ctx, timeout=30)
        conn.request(
            "POST",
            "/api/v1/convert",
            body=body,
            headers={
                "X-Api-Key": api_key,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
        )
        resp = conn.getresponse()
        result = json.loads(resp.read())
        conn.close()

        if not result.get("success"):
            return None, f"chandra_submit_failed: {result.get('error')}"
        check_url = result.get("request_check_url")
        if not check_url:
            return None, "chandra_no_check_url"

        # Poll for result
        request_id = check_url.split("/")[-1]
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(3)
            conn2 = http.client.HTTPSConnection("api.datalab.to", context=ctx, timeout=30)
            conn2.request("GET", f"/api/v1/convert/{request_id}", headers={"X-Api-Key": api_key})
            r2 = conn2.getresponse()
            data = json.loads(r2.read())
            conn2.close()
            if data.get("status") == "complete":
                md = (data.get("markdown") or "").strip()
                return (md, None) if md else (None, "chandra_empty_output")
            if data.get("status") == "error":
                return None, f"chandra_error: {data.get('error')}"
        return None, "chandra_timeout"
    except Exception as e:
        return None, f"chandra_ocr_failed:{e}"


def run_ocr_if_possible(image_path: Path, provider: str = "chandra", model: str | None = None):
    return run_chandra_ocr(image_path)


_MAGIC_BYTES = {
    b"\x89PNG": "png",
    b"\xff\xd8\xff": "jpg",
    b"GIF8": "gif",
    b"RIFF": "webp",
}


def _detect_image_ext(data: bytes, name: str | None) -> str:
    if name and "." in name:
        return name.split(".")[-1].lower()
    for magic, ext in _MAGIC_BYTES.items():
        if data[: len(magic)] == magic:
            return ext
    return "png"


def render_pages(pdf_path: Path, out_dir: Path, dpi: int = 150, reuse: bool = False) -> list[Path]:
    """페이지 전체를 PNG로 렌더링 — 벡터 도형 포함 모든 시각적 요소 캡처."""
    if fitz is None:
        return []
    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    # 이미 렌더링된 파일이 있으면 재사용
    if reuse:
        existing = sorted(pages_dir.glob("page_*.png"))
        if existing:
            print(f"[SKIP] 페이지 렌더링 재사용 ({len(existing)}페이지)")
            return existing
    doc = fitz.open(str(pdf_path))
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    paths = []
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_path = pages_dir / f"page_{i:02d}.png"
        pix.save(str(img_path))
        paths.append(img_path)
    doc.close()
    return paths


def extract_images_with_bbox_from_fitz(pdf_path: Path, out_dir: Path) -> list[dict]:
    """PDF 내장 이미지를 추출하고 시각적 렌더링 좌표(bbox)를 기록.

    get_text("dict") 방식은 일부 이미지를 누락하므로 get_images()+get_image_bbox()를 사용.
    """
    if fitz is None:
        return []
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    result = []
    doc = fitz.open(str(pdf_path))
    for pidx, page in enumerate(doc, start=1):
        pw, ph = page.rect.width, page.rect.height
        img_no = 0
        seen_xrefs: set[int] = set()
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)
            try:
                bbox = page.get_image_bbox(img_info)
                # 너무 작은 이미지(장식용 등) 제외: 페이지 면적의 0.5% 미만
                w_pct = (bbox.x1 - bbox.x0) / pw * 100
                h_pct = (bbox.y1 - bbox.y0) / ph * 100
                if w_pct * h_pct < 0.5:
                    continue
                extracted = doc.extract_image(xref)
                if not extracted:
                    continue
                data = extracted.get("image")
                ext = extracted.get("ext", "png").lower()
                if not data:
                    continue
                img_no += 1
                saved_path = images_dir / f"page_{pidx:02d}_img_{img_no:02d}.{ext}"
                with open(saved_path, "wb") as f:
                    f.write(data)
                x0, y0, x1, y1 = bbox.x0, bbox.y0, bbox.x1, bbox.y1
                result.append({
                    "page": pidx,
                    "index": img_no,
                    "saved_path": str(saved_path),
                    "bytes": len(data),
                    "bbox": [x0, y0, x1, y1],
                    "bbox_percent": [
                        x0 / pw * 100 if pw else 0,
                        y0 / ph * 100 if ph else 0,
                        x1 / pw * 100 if pw else 0,
                        y1 / ph * 100 if ph else 0,
                    ],
                })
            except Exception as e:
                print(f"  [WARN] p{pidx} xref={xref} 이미지 추출 실패: {e}")
    doc.close()
    return result


def _nearest_question_above(
    y_px: float,
    x_px: float,
    q_anchors: dict,
    page_width: float,
) -> int | None:
    """y_px 위에서 같은 컬럼에 속하는 가장 가까운 문항 번호를 반환."""
    is_right = x_px >= page_width / 2
    nearest, nearest_dist = None, float("inf")
    for q_no, (qx, qy) in q_anchors.items():
        if (qx >= page_width / 2) != is_right:
            continue
        if qy <= y_px:
            dist = y_px - qy
            if dist < nearest_dist:
                nearest_dist = dist
                nearest = q_no
    return nearest


def _nearest_question_below(
    y_px: float,
    x_px: float,
    q_anchors: dict,
    page_width: float,
) -> int | None:
    """y_px 아래에서 같은 컬럼에 속하는 가장 가까운 문항 번호를 반환 (공통보기 이미지용)."""
    is_right = x_px >= page_width / 2
    nearest, nearest_dist = None, float("inf")
    for q_no, (qx, qy) in q_anchors.items():
        if (qx >= page_width / 2) != is_right:
            continue
        if qy >= y_px:
            dist = qy - y_px
            if dist < nearest_dist:
                nearest_dist = dist
                nearest = q_no
    return nearest


def attach_image_mappings(
    pdf_path: Path,
    structured_questions: list[dict],
    extracted_images: list[dict],
) -> tuple[list[dict], list[dict]]:
    """fitz 텍스트 좌표 기반 이미지-문항 매핑.

    PDF 텍스트 레이어에서 문항 번호와 선택지 마커(①②③④)의 픽셀 좌표를 읽어
    각 내장 이미지를 해당 문항/선택지에 결정론적으로 배정한다.
    Vision API를 사용하지 않아 속도가 빠르고 오배정이 없다.
    """
    if fitz is None:
        return structured_questions, []

    for q in structured_questions:
        q.setdefault("questionImageUrls", None)
        for c in q.get("choices", []):
            c.setdefault("imageUrls", None)

    CHOICE_CHARS = {"①": 1, "②": 2, "③": 3, "④": 4}
    mappings: list[dict] = []

    by_page_q: dict[int, list[dict]] = {}
    for q in structured_questions:
        by_page_q.setdefault(q.get("page", 1), []).append(q)

    doc = fitz.open(str(pdf_path))

    for page_idx in range(1, len(doc) + 1):
        qs = by_page_q.get(page_idx, [])
        raw_imgs = [im for im in extracted_images if im.get("page") == page_idx]
        if not qs or not raw_imgs:
            continue

        # 중복 이미지 제거 (같은 bbox가 두 번 참조되는 케이스)
        page_imgs: list[dict] = []
        for im in raw_imgs:
            bp = im.get("bbox_percent") or [0, 0, 0, 0]
            is_dup = any(
                abs(bp[1] - (ex.get("bbox_percent") or [0, 0, 0, 0])[1]) < 1.0
                and abs(bp[3] - (ex.get("bbox_percent") or [0, 0, 0, 0])[3]) < 1.0
                and abs(bp[0] - (ex.get("bbox_percent") or [0, 0, 0, 0])[0]) < 2.0
                for ex in page_imgs
            )
            if not is_dup:
                page_imgs.append(im)
        if not page_imgs:
            continue

        page = doc[page_idx - 1]
        pw, ph = page.rect.width, page.rect.height
        words = page.get_text("words")  # (x0, y0, x1, y1, word, block, line, word_no)

        q_numbers_on_page = {q["questionNumber"] for q in qs}
        q_map = {q["questionNumber"]: q for q in qs}

        # ── 1) 문항 번호 앵커 수집 (x, y 픽셀) ──
        q_anchors: dict[int, tuple[float, float]] = {}
        words_list = list(words)
        for i, wi in enumerate(words_list):
            x0, y0, x1, y1, word = wi[0], wi[1], wi[2], wi[3], wi[4]
            # "5." / "5)" 한 토큰
            m = re.match(r'^(\d{1,3})[.)]\s*$', word.strip())
            if m:
                n = int(m.group(1))
                if n in q_numbers_on_page and n not in q_anchors:
                    q_anchors[n] = (x0, y0)
                    continue
            # "5" + "." 두 토큰으로 분리된 경우
            if re.match(r'^\d{1,3}$', word.strip()) and i + 1 < len(words_list):
                nxt = words_list[i + 1][4].strip()
                if nxt in (".", ")"):
                    n = int(word.strip())
                    if n in q_numbers_on_page and n not in q_anchors:
                        q_anchors[n] = (x0, y0)

        sorted_q = sorted(q_anchors.keys())
        if not q_anchors:
            # 텍스트 레이어 없는 스캔형 PDF — 2컬럼 분리 후 순서대로 배정
            print(f"  [fitz-map] p{page_idx} 텍스트 레이어 없음 — 위치순 fallback")

            def _bp(im: dict) -> list:
                return im.get("bbox_percent") or [0, 0, 0, 0]

            def _sort_key(im: dict) -> tuple:
                b = _bp(im)
                return (round(b[1], 1), b[0])

            # 이미지를 왼쪽(x<50%) / 오른쪽(x≥50%) 컬럼으로 분리 후 y→x 정렬
            left_imgs = sorted([im for im in page_imgs if _bp(im)[0] < 50], key=_sort_key)
            right_imgs = sorted([im for im in page_imgs if _bp(im)[0] >= 50], key=_sort_key)

            def _needs_images(q: dict) -> bool:
                body = (q.get("questionText") or "").count("[그림]")
                ex = (q.get("exampleText") or "").count("[그림]")
                shared = (q.get("sharedExample") or "").count("[그림]") if not q.get("sharedExampleImageUrls") else 0
                ch = sum(1 for c in q.get("choices", []) if c.get("text") == "[그림]" and not c.get("imageUrls"))
                return body + ex + shared + ch > 0

            targets = sorted([q for q in qs if _needs_images(q)], key=lambda x: x["questionNumber"])
            n = len(targets)

            # 왼쪽 컬럼 이미지 배정 수 계산
            # 공통보기(※) 그룹은 여러 문항이 같은 이미지를 공유(dedup)하므로
            # 그룹 단위로 왼쪽 이미지를 배정한 후, 그룹에 속한 모든 문항을 left_targets에 포함
            if left_imgs and n > 0:
                # 이미지가 필요한 유니크 공통보기 텍스트를 등장 순서대로 수집
                seen_shared_ex: dict[str, int] = {}
                for t in targets:
                    s = t.get("sharedExample") or ""
                    if "[그림]" in s and not t.get("sharedExampleImageUrls") and s not in seen_shared_ex:
                        seen_shared_ex[s] = len(seen_shared_ex)

                # 왼쪽 이미지로 커버할 공통보기 그룹 수
                n_left_shared_groups = min(len(left_imgs), len(seen_shared_ex))
                left_shared_texts = set(list(seen_shared_ex.keys())[:n_left_shared_groups])

                # 해당 공통보기 그룹에 속한 모든 문항을 left_targets에 포함
                n_left = sum(1 for t in targets if (t.get("sharedExample") or "") in left_shared_texts)

                # 남은 왼쪽 이미지: dedup 반영한 유효 필요 수 == 전체 이미지 수일 때만 강제 배정
                # (이미지 여유분이 없는 경우만 강제 배정 — 공통보기 이미지 오배정 방지)
                remaining_left = len(left_imgs) - n_left_shared_groups
                if remaining_left > 0:
                    seen_sh: set[str] = set()
                    effective_needed = 0
                    for t in targets:
                        s = t.get("sharedExample") or ""
                        if "[그림]" in s and not t.get("sharedExampleImageUrls") and s not in seen_sh:
                            effective_needed += 1
                            seen_sh.add(s)
                        effective_needed += (t.get("questionText") or "").count("[그림]")
                        effective_needed += (t.get("exampleText") or "").count("[그림]")
                        effective_needed += sum(1 for c in t.get("choices", []) if c.get("text") == "[그림]" and not c.get("imageUrls"))
                    if effective_needed >= len(page_imgs):
                        non_shared = [t for t in targets if (t.get("sharedExample") or "") not in left_shared_texts]
                        n_left += min(remaining_left, len(non_shared))

                n_left = min(n_left, n)
            else:
                n_left = 0

            left_targets = targets[:n_left]
            right_targets = targets[n_left:]

            # 공통보기 이미지 중복 배정 방지: {sharedExample 텍스트: [image_paths]}
            assigned_shared: dict[str, list] = {}

            def _assign_group(group_imgs: list, group_qs: list) -> None:
                img_iter = iter(group_imgs)
                for tq in group_qs:
                    # ── sharedExample 이미지 (같은 ※ 텍스트는 URL 재사용) ──
                    shared_text = tq.get("sharedExample") or ""
                    if "[그림]" in shared_text and not tq.get("sharedExampleImageUrls"):
                        if shared_text in assigned_shared:
                            tq["sharedExampleImageUrls"] = assigned_shared[shared_text]
                        else:
                            im = next(img_iter, None)
                            if im is not None:
                                urls = [im["saved_path"]]
                                tq["sharedExampleImageUrls"] = urls
                                assigned_shared[shared_text] = urls
                                mappings.append({
                                    "page": page_idx,
                                    "image": im["saved_path"],
                                    "bbox_percent": im.get("bbox_percent"),
                                    "questionNumber": tq["questionNumber"],
                                    "mappedTo": "shared_example",
                                })
                                print(f"  [fallback] Q{tq['questionNumber']} ← {Path(im['saved_path']).name} (shared_example)")
                    # ── 본문/보기 이미지 ──
                    n_body = (
                        (tq.get("questionText") or "").count("[그림]")
                        + (tq.get("exampleText") or "").count("[그림]")
                    )
                    for _ in range(n_body):
                        im = next(img_iter, None)
                        if im is None:
                            break
                        tq["questionImageUrls"] = (tq.get("questionImageUrls") or []) + [im["saved_path"]]
                        mappings.append({
                            "page": page_idx,
                            "image": im["saved_path"],
                            "bbox_percent": im.get("bbox_percent"),
                            "questionNumber": tq["questionNumber"],
                            "mappedTo": "question",
                        })
                        print(f"  [fallback] Q{tq['questionNumber']} ← {Path(im['saved_path']).name} (body)")
                    # ── 선택지 이미지 ──
                    for c in sorted(tq.get("choices", []), key=lambda c: c.get("number", 0)):
                        if c.get("text") != "[그림]" or c.get("imageUrls"):
                            continue
                        im = next(img_iter, None)
                        if im is None:
                            break
                        c["imageUrls"] = [im["saved_path"]]
                        mappings.append({
                            "page": page_idx,
                            "image": im["saved_path"],
                            "bbox_percent": im.get("bbox_percent"),
                            "questionNumber": tq["questionNumber"],
                            "mappedTo": f"choice{c['number']}",
                        })
                        print(f"  [fallback] Q{tq['questionNumber']} ← {Path(im['saved_path']).name} (choice{c['number']})")

            _assign_group(left_imgs, left_targets)
            _assign_group(right_imgs, right_targets)

            # 배정되지 않은 잔여 이미지 → 공통보기 이미지
            # y-위치 × 컬럼으로 가장 가까운 문항 추론 (텍스트 앵커 없는 스캔형 PDF용)
            import math as _math
            assigned_imgs = {m["image"] for m in mappings if m["page"] == page_idx}
            all_qs_sorted = sorted(qs, key=lambda q: q["questionNumber"])
            n_qs = len(all_qs_sorted)
            n_left_qs = _math.ceil(n_qs / 2)
            left_col_qs = all_qs_sorted[:n_left_qs]   # 낮은 번호 → 왼쪽 컬럼
            right_col_qs = all_qs_sorted[n_left_qs:]  # 높은 번호 → 오른쪽 컬럼

            for im in page_imgs:
                if im["saved_path"] in assigned_imgs:
                    continue
                bp = im.get("bbox_percent") or [0, 0, 0, 0]
                is_right = bp[0] >= 50
                col_qs = right_col_qs if is_right else left_col_qs
                if not col_qs:
                    col_qs = all_qs_sorted
                y_frac = bp[1] / 100
                q_idx = min(int(y_frac * len(col_qs)), len(col_qs) - 1)
                primary_q = col_qs[q_idx]

                # ※ 범위가 파싱된 문항(sharedExample 있음) → 공통보기: 범위 내 전체 배정
                # ※ 없음 → 단독 보기: primary 문항 하나에만 questionImageUrls 배정
                se = primary_q.get("sharedExample") or ""
                r = _parse_shared_range(se) if se else None
                if r:
                    from_q, until_q = r
                    shared_targets = [q for q in all_qs_sorted if from_q <= q["questionNumber"] <= until_q]
                    mapped_to = "shared"
                    for tq in shared_targets:
                        tq["sharedExampleImageUrls"] = (tq.get("sharedExampleImageUrls") or []) + [im["saved_path"]]
                    ref_qno = primary_q["questionNumber"]
                    label = f"Q{from_q}~Q{until_q} ← {Path(im['saved_path']).name} (공통보기)"
                else:
                    # 단독 보기: questionImageUrls에 배정
                    mapped_to = "question"
                    primary_q["questionImageUrls"] = (primary_q.get("questionImageUrls") or []) + [im["saved_path"]]
                    ref_qno = primary_q["questionNumber"]
                    label = f"Q{ref_qno} ← {Path(im['saved_path']).name} (단독보기)"

                mappings.append({
                    "page": page_idx,
                    "image": im["saved_path"],
                    "bbox_percent": im.get("bbox_percent"),
                    "questionNumber": ref_qno,
                    "mappedTo": mapped_to,
                })
                print(f"  [fallback] {label}")
            continue

        # ── 2) 선택지 마커 앵커 수집 ──
        # 한 문항 안에서 처음 등장하는 ①만 선택지 시작 기준으로 사용
        choice_start_y: dict[int, float] = {}   # {q_no: ① 첫 등장 y}
        choice_marker_pos: dict[int, dict[int, tuple[float, float]]] = {}  # {q_no: {choice_no: (x,y)}}

        for wi in words_list:
            x0, y0, x1, y1, word = wi[0], wi[1], wi[2], wi[3], wi[4]
            ch = CHOICE_CHARS.get(word.strip())
            if ch is None:
                continue
            q_no = _nearest_question_above(y0, x0, q_anchors, pw)
            if q_no is None:
                continue
            # 다음 문항 번호의 y보다 위에 있어야 함 (다른 문항에 흘러들지 않도록)
            next_idx = sorted_q.index(q_no) + 1 if q_no in sorted_q else None
            if next_idx is not None and next_idx < len(sorted_q):
                next_q_y = q_anchors[sorted_q[next_idx]][1]
                if y0 >= next_q_y:
                    continue
            choice_marker_pos.setdefault(q_no, {})
            if ch not in choice_marker_pos[q_no]:
                choice_marker_pos[q_no][ch] = (x0, y0)
            if ch == 1 and q_no not in choice_start_y:
                choice_start_y[q_no] = y0

        # ── 2.5) 보기 박스 앵커 수집 ──
        example_y: dict[int, float] = {}  # {q_no: "보기" 텍스트 y}
        for wi in words_list:
            x0, y0, x1, y1, word = wi[0], wi[1], wi[2], wi[3], wi[4]
            if word.strip() == "보기":
                q_no_ex = _nearest_question_above(y0, x0, q_anchors, pw)
                if q_no_ex is None:
                    continue
                c_start_ex = choice_start_y.get(q_no_ex)
                if c_start_ex is not None and y0 >= c_start_ex:
                    continue
                if q_no_ex not in example_y:
                    example_y[q_no_ex] = y0

        # ── 3) 각 이미지를 문항/위치에 배정 ──
        for im in page_imgs:
            bp = im.get("bbox_percent") or [0, 0, 0, 0]
            img_top_px = bp[1] / 100 * ph
            img_left_px = bp[0] / 100 * pw

            q_no = _nearest_question_above(img_top_px, img_left_px, q_anchors, pw)
            is_shared = False
            if q_no is None or q_no not in q_map:
                # 공통보기 이미지: 문항보다 위에 있어 above가 None → below로 폴백
                q_no = _nearest_question_below(img_top_px, img_left_px, q_anchors, pw)
                if q_no is None or q_no not in q_map:
                    continue
                is_shared = True

            # 위치 결정: choice > example > body 순서로 판단
            position = "body"
            c_start = choice_start_y.get(q_no)
            if c_start is not None and img_top_px >= c_start - 4:
                markers = choice_marker_pos.get(q_no, {})
                if markers:
                    # 2x2 배치(같은 y에 2개) 여부 감지 후 셀 기반으로 선택지 결정
                    ys = sorted([pos[1] for pos in markers.values()])
                    is_2x2 = (
                        len(markers) >= 4
                        and abs(ys[0] - ys[1]) <= 18
                        and abs(ys[2] - ys[3]) <= 18
                        and (ys[2] - ys[1]) > 18
                    )
                    if is_2x2:
                        xs = [pos[0] for pos in markers.values()]
                        split_x = sum(xs) / len(xs)
                        split_y = (ys[1] + ys[2]) / 2
                        row_top = 1 if img_top_px < split_y else 2
                        col_left = 1 if img_left_px < split_x else 2
                        num = {(1, 1): 1, (1, 2): 2, (2, 1): 3, (2, 2): 4}.get((row_top, col_left))
                        if num in markers:
                            position = f"choice{num}"
                    else:
                        # 1열 배치 또는 마커 일부 누락: y거리 기준 fallback
                        nearest_ch = min(markers, key=lambda cn: abs(img_top_px - markers[cn][1]))
                        position = f"choice{nearest_ch}"
            else:
                ex_y = example_y.get(q_no)
                if ex_y is not None and img_top_px >= ex_y - 4:
                    position = "example"

            q = q_map[q_no]
            if is_shared:
                # 공통보기 이미지: 아래 첫 문항의 sharedExampleImageUrls에 배정
                # 같은 sharedExample 텍스트를 가진 다른 문항들도 함께 배정
                shared_text = q.get("sharedExample") or ""
                target_qs = (
                    [qq for qq in q_map.values() if qq.get("sharedExample") == shared_text and shared_text]
                    if shared_text else [q]
                )
                for tq in target_qs:
                    tq["sharedExampleImageUrls"] = (tq.get("sharedExampleImageUrls") or []) + [im["saved_path"]]
                position = "shared"
            elif position in ("body", "example"):
                q["questionImageUrls"] = (q.get("questionImageUrls") or []) + [im["saved_path"]]
            elif position.startswith("choice"):
                num = int(position[6:])
                c_map = {c["number"]: c for c in q.get("choices", [])}
                if num in c_map:
                    c = c_map[num]
                    if not c.get("text") or c["text"] == "[그림]":
                        existing = c.get("imageUrls")
                        c["imageUrls"] = (existing if isinstance(existing, list) else []) + [im["saved_path"]]

            mappings.append({
                "page": page_idx,
                "image": im["saved_path"],
                "bbox_percent": im.get("bbox_percent"),
                "questionNumber": q_no,
                "mappedTo": normalize_mapped_position(position),
            })
            print(f"  [fitz-map] Q{q_no} ← {Path(im['saved_path']).name} ({position})")

    doc.close()
    return structured_questions, mappings




def _html_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _render_md_for_review(text: str, out_dir: Path) -> str:
    """review.html용: ![alt](url) → <img>(로컬 파일) 또는 [이미지] 플레이스홀더."""
    result = []
    last = 0
    for m in _IMG_TAG_RE.finditer(text):
        result.append(_html_escape(text[last:m.start()]))
        url = m.group(2)
        # 로컬 파일 존재 여부 확인
        img_path = Path(url) if Path(url).is_absolute() else out_dir / url
        if img_path.exists():
            rel = _rel_path(str(img_path), out_dir)
            result.append(f'<img src="{rel}" style="max-width:100%;max-height:220px;display:block;margin:4px 0;border:1px solid #ddd;border-radius:4px;">')
        else:
            result.append('<span style="display:inline-block;padding:2px 8px;background:#f0f0f0;border-radius:4px;font-size:12px;color:#888">[이미지]</span>')
        last = m.end()
    result.append(_html_escape(text[last:]))
    return "".join(result)


def _rel_path(path: str | Path, out_dir: Path) -> str:
    try:
        return Path(path).relative_to(out_dir).as_posix()
    except ValueError:
        return str(path)


def generate_preview_html(
    structured_questions: list[dict],
    page_image_paths: list[Path],
    image_mappings: list[dict],
    out_dir: Path,
    answer_map: dict[int, list[int]] | None = None,
    title: str = "Preview",
) -> Path:
    from collections import defaultdict

    q_offset = 0
    if answer_map and structured_questions:
        pdf_min = min(q["questionNumber"] for q in structured_questions)
        csv_min = min(answer_map.keys())
        q_offset = pdf_min - csv_min  # 양방향: 1과목(0), 2과목(+35)

    imgs_by_page: dict[int, list[dict]] = defaultdict(list)
    for m in image_mappings:
        imgs_by_page[m["page"]].append(m)

    qs_by_page: dict[int, list[dict]] = defaultdict(list)
    for q in structured_questions:
        qs_by_page[q.get("page", 1)].append(q)

    palette = ["#e74c3c", "#3498db", "#27ae60", "#f39c12", "#9b59b6", "#1abc9c", "#7760f0", "#e67e22"]
    NUMS = "①②③④"

    def choice_label(n: int) -> str:
        return NUMS[n - 1] if 1 <= n <= 4 else str(n)

    page_blocks = []
    for i, img_path in enumerate(page_image_paths):
        page_num = i + 1
        rel = _rel_path(img_path, out_dir)

        bbox_divs = ""
        for j, m in enumerate(imgs_by_page.get(page_num, [])):
            bp = m.get("bbox_percent", [])
            if len(bp) < 4:
                continue
            x0, y0, x1, y1 = bp
            color = palette[j % len(palette)]
            label = f"Q{m.get('questionNumber','?')} {m.get('mappedTo','')}"
            bbox_divs += (
                f'<div class="bbox" style="left:{x0:.2f}%;top:{y0:.2f}%;'
                f'width:{x1-x0:.2f}%;height:{y1-y0:.2f}%;border-color:{color}">'
                f'<span class="bbox-label" style="background:{color}">{label}</span></div>'
            )

        q_cards = ""
        for q in sorted(qs_by_page.get(page_num, []), key=lambda x: x["questionNumber"]):
            q_no = q["questionNumber"]
            correct = set(answer_map.get(q_no - q_offset, [])) if answer_map else set()
            choices = q.get("choices") or []
            q_imgs = q.get("questionImageUrls") or []
            has_warn = (
                len(choices) not in (0, 4)
                or q.get("needsNonTextRecovery")
                or (answer_map is not None and not correct)
            )
            badge = (
                '<span class="badge badge-warn">!</span>'
                if has_warn
                else '<span class="badge badge-ok">✓</span>'
            )
            ans_label = ""
            if correct:
                ans_txt = ", ".join(choice_label(a) for a in sorted(correct))
                ans_label = f'<span class="badge" style="background:#555;margin-left:auto">정답 {ans_txt}</span>'

            shared_html = ""
            if q.get("sharedExample") or q.get("sharedExampleImageUrls"):
                shared_imgs_html = ""
                for p in (q.get("sharedExampleImageUrls") or []):
                    shared_imgs_html += f'<img src="{_rel_path(p, out_dir)}" class="qimg" style="max-height:160px;max-width:280px;display:block;margin-top:4px;">'
                shared_html = (
                    f'<div class="shared-box">'
                    f'{_html_escape(q.get("sharedExample") or "")}'
                    f'{shared_imgs_html}'
                    f'</div>'
                )

            body_imgs_html = ""
            if q_imgs:
                imgs = "".join(
                    f'<img src="{_rel_path(p, out_dir)}" class="qimg" style="max-height:120px;max-width:200px;">'
                    for p in q_imgs
                )
                body_imgs_html = f'<div class="img-group"><div class="img-role">본문 이미지</div><div class="img-row">{imgs}</div></div>'

            qtext_html = ""
            if q.get("questionText"):
                qtext_html = f'<div class="qtext">{_html_escape(q["questionText"])}</div>'

            choices_html = ""
            c_img_choices = [c for c in choices if c.get("imageUrls")]
            if c_img_choices:
                items = []
                for c in c_img_choices:
                    num = c.get("number", 0)
                    is_correct = num in correct
                    lbl = choice_label(num)
                    imgs = "".join(
                        f'<img src="{_rel_path(p, out_dir)}" class="qimg" style="max-height:80px;max-width:120px;">'
                        for p in (c.get("imageUrls") or [])
                    )
                    border = "border:2px solid #27ae60;" if is_correct else "border:2px solid transparent;"
                    items.append(
                        f'<div class="cimg-wrap" style="{border}padding:4px;border-radius:4px">'
                        f'<div class="cimg-label">{lbl}</div>{imgs}</div>'
                    )
                choices_html = (
                    f'<div class="img-group"><div class="img-role">선택지 (이미지)</div>'
                    f'<div class="choice-row">{"".join(items)}</div></div>'
                )

            q_cards += (
                f'<div class="qcard">'
                f'<div class="qcard-hd"><span>Q{q_no}</span>{badge}{ans_label}</div>'
                f'<div class="qcard-body">{shared_html}{body_imgs_html}{qtext_html}{choices_html}</div>'
                f'</div>'
            )

        page_blocks.append(
            f'<div class="sec"><h2>Page {page_num}</h2>'
            f'<div class="page-row">'
            f'<div><h3>원본 페이지</h3>'
            f'<div class="page-img-wrap">'
            f'<img src="{rel}" style="width:680px;display:block">'
            f'{bbox_divs}</div></div>'
            f'<div class="qcol"><h3>파싱 결과</h3>{q_cards}</div>'
            f'</div></div>'
        )

    css = """*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;padding:20px}
h1{font-size:20px;margin-bottom:16px;color:#2c3e50}
h2{font-size:15px;color:#2c3e50;margin-bottom:12px}
h3{font-size:12px;color:#555;margin-bottom:6px;font-weight:600}
.sec{background:white;border-radius:10px;padding:18px;margin-bottom:24px;box-shadow:0 1px 4px rgba(0,0,0,.1)}
.page-row{display:flex;gap:20px;align-items:flex-start}
.page-img-wrap{position:relative;display:inline-block;flex:0 0 auto}
.bbox{position:absolute;border:2px solid;pointer-events:none}
.bbox-label{position:absolute;top:-1px;left:-1px;font-size:9px;color:white;padding:1px 4px;border-radius:2px;white-space:nowrap;font-weight:700}
.qcol{flex:1;overflow-y:auto;max-height:1200px}
.qcard{border:1px solid #e0e0e0;border-radius:6px;margin-bottom:10px;overflow:hidden}
.qcard-hd{background:#2c3e50;color:white;padding:6px 12px;font-size:13px;font-weight:600;display:flex;gap:8px;align-items:center}
.badge{font-size:10px;padding:1px 6px;border-radius:3px;font-weight:700}
.badge-ok{background:#27ae60}.badge-warn{background:#e74c3c}
.qcard-body{padding:10px 12px}
.shared-box{background:#fff8e0;border-left:3px solid #f90;padding:4px 8px;margin-bottom:6px;font-size:11px;color:#555}
.img-group{margin-bottom:8px}
.img-role{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px}
.img-row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end}
.qimg{border:1px solid #ddd;border-radius:3px}
.cimg-wrap{text-align:center}
.cimg-label{font-size:14px;font-weight:700;color:#2c3e50;margin-bottom:2px}
.qtext{font-size:11px;color:#333;margin-bottom:6px;line-height:1.5}
.choice-row{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end}
.choice-txt{font-size:11px;color:#333;padding:2px 0}"""

    html = (
        f'<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">'
        f'<title>Preview — {_html_escape(title)}</title>'
        f'<style>{css}</style></head>'
        f'<body><h1>Image Preview — {_html_escape(title)}</h1>'
        f'{"".join(page_blocks)}'
        f'</body></html>'
    )

    preview_path = out_dir / "preview.html"
    preview_path.write_text(html, encoding="utf-8")
    return preview_path


def generate_review_html(
    structured_questions: list[dict],
    out_dir: Path,
    title: str = "Review",
) -> Path:
    """검수용 인터랙티브 HTML — 인라인 편집 후 JSON 다운로드 가능."""
    import json as _json

    _EMPTY_EX = '<em style="color:#aaa">없음</em>'
    qs_json = _json.dumps(structured_questions, ensure_ascii=False, indent=2)

    cards = []
    for q in structured_questions:
        qn = q["questionNumber"]
        qt = _render_md_for_review(q.get("questionText") or "", out_dir)
        ex = _render_md_for_review(q.get("exampleText") or "", out_dir)
        se = _render_md_for_review(q.get("sharedExample") or "", out_dir)

        imgs_html = ""
        for url in (q.get("questionImageUrls") or []):
            imgs_html += f'<img src="{_rel_path(url, out_dir)}" style="max-width:100%;max-height:200px;display:block;margin:4px 0;border:1px solid #ddd;border-radius:4px;">'
        se_imgs_html = ""
        for url in (q.get("sharedExampleImageUrls") or []):
            se_imgs_html += f'<img src="{_rel_path(url, out_dir)}" style="max-width:100%;max-height:200px;display:block;margin:4px 0;">'

        choices_html = ""
        for c in (q.get("choices") or []):
            num = c["number"]
            mark = "①②③④"[num - 1] if 1 <= num <= 4 else str(num)
            ct = _html_escape(c.get("text") or "")
            c_imgs = "".join(
                f'<img src="{_rel_path(u, out_dir)}" style="max-height:80px;display:inline-block;margin:2px;">'
                for u in (c.get("imageUrls") or [])
            )
            choices_html += (
                f'<div class="choice" data-qn="{qn}" data-cn="{num}">'
                f'<span class="choice-mark">{mark}</span>'
                f'<span class="editable choice-text" contenteditable="true" data-field="choiceText" data-qn="{qn}" data-cn="{num}">{ct}</span>'
                f'{c_imgs}'
                f'</div>'
            )

        warn = q.get("needsNonTextRecovery")
        warn_badge = '<span class="badge warn">검수필요</span>' if warn else '<span class="badge ok">OK</span>'

        shared_section = ""
        if se or se_imgs_html:
            shared_section = (
                f'<div class="section-label">공통보기</div>'
                f'<div class="field shared-box">{se}{se_imgs_html}</div>'
            )

        ex_imgs_html = "".join(
            f'<img src="{_rel_path(u, out_dir)}" style="max-width:100%;max-height:220px;display:block;margin:4px 0;border:1px solid #ddd;border-radius:4px;">'
            for u in (q.get("exampleImageUrls") or [])
        )
        ex_section = (
            f'<div class="section-label">보기 <button class="btn-small" onclick="clearExample({qn})">지우기</button></div>'
            f'<div class="editable field ex-box" contenteditable="true" data-field="exampleText" data-qn="{qn}">{ex or _EMPTY_EX}</div>'
            f'{ex_imgs_html}'
        )

        cards.append(
            f'<div class="card" id="q{qn}">'
            f'<div class="card-header">'
            f'  <span class="qnum">Q{qn}</span>{warn_badge}'
            f'  <button class="btn-small" style="margin-left:auto" onclick="splitExample({qn})">선택→보기</button>'
            f'</div>'
            f'{shared_section}'
            f'<div class="section-label">문제</div>'
            f'<div class="editable field" contenteditable="true" data-field="questionText" data-qn="{qn}">{qt}</div>'
            f'{imgs_html}'
            f'{ex_section}'
            f'<div class="section-label">선택지</div>'
            f'{choices_html}'
            f'</div>'
        )

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>검수 — {_html_escape(title)}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Apple SD Gothic Neo', sans-serif; font-size: 14px; background: #f5f5f5; color: #222; }}
  .toolbar {{ position: sticky; top: 0; z-index: 100; background: #2c3e50; color: #fff; padding: 10px 16px; display: flex; align-items: center; gap: 10px; }}
  .toolbar h1 {{ font-size: 15px; font-weight: 600; flex: 1; }}
  .toolbar button {{ background: #27ae60; color: #fff; border: none; padding: 7px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; }}
  .toolbar button:hover {{ background: #1e8449; }}
  .container {{ max-width: 820px; margin: 0 auto; padding: 16px; }}
  .card {{ background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.12); margin-bottom: 14px; overflow: hidden; }}
  .card-header {{ display: flex; align-items: center; gap: 8px; padding: 8px 14px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; }}
  .qnum {{ font-weight: 700; font-size: 15px; color: #2c3e50; }}
  .badge {{ font-size: 11px; padding: 2px 7px; border-radius: 10px; font-weight: 600; }}
  .badge.ok {{ background: #d4edda; color: #155724; }}
  .badge.warn {{ background: #fff3cd; color: #856404; }}
  .section-label {{ font-size: 11px; font-weight: 600; color: #888; padding: 6px 14px 2px; text-transform: uppercase; letter-spacing: .5px; }}
  .field {{ padding: 8px 14px; min-height: 32px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }}
  .editable {{ outline: none; border-radius: 4px; transition: background .15s; }}
  .editable:focus {{ background: #fffbe6; box-shadow: inset 0 0 0 2px #f39c12; }}
  .ex-box {{ background: #fef9e7; border-left: 3px solid #f39c12; font-family: monospace; font-size: 13px; }}
  .shared-box {{ background: #eaf4fb; border-left: 3px solid #3498db; font-size: 13px; }}
  .choice {{ display: flex; align-items: flex-start; gap: 8px; padding: 5px 14px; border-top: 1px solid #f0f0f0; }}
  .choice-mark {{ font-weight: 700; color: #3498db; min-width: 18px; margin-top: 2px; }}
  .choice-text {{ flex: 1; }}
  .btn-small {{ font-size: 11px; padding: 2px 8px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer; background: #fff; color: #555; }}
  .btn-small:hover {{ background: #f0f0f0; }}
  .modified {{ background: #fffbe6 !important; }}
</style>
</head>
<body>
<div class="toolbar">
  <h1>검수 — {_html_escape(title)}</h1>
  <span id="change-count" style="font-size:12px;opacity:.8"></span>
  <button onclick="saveJSON()">💾 JSON 저장</button>
</div>
<div class="container">
{"".join(cards)}
</div>
<script>
const DATA = {qs_json};
const changes = {{}};

function qIdx(qn) {{ return DATA.findIndex(q => q.questionNumber === qn); }}

document.querySelectorAll('.editable').forEach(el => {{
  el.addEventListener('input', () => {{
    const qn = +el.dataset.qn;
    const field = el.dataset.field;
    const cn = el.dataset.cn ? +el.dataset.cn : null;
    const text = el.innerText.trim();
    const idx = qIdx(qn);
    if (idx === -1) return;
    if (field === 'questionText') {{ DATA[idx].questionText = text; }}
    else if (field === 'exampleText') {{ DATA[idx].exampleText = text || null; }}
    else if (field === 'choiceText' && cn) {{
      const c = DATA[idx].choices.find(c => c.number === cn);
      if (c) c.text = text;
    }}
    el.closest('.card').classList.add('modified');
    changes[qn] = true;
    document.getElementById('change-count').textContent = `수정 ${{Object.keys(changes).length}}건`;
  }});
}});

function clearExample(qn) {{
  const idx = qIdx(qn);
  if (idx === -1) return;
  DATA[idx].exampleText = null;
  const el = document.querySelector(`[data-field="exampleText"][data-qn="${{qn}}"]`);
  if (el) el.innerHTML = '<em style="color:#aaa">없음</em>';
  changes[qn] = true;
  document.getElementById('change-count').textContent = `수정 ${{Object.keys(changes).length}}건`;
}}

function splitExample(qn) {{
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) {{ alert('문제 텍스트에서 보기로 옮길 부분을 드래그로 선택하세요.'); return; }}
  const qtEl = document.querySelector(`[data-field="questionText"][data-qn="${{qn}}"]`);
  if (!qtEl || !qtEl.contains(sel.anchorNode)) {{ alert('문제 텍스트 안에서 선택해주세요.'); return; }}
  const selected = sel.toString().trim();
  if (!selected) return;
  const idx = qIdx(qn);
  const qt = DATA[idx].questionText || '';
  const splitPos = qt.indexOf(selected);
  if (splitPos === -1) {{ alert('선택한 텍스트를 찾을 수 없습니다.'); return; }}
  const newQt = qt.slice(0, splitPos).trimEnd();
  const newEx = qt.slice(splitPos).trim();
  DATA[idx].questionText = newQt;
  DATA[idx].exampleText = (DATA[idx].exampleText ? DATA[idx].exampleText + '\\n' : '') + newEx;
  qtEl.innerText = newQt;
  const exEl = document.querySelector(`[data-field="exampleText"][data-qn="${{qn}}"]`);
  if (exEl) exEl.innerText = DATA[idx].exampleText;
  sel.removeAllRanges();
  changes[qn] = true;
  document.getElementById('change-count').textContent = `수정 ${{Object.keys(changes).length}}건`;
}}

function saveJSON() {{
  const blob = new Blob([JSON.stringify(DATA, null, 2)], {{type: 'application/json'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'structured-questions.json';
  a.click();
  document.querySelectorAll('.card.modified').forEach(c => c.classList.remove('modified'));
  changes[Symbol()] = null;  // reset display
  document.getElementById('change-count').textContent = '저장됨';
}}
</script>
</body>
</html>"""

    review_path = out_dir / "review.html"
    review_path.write_text(html, encoding="utf-8")
    return review_path


def _render_choice(choice: dict, out_dir: Path) -> str:
    text = choice.get("text", "")
    if text == "[그림]":
        img_urls = choice.get("imageUrls")
        if img_urls:
            imgs_html = []
            for p in img_urls:
                try:
                    rel = Path(p).relative_to(out_dir).as_posix()
                    imgs_html.append(f'<img src="{rel}" style="max-width:100px;max-height:100px;display:block;margin-top:4px;border:1px solid #ddd;">')
                except Exception:
                    pass
            if imgs_html:
                return "".join(imgs_html)
        return '<span style="background:#e67e22;color:white;padding:1px 6px;border-radius:4px;font-size:11px;">그림(텍스트 아님)</span>'
    return _html_escape(text)

def _replace_placeholder_with_images(text: str, image_urls: list[str], out_dir: Path) -> str:
    if not text:
        return ""
    escaped = _html_escape(text)
    if not image_urls:
        return escaped
    
    for p in image_urls:
        try:
            rel = Path(p).relative_to(out_dir).as_posix()
            img_html = f'<br><img src="{rel}" style="max-width:100%;max-height:150px;border:1px solid #ddd;border-radius:4px;margin:6px 0;"><br>'
            if "[그림]" in escaped:
                escaped = escaped.replace("[그림]", img_html, 1)
            else:
                escaped += img_html
        except Exception:
            pass
    return escaped

def _render_embedded_images(report: dict, out_dir: Path) -> str:
    images = report.get("extracted_images", []) or []
    if not images:
        return "<p style='font-size:12px;color:#999;'>(images 폴더에 저장된 이미지 없음)</p>"

    cards = []
    for img in images:
        saved_path = img.get("saved_path")
        if not saved_path:
            continue
        try:
            rel = Path(saved_path).relative_to(out_dir).as_posix()
        except Exception:
            continue
        page = img.get("page", "?")
        idx = img.get("index", "?")
        cards.append(
            f"""<div style="border:1px solid #eee;border-radius:6px;padding:6px;background:#fff;">
  <img src="{rel}" style="max-width:100%;max-height:140px;display:block;margin:0 auto 6px auto;">
  <div style="font-size:11px;color:#666;">p{page} img{idx}</div>
</div>"""
        )

    return (
        "<div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;'>"
        + "".join(cards)
        + "</div>"
    )


def _render_image_mappings(report: dict, out_dir: Path) -> str:
    rows = report.get("image_mappings", []) or []
    if not rows:
        return "<p style='font-size:12px;color:#999;'>(매핑 결과 없음)</p>"
    trows = []
    for r in rows:
        rel = ""
        try:
            rel = Path(r.get("image", "")).relative_to(out_dir).as_posix()
        except Exception:
            rel = ""
        thumb = f"<img src='{rel}' style='max-width:110px;max-height:70px;border:1px solid #ddd;'>" if rel else "-"
        trows.append(
            f"<tr>"
            f"<td style='padding:6px;border-bottom:1px solid #f0f0f0;'>{r.get('page')}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #f0f0f0;'>{r.get('questionNumber')}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #f0f0f0;'>{_html_escape(str(r.get('mappedTo')))}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #f0f0f0;font-size:11px;'>{_html_escape(str(r.get('bbox_percent')))}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #f0f0f0;'>{thumb}</td>"
            f"</tr>"
        )
    return (
        "<table style='width:100%;border-collapse:collapse;'>"
        "<thead><tr style='background:#f5f5f5;'>"
        "<th style='padding:6px;text-align:left;'>Page</th>"
        "<th style='padding:6px;text-align:left;'>Q</th>"
        "<th style='padding:6px;text-align:left;'>Mapped</th>"
        "<th style='padding:6px;text-align:left;'>BBox %</th>"
        "<th style='padding:6px;text-align:left;'>Image</th>"
        "</tr></thead><tbody>"
        + "".join(trows)
        + "</tbody></table>"
    )


def _render_structured_questions(
    questions: list[dict],
    page_image_paths: list[Path],
    out_dir: Path,
    answer_map: dict[int, list[int]] | None = None,
) -> str:
    if not questions:
        return "<p style='color:#999;font-size:13px;'>(구조화 결과 없음)</p>"
    q_offset = 0
    if answer_map and questions:
        pdf_min = min(q["questionNumber"] for q in questions)
        csv_min = min(answer_map.keys())
        q_offset = pdf_min - csv_min  # 양방향: 1과목(0), 2과목(+35)

    rows = []
    for q in questions:
        needs_recovery = q.get("needsNonTextRecovery", False)
        row_bg = "background:#fff8e1;" if needs_recovery else ""
        choices = q.get("choices", [])
        correct = set(answer_map.get(q["questionNumber"] - q_offset, [])) if answer_map else set()

        def _choice_cell(c: dict) -> str:
            num = c.get("number", 0)
            is_correct = num in correct
            bg = "background:#d4edda;" if is_correct else ""
            mark = " ✓" if is_correct else ""
            return (
                f"<td style='padding:6px 8px;font-size:12px;border-bottom:1px solid #f0f0f0;"
                f"vertical-align:top;{bg}'>{_render_choice(c, out_dir)}"
                f"<span style='color:#27ae60;font-weight:700;'>{mark}</span></td>"
            )

        choice_cells = "".join(_choice_cell(c) for c in choices)
        for _ in range(4 - len(choices)):
            choice_cells += "<td style='padding:6px 8px;font-size:12px;border-bottom:1px solid #f0f0f0;color:#ccc;'>-</td>"

        # 보기(exampleText) — [그림] 포함 시 실제 페이지 이미지도 표시
        example_cell = ""
        q_img_urls = q.get("questionImageUrls") or []
        q_text = q.get("questionText") or ""
        ex_text = q.get("exampleText") or ""

        # questionText의 [그림] 개수만큼 앞의 이미지를 할당, 나머지는 exampleText용
        q_figure_count = q_text.count("[그림]")
        q_text_html = _replace_placeholder_with_images(q_text, q_img_urls[:q_figure_count], out_dir)

        if ex_text:
            ex_text_html = _replace_placeholder_with_images(ex_text, q_img_urls[q_figure_count:], out_dir)
            example_cell = f"<div style='margin-top:4px;padding:4px 6px;background:#f0f0f0;border-left:3px solid #aaa;font-size:11px;'>{ex_text_html}</div>"

        # [그림] 있는 문항 → 해당 페이지 렌더링을 인라인으로 표시
        page_preview = ""
        if needs_recovery:
            page_num = q.get("page", 1)
            idx = page_num - 1
            if idx < len(page_image_paths):
                rel = page_image_paths[idx].relative_to(out_dir).as_posix()
                page_preview = f"""<details style="margin-top:6px;">
  <summary style="cursor:pointer;font-size:11px;color:#e67e22;font-weight:600;">📄 페이지 {page_num} 원본 보기</summary>
  <div style="margin-top:6px;">
    <a href="#{f'p{page_num}'}" style="font-size:11px;color:#3498db;">↓ 페이지 섹션으로 이동</a><br>
    <img src="{rel}" style="max-width:100%;max-height:400px;border:1px solid #ddd;border-radius:4px;margin-top:4px;">
  </div>
</details>"""

        recovery_badge = ""
        if needs_recovery:
            reason = q.get("recoveryReason", "")
            recovery_badge = f'<span style="background:#e67e22;color:white;padding:1px 5px;border-radius:3px;font-size:10px;margin-left:4px;">{_html_escape(reason)}</span>'

        rows.append(f"""<tr style="{row_bg}">
  <td style="padding:6px 8px;font-size:13px;font-weight:700;border-bottom:1px solid #f0f0f0;vertical-align:top;white-space:nowrap;">{q['questionNumber']}{recovery_badge}</td>
  <td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
    {q_text_html}
    {example_cell}
    {page_preview}
  </td>
  {choice_cells}
</tr>""")

    return f"""<table style="width:100%;border-collapse:collapse;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="padding:6px 8px;font-size:11px;text-align:left;width:60px;">번호</th>
      <th style="padding:6px 8px;font-size:11px;text-align:left;">문항 / 보기</th>
      <th style="padding:6px 8px;font-size:11px;text-align:left;width:120px;">①</th>
      <th style="padding:6px 8px;font-size:11px;text-align:left;width:120px;">②</th>
      <th style="padding:6px 8px;font-size:11px;text-align:left;width:120px;">③</th>
      <th style="padding:6px 8px;font-size:11px;text-align:left;width:120px;">④</th>
    </tr>
  </thead>
  <tbody>{''.join(rows)}</tbody>
</table>"""


def generate_html_report(
    report: dict,
    page_texts: list[str],
    page_ocr_texts: list[str],
    page_image_paths: list[Path],
    structured_questions: list[dict],
    out_dir: Path,
    answer_map: dict[int, list[int]] | None = None,
) -> Path:
    page_sections = []
    for i in range(report["page_count"]):
        page_num = i + 1
        summary = report["page_summaries"][i] if i < len(report["page_summaries"]) else {}
        text = page_texts[i] if i < len(page_texts) else ""
        ocr_text = page_ocr_texts[i] if i < len(page_ocr_texts) else ""
        page_embedded = [
            im for im in (report.get("extracted_images", []) or []) if im.get("page") == page_num
        ]

        if i < len(page_image_paths):
            rel = page_image_paths[i].relative_to(out_dir).as_posix()
            img_tag = f'<img src="{rel}" style="max-width:100%;border:1px solid #ddd;border-radius:4px;">'
        else:
            img_tag = '<div style="background:#eee;padding:40px;text-align:center;color:#999;">pymupdf 미설치 — 렌더링 불가</div>'

        embedded_gallery = ""
        if page_embedded:
            cards = []
            for im in page_embedded:
                try:
                    rel_im = Path(im.get("saved_path", "")).relative_to(out_dir).as_posix()
                except Exception:
                    continue
                cards.append(
                    f"""<div style="border:1px solid #eee;border-radius:4px;padding:4px;background:#fff;">
  <img src="{rel_im}" style="max-width:100%;max-height:80px;display:block;margin:0 auto 4px auto;">
  <div style="font-size:10px;color:#777;">img{im.get('index','?')}</div>
</div>"""
                )
            if cards:
                embedded_gallery = (
                    "<div class='col-label' style='margin-top:12px;'>추출 이미지 (이 페이지)</div>"
                    "<div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;'>"
                    + "".join(cards)
                    + "</div>"
                )
        else:
            embedded_gallery = (
                "<div class='col-label' style='margin-top:12px;'>추출 이미지 (이 페이지)</div>"
                "<div style='font-size:11px;color:#999;'>(없음)</div>"
            )

        page_sections.append(f"""
<div class="page-block" id="p{page_num}">
  <div class="page-header">
    Page {page_num}
    <span style="font-weight:normal;font-size:13px;margin-left:12px;opacity:.8;">
      텍스트 {summary.get('text_chars', 0)}자 &nbsp;|&nbsp; 내장 이미지 {summary.get('image_count', 0)}개
    </span>
  </div>
  <div class="page-body">
    <div class="col-render">
      <div class="col-label">렌더링 (벡터 도형 포함)</div>
      {img_tag}
    </div>
    <div class="col-text">
      <div class="col-label">텍스트 레이어 (pypdf)</div>
      <pre>{_html_escape(text) or "(텍스트 레이어 없음)"}</pre>
      <div class="col-label" style="margin-top:12px;">OCR 원문</div>
      <pre>{_html_escape(ocr_text) or "(OCR 결과 없음)"}</pre>
      {embedded_gallery}
    </div>
  </div>
</div>""")

    blocker_html = ""
    if report.get("blockers"):
        items = "".join(f"<li>{_html_escape(b)}</li>" for b in report["blockers"])
        blocker_html = f'<div class="blockers"><strong>⚠ Blockers</strong><ul>{items}</ul></div>'

    text_qnums = ", ".join(str(n) for n in report.get("text_layer_question_numbers", [])) or "(없음)"
    ocr_qnums = ", ".join(str(n) for n in report.get("ocr_question_numbers", [])) or "(없음)"

    def badge(ok: bool, yes_label: str = "Yes", no_label: str = "No") -> str:
        cls = "badge-ok" if ok else "badge-warn"
        label = yes_label if ok else no_label
        return f'<span class="badge {cls}">{label}</span>'

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>PDF Validate — {_html_escape(Path(report.get('pdf_path', '')).name)}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0;}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;padding:16px;}}
.wrap{{max-width:1440px;margin:0 auto;}}
h1{{font-size:20px;margin-bottom:12px;}}
.summary{{background:white;border-radius:8px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);}}
.summary table{{width:100%;border-collapse:collapse;}}
.summary td{{padding:5px 8px;font-size:13px;border-bottom:1px solid #f0f0f0;}}
.summary td:first-child{{font-weight:600;color:#555;width:200px;}}
.badge{{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;}}
.badge-ok{{background:#27ae60;color:white;}}
.badge-warn{{background:#e67e22;color:white;}}
.blockers{{background:#e74c3c;color:white;padding:12px 16px;border-radius:8px;margin-bottom:12px;}}
.blockers ul{{margin:6px 0 0 16px;font-size:13px;}}
.page-block{{background:white;border-radius:8px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);}}
.page-header{{background:#2c3e50;color:white;padding:10px 16px;font-size:15px;font-weight:700;}}
.page-body{{display:grid;grid-template-columns:1fr 1fr;gap:0;}}
.col-render{{padding:12px;border-right:1px solid #eee;}}
.col-text{{padding:12px;}}
.col-label{{font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;}}
pre{{background:#f8f9fa;padding:10px;border-radius:4px;font-size:12px;line-height:1.5;overflow-y:auto;max-height:500px;white-space:pre-wrap;word-break:break-all;}}
@media(max-width:900px){{.page-body{{grid-template-columns:1fr;}}}}
</style>
</head>
<body>
<div class="wrap">
  <h1>PDF Validate Report</h1>
  <div class="summary">
    <table>
      <tr><td>파일</td><td>{_html_escape(report.get('pdf_path', ''))}</td></tr>
      <tr><td>생성 시각</td><td>{report.get('generated_at', '')}</td></tr>
      <tr><td>페이지 수</td><td>{report.get('page_count', 0)}</td></tr>
      <tr><td>전체 텍스트 문자</td><td>{report.get('total_text_chars', 0)}</td></tr>
      <tr><td>스캔형 PDF 판정</td><td>{badge(not report.get('is_scanned_like'), '아니오 (텍스트 레이어 있음)', '예 (스캔형)')}</td></tr>
      <tr><td>페이지 렌더링 (pymupdf)</td><td>{badge(report.get('pymupdf_available', False), '활성화', '미설치 — pip install pymupdf')}</td></tr>
      <tr><td>OCR 활성화</td><td>{badge(report.get('ocr_enabled', False))}</td></tr>
      <tr><td>OCR 프로바이더</td><td>{_html_escape(str(report.get('ocr_provider', '')))}</td></tr>
      <tr><td>내장 이미지 수</td><td>{report.get('image_count_total', 0)} (벡터 도형은 렌더링으로만 확인)</td></tr>
      <tr><td>문항 번호 (텍스트 레이어)</td><td>{_html_escape(text_qnums)}</td></tr>
      <tr><td>문항 번호 (OCR)</td><td>{_html_escape(ocr_qnums)}</td></tr>
    </table>
  </div>
  {blocker_html}

  <div class="summary" style="margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <strong style="font-size:14px;">구조화된 문항 ({len(structured_questions)}개)</strong>
      <span style="font-size:12px;color:#888;">주황색 = 그림/도형 선택지 &nbsp;|&nbsp; 노란 행 = 복구 필요</span>
    </div>
    {_render_structured_questions(structured_questions, page_image_paths, out_dir, answer_map)}
  </div>

  <div class="summary" style="margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <strong style="font-size:14px;">images 폴더 추출 이미지</strong>
      <span style="font-size:12px;color:#888;">PDF 내장 이미지 원본</span>
    </div>
    {_render_embedded_images(report, out_dir)}
  </div>

  <div class="summary" style="margin-bottom:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <strong style="font-size:14px;">문항/선택지 이미지 매핑 결과</strong>
      <span style="font-size:12px;color:#888;">AI 앵커 + bbox 휴리스틱</span>
    </div>
    {_render_image_mappings(report, out_dir)}
  </div>

  {''.join(page_sections)}
</div>
</body>
</html>"""

    html_path = out_dir / "report.html"
    html_path.write_text(html, encoding="utf-8")
    return html_path


def _strip_pua(s: str) -> str:
    """PDF 커스텀 폰트 인코딩으로 인한 PUA 유니코드 문자(U+E000~U+F8FF)를 제거."""
    cleaned = re.sub(r"[\uE000-\uF8FF]+", "", s).strip()
    return cleaned if cleaned else "(인코딩 불명 텍스트)"


def normalize_mapped_position(pos: str | None) -> str | None:
    if not pos:
        return pos
    if pos == "body":
        return "question"
    return pos


def _is_pipe_table_row(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped) and stripped.count("|") >= 2 and " | " in stripped


def convert_pipe_tables_to_markdown(s: str) -> str:
    """줄바꿈이 보존된 파이프 테이블 행을 마크다운 테이블로 변환 (헤더 구분선 삽입)."""
    lines = s.split("\n")
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if _is_pipe_table_row(line):
            table_rows = []
            while i < len(lines) and _is_pipe_table_row(lines[i]):
                cells = [c.strip() for c in lines[i].split("|")]
                if cells and not cells[0]:
                    cells = cells[1:]
                if cells and not cells[-1]:
                    cells = cells[:-1]
                table_rows.append(cells)
                i += 1
            n_cols = max(len(r) for r in table_rows)
            result.append("| " + " | ".join(table_rows[0]) + " |")
            result.append("|" + "|".join(["---"] * n_cols) + "|")
            for row in table_rows[1:]:
                result.append("| " + " | ".join(row) + " |")
        else:
            result.append(line)
            i += 1
    return "\n".join(result)


def normalize_ws(s: str) -> str:
    """공백을 정규화하되, 파이프 테이블 행 사이의 줄바꿈은 보존."""
    lines = (s or "").strip().split("\n")
    processed = [re.sub(r"[ \t]+", " ", line).strip() for line in lines]
    processed = [l for l in processed if l]

    parts = []
    for line in processed:
        if not parts:
            parts.append(line)
        elif _is_pipe_table_row(line) or _is_pipe_table_row(parts[-1]):
            parts.append("\n" + line)
        elif line.startswith("·") or line.startswith("•"):
            parts.append("\n" + line)
        else:
            parts.append(" " + line)
    return "".join(parts)


def split_question_blocks(text: str):
    """각 문항 블록을 (question_number, body, shared_note) 튜플로 반환.

    shared_note: 블록 말미의 ※ 공통 설명 — 다음 문항들의 sharedExample로 사용.
    """
    matches = list(QUESTION_SPLIT_PATTERN.finditer(text or ""))
    blocks = []
    for i, m in enumerate(matches):
        qn = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = (text[start:end] or "").strip()
        if not (1 <= qn <= 200 and body):
            continue
        # ※ 가 있으면 그 이전까지만 블록으로, 이후는 다음 문항 공통 설명으로 분리
        note_idx = body.find("※")
        if note_idx != -1:
            shared_note = normalize_ws(body[note_idx:])
            body = body[:note_idx].strip()
        else:
            shared_note = None
        blocks.append((qn, body, shared_note))
    return blocks


_BOGI_LABEL_RE = re.compile(r"^[\(\[\*]*보기[\)\]\*]*$")


def _extract_bullet_example(stem: str) -> tuple[str, str | None]:
    """stem에서 non-choice 불릿 리스트 블록을 보기(exampleText)로 분리.

    순방향 탐색: 첫 번째 "- 내용" 줄(①②③④ 제외)을 찾아 그 위치부터 끝까지를
    exampleText로 분리. 단, 그 앞에 실제 문제 본문이 있어야 한다.
    첫 불릿 바로 앞 줄이 "보기" 라벨이면 그 줄도 exampleText에 포함한다.
    """
    lines = stem.split("\n")
    bullet_start = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if (
            re.match(r"^- (?![①②③④]).+", stripped)
            or stripped.startswith("```")
            or (stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 2)
            or stripped.startswith("![")
        ):
            bullet_start = i
            break
    if bullet_start is None or bullet_start == 0:
        return stem, None

    # 첫 불릿/코드블록 앞의 빈 줄을 건너뛰고 "보기" 라벨이 있으면 포함
    split_at = bullet_start
    for j in range(bullet_start - 1, -1, -1):
        stripped = lines[j].strip()
        if not stripped:
            continue
        if _BOGI_LABEL_RE.match(stripped):
            split_at = j
        break

    question_part = "\n".join(lines[:split_at]).rstrip()
    if not question_part.strip():
        return stem, None

    example_lines = lines[split_at:]
    while example_lines and example_lines[-1].strip() in ("", "-"):
        example_lines.pop()
    example_part = "\n".join(example_lines).strip()
    return question_part, example_part or None


def parse_choices_from_block(block: str):
    # <보기>...</보기> 및 ![alt](url) 안의 내용은 같은 길이의 공백으로 마스킹하여 선택지 마커 오인식 방지
    masked = re.sub(
        r"<보기>.*?</보기>",
        lambda m: " " * len(m.group()),
        block,
        flags=re.DOTALL,
    )
    masked = _IMG_TAG_RE.sub(lambda m: " " * len(m.group()), masked)
    ms = list(CHOICE_MARKER_PATTERN.finditer(masked))
    if not ms:
        return [], block
    first = ms[0].start()
    stem_part = block[:first].strip()
    choices = []
    for i, m in enumerate(ms):
        start = m.end()
        end = ms[i + 1].start() if i + 1 < len(ms) else len(block)
        marker = m.group(1)
        n_map = {"①": 1, "②": 2, "③": 3, "④": 4}
        num = n_map.get(marker, int(marker[0]) if marker and marker[0].isdecimal() else 0)
        text = normalize_ws(block[start:end])  # 원본 block 기준 텍스트 추출
        # "- ②" 포맷에서 잘린 " -" 잔여분 제거
        text = re.sub(r'\s*-\s*$', '', text).strip()
        # OCR이 선택지 텍스트 끝에 [그림]을 잘못 붙인 경우 제거
        if text.endswith("[그림]") and text != "[그림]":
            text = text[: -len("[그림]")].rstrip()
        if not text or text == "[그림]":
            text = "[그림]"
        if 1 <= num <= 4:
            choices.append({"number": num, "text": text, "imageUrls": None})

    # 같은 번호가 연속으로 나온 경우: [그림] 항목을 텍스트 항목으로 교체
    deduped = []
    for c in choices:
        if deduped and deduped[-1]["number"] == c["number"]:
            if deduped[-1]["text"] == "[그림]":
                deduped[-1] = c  # 텍스트 버전으로 교체
            # 이미 텍스트면 유지 (중복 무시)
        else:
            deduped.append(c)
    return deduped, stem_part


_SHARED_RANGE_RE = re.compile(
    r'(\d+)\s*[~\-]\s*(\d+)\s*번?'          # 13~14번, 13-14
    r'|[(\[]\s*(\d+)\s*[~\-]\s*(\d+)\s*[)\]]'  # (13~14), [13-14]
)


def _parse_shared_range(text: str) -> tuple[int, int] | None:
    """※ 텍스트에서 (시작번호, 끝번호) 추출. 없으면 None."""
    m = _SHARED_RANGE_RE.search(text)
    if not m:
        return None
    if m.group(1):
        return int(m.group(1)), int(m.group(2))
    return int(m.group(3)), int(m.group(4))


def parse_structured_questions(page_ocr_texts: list[str]):
    by_qn = {}
    pending_shared: str | None = None
    pending_shared_from: int = 1
    pending_shared_until: int = 9999  # ※ 범위의 마지막 문항 번호

    for page_idx, page_text in enumerate(page_ocr_texts, start=1):
        # 페이지 첫 문항 이전 preamble에 ※ 공통 설명이 있으면 pending_shared로 설정
        first_q = QUESTION_SPLIT_PATTERN.search(page_text)
        if first_q:
            preamble = page_text[:first_q.start()].strip()
            if "※" in preamble:
                note_start = preamble.find("※")
                note_text = normalize_ws(preamble[note_start:])
                r = _parse_shared_range(note_text)
                # 공통보기 ※는 "물음에 답" 같은 구문을 포함함
                # 시험지 헤더 ※("정답 하나만을 골라...")는 공통보기 아님
                _SHARED_KEYWORDS = ("물음에 답", "다음을 보고", "아래를 보고", "다음 그림", "아래 그림")
                is_shared = r and any(kw in note_text for kw in _SHARED_KEYWORDS)
                if note_text and is_shared:
                    pending_shared = note_text
                    pending_shared_from  = r[0]
                    pending_shared_until = r[1]

        raw_blocks = split_question_blocks(page_text)
        for qn, block, shared_note in raw_blocks:
            choices, stem = parse_choices_from_block(block)
            example_text = None

            # Chandra markdown 보기 패턴:
            # stem 끝에 "- 항목" 불릿 리스트 블록이 있으면 exampleText로 분리.
            # 선택지 마커(①②③④)로 시작하는 줄은 제외.
            stem, bullet_example = _extract_bullet_example(stem)
            if bullet_example:
                example_text = normalize_ws(bullet_example)

            question_text = normalize_ws(stem)

            # "보기"가 있으면 문제/보기 분리
            # 주의: "위의 보기의 알고리즘" 처럼 보기를 참조하는 문장은 분리하지 않음
            view_idx = -1
            for token in ["<보기>", "[보기]"]:
                idx = question_text.find(token)
                if idx != -1:
                    view_idx = idx
                    break
            if view_idx == -1:
                # <u> 태그로 감싸진 긴 블록(50자 이상)이 있고 앞에 문제 본문이 있으면 보기로 분리
                u_block_m = re.search(r'<u>.{50,}?</u>', question_text, re.DOTALL)
                if u_block_m and question_text[:u_block_m.start()].strip():
                    view_idx = u_block_m.start()
            if view_idx != -1:
                example_text = convert_pipe_tables_to_markdown(normalize_ws(question_text[view_idx:]))
                question_text = normalize_ws(question_text[:view_idx])
            question_text = convert_pipe_tables_to_markdown(question_text)
            # "- ①" 절단 잔여 " -" 제거
            question_text = re.sub(r'\s*-\s*$', '', question_text)

            record = {
                "questionNumber": qn,
                "page": page_idx,
                "questionText": question_text,
                "exampleText": example_text,
                "sharedExample": pending_shared if pending_shared_from <= qn <= pending_shared_until else None,
                "sharedExampleImageUrls": None,
                "questionImageUrls": None,
                "choices": choices if choices else [],
                "needsNonTextRecovery": False,
                "recoveryReason": None,
            }
            # ── 후처리: OCR이 [그림] 누락 시 보완 ──
            # "다음 그래프", "다음 표" 등 시각 자료 참조가 있는데 [그림]이 없으면 자동 삽입
            _VISUAL_REF = re.compile(
                r"(?:"
                r"(?:다음(?!\s*중)|주어진|아래).{0,30}(?:그래프|그림|표(?!현|준|시|기|적|지|면|출|명)|트리|힙|행렬|도형|순서도)"
                r"|(?:그래프|그림|표|트리|힙|행렬|도형|순서도)로\s*나타낸"
                r")",
                re.IGNORECASE,
            )
            if "[그림]" not in question_text and _VISUAL_REF.search(question_text):
                question_text = question_text + " [그림]"
                record["questionText"] = question_text
            shared_ex = record.get("sharedExample") or ""
            if shared_ex and "[그림]" not in shared_ex and _VISUAL_REF.search(shared_ex):
                shared_ex = shared_ex + " [그림]"
                record["sharedExample"] = shared_ex
            # 선택지가 (a)(b)(c)(d) 같은 레이블이고 4개이지만 [그림]이 하나도 없으면 전체를 [그림]으로 교체
            _LABEL_PATTERN = re.compile(r"^\s*[\(\[（]?\s*[a-dA-D가나다라]\s*[\)\]）]?\s*$")
            choices_all_labels = (
                len(record["choices"]) == 4
                and all(_LABEL_PATTERN.match(c.get("text", "")) for c in record["choices"])
                and not any(c.get("text") == "[그림]" for c in record["choices"])
            )
            if choices_all_labels:
                for c in record["choices"]:
                    c["text"] = "[그림]"

            if len(record["choices"]) < 4:
                record["needsNonTextRecovery"] = True
                record["recoveryReason"] = "choices_lt_4"
            elif any(c.get("text") == "[그림]" for c in record["choices"]):
                record["needsNonTextRecovery"] = True
                record["recoveryReason"] = "non_text_choice_detected"
            elif "[그림]" in (example_text or ""):
                record["needsNonTextRecovery"] = True
                record["recoveryReason"] = "example_has_image"
            elif "[그림]" in question_text:
                record["needsNonTextRecovery"] = True
                record["recoveryReason"] = "body_has_image"
            elif "[그림]" in (record.get("sharedExample") or ""):
                record["needsNonTextRecovery"] = True
                record["recoveryReason"] = "shared_example_has_image"

            # 먼저 등장한 페이지 우선, 이미 있으면 choices만 보완
            if qn not in by_qn:
                by_qn[qn] = record
            else:
                existing = by_qn[qn]
                if not existing["choices"] and record["choices"]:
                    existing["choices"] = record["choices"]
                    existing["needsNonTextRecovery"] = record["needsNonTextRecovery"]
                    existing["recoveryReason"] = record["recoveryReason"]

            # 이 블록 말미의 ※ → 다음 문항부터 적용 (새 ※가 나오면 교체)
            if shared_note is not None:
                r = _parse_shared_range(shared_note)
                _SHARED_KEYWORDS = ("물음에 답", "다음을 보고", "아래를 보고", "다음 그림", "아래 그림")
                if r and any(kw in shared_note for kw in _SHARED_KEYWORDS):
                    pending_shared = shared_note
                    pending_shared_from  = r[0]
                    pending_shared_until = r[1]

    return [by_qn[k] for k in sorted(by_qn.keys())]


def analyze_pdf(
    pdf_path: Path,
    out_dir: Path,
    text_threshold: int,
    ocr_model: str | None = None,
    dpi: int = 150,
    reuse_pages: bool = False,
    answer_map: dict[int, list[int]] | None = None,
):
    ocr_provider = "chandra"
    out_dir.mkdir(parents=True, exist_ok=True)
    print("[..] 페이지 렌더링 중 (pymupdf)...")
    page_render_paths = render_pages(pdf_path, out_dir, dpi, reuse=reuse_pages)
    if fitz is None:
        print("[WARN] pymupdf 미설치 — 벡터 도형 캡처 불가. pip install pymupdf")
    else:
        print(f"[OK]  렌더링 완료: {len(page_render_paths)}페이지 → {out_dir}/pages/")

    reader = PdfReader(str(pdf_path))
    page_summaries = []
    text_layer_all = []
    extracted_images = []

    for i, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        text_layer_all.append(page_text)

        page_images = []
        try:
            page_images = list(page.images)
        except Exception:
            page_images = []

        page_summaries.append(
            PageSummary(
                page=i,
                text_chars=len(page_text),
                image_count=len(page_images),
                extracted_text_preview=_strip_pua(page_text[:200]),
            )
        )

    # OCR: 렌더링된 전체 페이지 이미지 우선 (벡터 도형 포함) → 없으면 내장 이미지 fallback
    print("[..] OCR 실행 중...")
    ocr_texts_per_page: list[str] = []
    all_ocr_texts: list[str] = []
    ocr_errors: list[dict] = []

    for i, _ in enumerate(page_summaries):
        page_num = i + 1
        ocr_text = ""

        if i < len(page_render_paths):
            text, err = run_ocr_if_possible(page_render_paths[i], ocr_provider, ocr_model)
            if text:
                text = apply_ocr_corrections(text)
                ocr_text = text
                all_ocr_texts.append(text)
            if err:
                ocr_errors.append({"page": page_num, "file": str(page_render_paths[i]), "error": err})
        else:
            for img_info in [x for x in extracted_images if x["page"] == page_num]:
                text, err = run_ocr_if_possible(Path(img_info["saved_path"]), ocr_provider, ocr_model)
                if text:
                    text = apply_ocr_corrections(text)
                    ocr_text += text
                    all_ocr_texts.append(text)
                if err:
                    ocr_errors.append({"page": page_num, "file": img_info["saved_path"], "error": err})

        ocr_texts_per_page.append(ocr_text)
        status = "OK" if ocr_text else "SKIP"
        print(f"  page {page_num}/{len(page_summaries)} OCR {status}")
        if ocr_text:
            (out_dir / f"page_{page_num:02d}_ocr.md").write_text(ocr_text, encoding="utf-8")

    text_layer = "\n".join(text_layer_all)
    ocr_layer = "\n".join(all_ocr_texts)

    text_question_numbers = parse_question_numbers(text_layer)
    ocr_question_numbers = parse_question_numbers(ocr_layer)

    total_text_chars = sum(p.text_chars for p in page_summaries)
    avg_chars_per_page = total_text_chars / max(len(page_summaries), 1)
    scanned_like = avg_chars_per_page < text_threshold

    blockers = []
    if scanned_like and not all_ocr_texts:
        blockers.append("텍스트 레이어가 거의 없어 OCR이 필요하지만, 현재 OCR 결과가 없습니다.")
    if scanned_like and not os.getenv("DATALAB_API_KEY"):
        blockers.append("DATALAB_API_KEY가 없어 Chandra OCR을 수행할 수 없습니다.")

    report = {
        "generated_at": datetime.now().isoformat(),
        "pdf_path": str(pdf_path),
        "page_count": len(reader.pages),
        "total_text_chars": total_text_chars,
        "text_threshold": text_threshold,
        "is_scanned_like": scanned_like,
        "pymupdf_available": fitz is not None,
        "page_summaries": [asdict(p) for p in page_summaries],
        "text_layer_question_numbers": text_question_numbers,
        "ocr_question_numbers": ocr_question_numbers,
        "image_count_total": len(extracted_images),
        "extracted_images": extracted_images,
        "ocr_enabled": bool(os.getenv("DATALAB_API_KEY")),
        "ocr_provider": ocr_provider,
        "ocr_model": ocr_model,
        "ocr_error_samples": ocr_errors[:20],
        "blockers": blockers,
        "recommendations": [
            "DB 저장 전 검증 단계에서 문항 번호 연속성(1..N), 보기 개수(보통 4개), 정답 매핑 수를 확인하세요.",
            "스캔형 PDF는 페이지 렌더링 + OCR + 레이아웃 분석(문항/보기/정답표 분리)이 필수입니다.",
            "도형/그림은 이미지 bbox 기반으로 가장 가까운 문항/선택지에 매핑하고 누락률을 리포트하세요.",
        ],
    }

    metadata = {"year": None, "semester": None, "examType": None, "subjectName": None}

    # OCR 텍스트에서 누락된 항목 보완 (정규식 fallback)
    if ocr_texts_per_page:
        first_page_text = ocr_texts_per_page[0]
        if not metadata["year"]:
            m = re.search(r"(\d{4})\s*학년도", first_page_text)
            if m:
                metadata["year"] = int(m.group(1))
        if not metadata["semester"]:
            m = re.search(r"([12]|하계|동계)\s*학기", first_page_text)
            if m:
                s = m.group(1)
                metadata["semester"] = int(s) if s in ["1", "2"] else s
        if not metadata["examType"]:
            m = re.search(r"(기말시험|중간시험|출석수업대체시험|계절수업시험)", first_page_text)
            if m:
                metadata["examType"] = m.group(1)
        if not metadata["subjectName"]:
            m = re.search(r"\[과목명\]\s*([^\n]+)", first_page_text)
            if m:
                metadata["subjectName"] = m.group(1).strip()

    # 파일명 fallback (예: "252-알고리즘-3학년-3교시-(3p).pdf")
    if not metadata["subjectName"]:
        parts = pdf_path.stem.split("-")
        if len(parts) >= 2:
            candidate = parts[1].strip()
            if candidate and not candidate.isdigit() and len(candidate) >= 2:
                metadata["subjectName"] = candidate

    report["metadata"] = metadata

    structured_questions = parse_structured_questions(ocr_texts_per_page)
    extracted_images = extract_images_with_bbox_from_fitz(pdf_path, out_dir)
    report["image_count_total"] = len(extracted_images)
    report["extracted_images"] = extracted_images
    structured_questions, image_mappings = attach_image_mappings(
        pdf_path, structured_questions, extracted_images
    )
    report["image_mappings"] = image_mappings

    # exampleText에 이미지가 있는 문항은 questionImageUrls → exampleImageUrls로 이동
    for q in structured_questions:
        if q.get("exampleText") and "![" in q["exampleText"] and q.get("questionImageUrls"):
            q["exampleImageUrls"] = q.pop("questionImageUrls")
            q["questionImageUrls"] = None

    report["structured_question_count"] = len(structured_questions)
    report["choice_count_anomalies"] = [
        q["questionNumber"] for q in structured_questions if len(q["choices"]) not in [4]
    ]
    report["needs_non_text_recovery"] = [
        q["questionNumber"] for q in structured_questions if q.get("needsNonTextRecovery")
    ]
    report["empty_question_text"] = [
        q["questionNumber"] for q in structured_questions if not (q.get("questionText") or "").strip()
    ]

    report_path = out_dir / "report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    image_mapping_path = out_dir / "image-mapping.json"
    normalized_image_mappings = []
    for row in (report.get("image_mappings", []) or []):
        copied = dict(row)
        copied["mappedTo"] = normalize_mapped_position(copied.get("mappedTo"))
        normalized_image_mappings.append(copied)
    with open(image_mapping_path, "w", encoding="utf-8") as f:
        json.dump(normalized_image_mappings, f, ensure_ascii=False, indent=2)

    structured_path = out_dir / "structured-questions.json"
    with open(structured_path, "w", encoding="utf-8") as f:
        json.dump(structured_questions, f, ensure_ascii=False, indent=2)

    html_path = generate_html_report(
        report, text_layer_all, ocr_texts_per_page, page_render_paths, structured_questions, out_dir,
        answer_map=answer_map,
    )

    preview_path = generate_preview_html(
        structured_questions,
        page_render_paths,
        normalized_image_mappings,
        out_dir,
        answer_map=answer_map,
        title=pdf_path.stem,
    )

    review_path = generate_review_html(
        structured_questions,
        out_dir,
        title=pdf_path.stem,
    )

    print(f"\n[OK] report.json : {report_path}")
    print(f"[OK] image-mapping : {image_mapping_path}")
    print(f"[OK] structured : {structured_path}")
    print(f"[OK] report.html : {html_path}")
    print(f"[OK] preview.html : {preview_path}")
    print(f"[OK] review.html  : {review_path}")
    print(f"[OK] pages={report['page_count']} text_chars={total_text_chars} embedded_images={len(extracted_images)}")
    if blockers:
        print("\n[WARN] blockers:")
        for b in blockers:
            print(f"  - {b}")
    print(f"\n브라우저에서 열기:\n  {preview_path}")


def main():
    ensure_api_keys_from_dotenv()

    parser = argparse.ArgumentParser(description="PDF parse readiness validator")
    parser.add_argument("pdf", help="target pdf path")
    parser.add_argument("--out-dir", default="tmp/pdf-validate", help="output directory")
    parser.add_argument(
        "--text-threshold",
        type=int,
        default=100,
        help="평균 chars/page 이하면 scanned-like 판정 (기본값 100)",
    )
    parser.add_argument("--ocr-model", default=None, help="(미사용, 호환성 유지)")
    parser.add_argument(
        "--dpi",
        type=int,
        default=150,
        help="페이지 렌더링 DPI (기본값 150, 높을수록 선명하지만 느림)",
    )
    parser.add_argument(
        "--reuse-pages",
        action="store_true",
        help="pages/ 폴더에 렌더링된 PNG가 있으면 재사용 (테스트 시 시간 절약)",
    )
    parser.add_argument(
        "--preview-only",
        action="store_true",
        help="기존 structured-questions.json + image-mapping.json으로 preview.html만 재생성 (OCR 생략)",
    )
    parser.add_argument("--year", type=int, default=None, help="시험 연도 (정답 CSV 조회용)")
    parser.add_argument(
        "--exam-type",
        type=int,
        choices=[1, 2, 3, 4],
        default=None,
        help="시험 타입 (1: 1학기기말, 2: 2학기기말 — 정답 CSV 조회용)",
    )
    parser.add_argument("--subject-name", default=None, help="과목명 (정답 CSV 조회용)")
    parser.add_argument(
        "--answers-dir",
        default="refs/answers",
        help="연도별 정답 CSV 폴더 (기본값: refs/answers)",
    )

    args = parser.parse_args()
    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    # 파일명 앞 YYYY- 패턴에서 연도 자동 추출 (예: 2015-244-이산수학...)
    year = args.year
    if year is None:
        m = re.match(r"^(\d{4})-", pdf_path.name)
        if m:
            year = int(m.group(1))
            print(f"[OK] 파일명에서 연도 감지: {year}")

    # 정답 CSV 로드 (선택적)
    answer_map: dict[int, list[int]] = {}
    if year and args.exam_type in (1, 2) and args.subject_name:
        csv_path = Path(args.answers_dir) / f"{year}-{args.exam_type}학기.csv"
        if csv_path.exists():
            with csv_path.open(encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    if row["subject_name"].strip() != args.subject_name.strip():
                        continue
                    try:
                        q = int(row["question_number"])
                        ans = [int(x) for x in row["answer"].strip().split(",") if x.strip()]
                        if ans:
                            answer_map[q] = ans
                    except (ValueError, KeyError):
                        continue
            if answer_map:
                print(f"[OK] 정답 CSV 로드 — {len(answer_map)}개 문항 ({args.subject_name} {year} {args.exam_type}학기)")
            else:
                print(f"[WARN] 정답 CSV에서 '{args.subject_name}' 과목을 찾지 못했습니다: {csv_path}")
        else:
            print(f"[WARN] 정답 CSV 없음: {csv_path}")

    out_dir = Path(args.out_dir) / pdf_path.stem

    if args.preview_only:
        sq_path = out_dir / "structured-questions.json"
        im_path = out_dir / "image-mapping.json"
        if not sq_path.exists():
            raise FileNotFoundError(f"structured-questions.json 없음: {sq_path}")
        with open(sq_path, encoding="utf-8") as f:
            structured_questions = json.load(f)
        image_mappings = json.loads(im_path.read_text(encoding="utf-8")) if im_path.exists() else []
        page_render_paths = sorted((out_dir / "pages").glob("page_*.png"))

        # answer_map이 비어 있으면 report.json 메타데이터로 자동 로드 시도
        if not answer_map:
            rpt = out_dir / "report.json"
            if rpt.exists():
                meta = json.loads(rpt.read_text(encoding="utf-8")).get("metadata", {})
                auto_year = meta.get("year") or year
                auto_subject = args.subject_name or meta.get("subjectName")
                auto_sem = args.exam_type or meta.get("semester") or 1
                if auto_year and auto_subject:
                    csv_path = Path(args.answers_dir) / f"{auto_year}-{auto_sem}학기.csv"
                    if csv_path.exists():
                        with csv_path.open(encoding="utf-8-sig") as f:
                            for row in csv.DictReader(f):
                                if row["subject_name"].strip() != auto_subject.strip():
                                    continue
                                try:
                                    q = int(row["question_number"])
                                    ans = [int(x) for x in row["answer"].strip().split(",") if x.strip()]
                                    if ans:
                                        answer_map[q] = ans
                                except (ValueError, KeyError):
                                    continue
                        if answer_map:
                            print(f"[OK] 정답 자동 로드 ({auto_subject} {auto_year}-{auto_sem}학기, {len(answer_map)}문항)")

        preview_path = generate_preview_html(
            structured_questions, page_render_paths, image_mappings,
            out_dir, answer_map=answer_map or None,
        )
        print(f"[OK] preview.html 재생성: {preview_path}")
        return

    analyze_pdf(
        pdf_path, out_dir, args.text_threshold, args.ocr_model,
        args.dpi, args.reuse_pages, answer_map=answer_map or None,
    )


if __name__ == "__main__":
    main()
