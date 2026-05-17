#!/usr/bin/env python
import argparse
import base64
import csv
import json
import os
import re
import shutil
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None

try:
    import pytesseract  # type: ignore
except Exception:
    pytesseract = None


def ensure_api_keys_from_dotenv():
    required_keys = ["OPENAI_API_KEY", "GEMINI_API_KEY"]
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


def apply_ocr_corrections(text: str) -> str:
    for wrong, correct in OCR_CORRECTIONS.items():
        text = text.replace(wrong, correct)
    return text


QUESTION_NUMBER_PATTERNS = [
    re.compile(r"(?m)^\s*(\d{1,3})[.)]\s+"),
    re.compile(r"(?m)^\s*(\d{1,3})(?=[가-힣A-Za-z①②③④⑤])"),
]
QUESTION_SPLIT_PATTERN = re.compile(r"(?m)^\s*(\d{1,3})[.)]\s*")
CHOICE_MARKER_PATTERN = re.compile(r"(①|②|③|④)")
JSON_BLOCK_RE = re.compile(r"\{.*\}|\[.*\]", re.DOTALL)

OCR_PROMPT = r"""이 시험지 이미지에서 모든 문항을 텍스트로 추출해줘.

규칙:
- 첫 페이지 상단의 과목명(예: "알 고 리 즘")을 찾아 띄어쓰기를 모두 제거한 후 전체 텍스트 맨 첫 줄에 "[과목명] 알고리즘" 형식으로 반드시 출력할 것.
- 문항 번호는 "1." 또는 "1)" 형식 그대로 유지
- 선택지 마커(① ② ③ ④)도 그대로 유지
- [수식 규칙] 수식·공식은 LaTeX 형식으로 출력. 예: 2^{k-1}, \frac{n}{2}, O(n \log n)
- [그림 규칙 — 가장 중요] 아래 경우는 반드시 [그림]으로만 표시하고 절대 텍스트로 설명하지 말 것:
  · 그래프 (좌표축, 함수 곡선, 노드·간선 구조, 방향/무방향 그래프 등)
  · 트리, 힙, 이진트리 구조
  · 표(행렬, 인접행렬, DP 테이블, 진리표 등)
  · 도형, 순서도, 사진, 다이어그램
  → 이런 내용을 텍스트로 설명하는 것은 잘못된 것. 반드시 [그림] 한 단어로만 표시
- [참조 규칙 — 매우 중요] "다음 그래프", "아래 그래프", "다음 그림", "위 그림", "다음 표", "아래 표" 등 시각 자료를 참조하는 문장 바로 다음에 실제 그래프/그림/표가 있으면, 반드시 그 자리에 [그림] 을 삽입할 것. 참조 문장만 쓰고 [그림] 생략은 절대 금지
- [선택지 그림 규칙] 선택지 내용이 (a)(b)(c)(d) 같은 레이블이지만 실제로 그래프·그림·표를 가리키는 경우, 반드시 ① [그림] ② [그림] ③ [그림] ④ [그림] 형식으로 출력할 것
- 선택지가 위 그림인 경우 반드시 ① [그림] ② [그림] ③ [그림] ④ [그림] 형식으로 출력할 것
- [가장 중요] 밑줄이 쳐진 텍스트나 빈 칸(예: <u>(b)</u>, <u>ㄱ</u>)은 반드시 <u> 태그로 감쌀 것! 절대 누락하지 말 것.
- [가장 중요] 박스(네모칸) 안에 있는 텍스트(배열, 수식, 코드, 예시 등)는 반드시 <보기> 박스내용 </보기> 와 같이 태그로 감싸서 명시할 것!
- [코드블록 규칙] 들여쓰기된 프로그램 코드나 알고리즘 의사코드는 줄바꿈을 반드시 그대로 보존하고 ``` 와 ``` 로 감싸서 출력할 것. 절대 한 줄로 합치지 말 것.
- · 항목(불릿 리스트)은 각 항목을 반드시 별도 줄로 출력할 것.
- 그 외 불필요한 설명이나 주석 없이 출력"""


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


def post_json(url: str, payload: dict, headers: dict, timeout: int = 60):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_ocr_if_possible(image_path: Path, provider: str, model: str | None):
    provider = provider.lower()
    if provider == "local":
        return run_local_tesseract_ocr(image_path)
    if provider == "openai":
        return run_openai_vision_ocr_if_possible(
            image_path, "provider=openai", model or "gpt-4.1-mini"
        )
    if provider == "gemini":
        return run_gemini_vision_ocr_if_possible(
            image_path, "provider=gemini", model or "gemini-1.5-pro"
        )
    if provider == "auto":
        text, err = run_local_tesseract_ocr(image_path)
        if text:
            return text, None
        text, err2 = run_openai_vision_ocr_if_possible(
            image_path, err or "auto_local_failed", "gpt-4.1-mini"
        )
        if text:
            return text, None
        text, err3 = run_gemini_vision_ocr_if_possible(
            image_path, err2 or "auto_openai_failed", "gemini-1.5-pro"
        )
        if text:
            return text, None
        return None, err3 or "auto_all_failed"
    return None, f"unsupported_provider:{provider}"


def run_local_tesseract_ocr(image_path: Path):
    if pytesseract is None:
        return None, "pytesseract_not_installed"
    if shutil.which("tesseract") is None:
        return None, "tesseract_binary_not_found"
    try:
        from PIL import Image

        text = pytesseract.image_to_string(
            Image.open(image_path), lang="kor+eng", config="--psm 6"
        )
        return text, None
    except Exception as e:
        return None, f"ocr_failed:{e}"


def run_openai_vision_ocr_if_possible(image_path: Path, reason: str, model: str):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None, f"{reason}|openai_api_key_not_found"
    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        payload = {
            "model": model,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": OCR_PROMPT,
                        },
                        {
                            "type": "input_image",
                            "image_url": f"data:image/png;base64,{b64}",
                        },
                    ],
                }
            ],
        }
        res_data = post_json(
            "https://api.openai.com/v1/responses",
            payload,
            {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        )
        output_text = ""
        for item in res_data.get("output", []):
            for c in item.get("content", []):
                if c.get("type") == "output_text":
                    output_text += c.get("text", "")
        if output_text.strip():
            return output_text, None
        return None, f"{reason}|openai_empty_output"
    except Exception as e:
        return None, f"{reason}|openai_ocr_failed:{e}"


def run_gemini_vision_ocr_if_possible(image_path: Path, reason: str, model: str):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None, f"{reason}|gemini_api_key_not_found"
    try:
        with open(image_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("utf-8")
        mime = "image/jpeg" if image_path.suffix.lower() in [".jpg", ".jpeg"] else "image/png"
        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": OCR_PROMPT},
                        {"inline_data": {"mime_type": mime, "data": b64}},
                    ]
                }
            ]
        }
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{urllib.parse.quote(model)}:generateContent?key={api_key}"
        )
        res_data = post_json(url, payload, {"Content-Type": "application/json"})
        output_text = ""
        for c in res_data.get("candidates", []):
            for p in c.get("content", {}).get("parts", []):
                output_text += p.get("text", "")
        if output_text.strip():
            return output_text, None
        return None, f"{reason}|gemini_empty_output"
    except Exception as e:
        return None, f"{reason}|gemini_ocr_failed:{e}"


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


PAGE_IMAGE_MAPPING_PROMPT = """\
이 시험지 페이지에 내장 이미지(그림/표/도형)가 총 {n_imgs}개 있습니다.
각 이미지 번호와 페이지 기준 위치(퍼센트 left,top,right,bottom):
{img_list}

이 페이지에 있는 문항 번호: {q_numbers}

각 이미지가 어느 문항에 속하며 문항 내 역할이 무엇인지 JSON으로만 답해줘.
- question: 문항 번호 (정수)
- position: "body"(문항 본문 그림) | "example"(보기 박스 그림) | "choice1"~"choice4"(선택지 그림)

중요 규칙:
- 각 이미지에 [왼쪽컬럼]/[오른쪽컬럼] 표시를 반드시 참고해 컬럼 구분
- 같은 컬럼 안에서 top%가 낮을수록 앞 문항, 높을수록 뒷 문항
- 한 문항에 이미지가 여러 개인 경우: top%가 가장 낮은(가장 위) 이미지가 body, 나머지는 top% 오름차순으로 choice1→choice2→choice3→choice4
- top%가 거의 같은(±2%) 이미지들은 나란히 배치된 것으로 같은 문항에 속함 (예: 좌우로 놓인 두 행렬)
- 같은 컬럼에서 수직으로 연속된 이미지들(사이 간격 15% 이내)은 같은 문항에 속할 가능성이 높음

형식 (JSON만, 다른 텍스트 없음):
{{"img1":{{"question":5,"position":"choice2"}},"img2":{{"question":6,"position":"body"}}}}"""

# ── Method B: [그림] 영역 좌표 요청 → 크롭 저장 ─────────────────────────

BBOX_QUESTION_BLOCK_PROMPT = """\
이 시험지 이미지에서 {q_no}번 문항만의 영역을 JSON으로 알려줘.

규칙:
- top: "{q_no}." 또는 "{q_no})" 문항 번호가 있는 줄의 상단 %
- bottom: {q_no}번의 마지막 선택지(④) 아래쪽 % — 반드시 {next_q_no}번 문항 번호 줄 위에서 끝낼 것
- left/right: 해당 문항 컬럼의 좌우 경계 %
- 다음 문항({next_q_no}번) 내용은 절대 포함하지 말 것

형식 (JSON만, 다른 텍스트 없음):
{{"left":숫자,"top":숫자,"right":숫자,"bottom":숫자}}

좌표는 이미지 전체 크기 대비 퍼센트(0~100). JSON 외 출력 금지."""

SPLIT_PROMPT = """\
이 이미지는 시험 문항 하나를 확대한 것이다.

아래 두 가지만 JSON으로 답해줘:
1. 첫 번째 선택지(① 기호)가 시작되는 위치 — 이미지 높이 기준 퍼센트(0~100)
2. 선택지 배치 방식 — "2x2" (2열 2행) 또는 "1x4" (1열 4행) 중 하나

참고: 선택지가 4개라면 choices_start_y는 보통 30~70% 사이임.
80% 이상이면 이미지에 문제 밖의 내용이 포함된 것일 수 있으니 신중히 판단할 것.

형식 (JSON만, 다른 텍스트 없음):
{{"choices_start_y":숫자,"layout":"2x2"}}"""

DIRECT_MAPPING_PROMPT = """\
이 페이지 이미지에서 {q_no}번 문항의 이미지 위치를 찾아 JSON만 출력해.

규칙:
- bbox 좌표는 페이지 기준 퍼센트(0~100): left, top, right, bottom
- 이미지가 없으면 null
- choice는 1~4 각각 별도로 판단
- 다른 문항 이미지는 절대 포함하지 말 것

형식:
{{
  "question_bbox": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
  "choices": {{
    "1": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "2": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "3": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "4": {{"left":0,"top":0,"right":0,"bottom":0}} | null
  }}
}}
JSON 외 텍스트 금지."""


def run_vision_with_prompt(
    image_path: Path, prompt: str, provider: str, model: str | None
) -> tuple[str | None, str | None]:
    """임의 프롬프트로 vision API 호출. 내부적으로 각 provider 재사용."""
    provider = provider.lower()

    def _openai():
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None, "openai_api_key_not_found"
        try:
            b64 = base64.b64encode(image_path.read_bytes()).decode()
            payload = {"model": model or "gpt-4.1-mini", "input": [{"role": "user", "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": f"data:image/png;base64,{b64}"},
            ]}]}
            res = post_json("https://api.openai.com/v1/responses", payload,
                            {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
            text = "".join(c.get("text", "") for item in res.get("output", [])
                           for c in item.get("content", []) if c.get("type") == "output_text")
            return (text, None) if text.strip() else (None, "openai_empty")
        except Exception as e:
            return None, f"openai_error:{e}"

    def _gemini():
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return None, "gemini_api_key_not_found"
        try:
            b64 = base64.b64encode(image_path.read_bytes()).decode()
            mime = "image/jpeg" if image_path.suffix.lower() in [".jpg", ".jpeg"] else "image/png"
            payload = {"contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": mime, "data": b64}}]}]}
            url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
                   f"{urllib.parse.quote(model or 'gemini-1.5-pro')}:generateContent?key={api_key}")
            res = post_json(url, payload, {"Content-Type": "application/json"})
            text = "".join(p.get("text", "") for c in res.get("candidates", [])
                           for p in c.get("content", {}).get("parts", []))
            return (text, None) if text.strip() else (None, "gemini_empty")
        except Exception as e:
            return None, f"gemini_error:{e}"

    runners = {"openai": _openai, "gemini": _gemini}
    if provider in runners:
        return runners[provider]()
    if provider == "auto":
        for fn in [_openai, _gemini]:
            text, err = fn()
            if text:
                return text, None
        return None, "auto_all_failed"
    return None, f"unsupported:{provider}"


def parse_bbox_response(text: str) -> dict | None:
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    for candidate in [cleaned, re.search(r'\{.*\}', cleaned, re.DOTALL)]:
        try:
            s = candidate if isinstance(candidate, str) else (candidate.group() if candidate else None)
            if s:
                return json.loads(s)
        except Exception:
            pass
    return None


def parse_json_loose(text: str):
    if not text:
        return None
    cleaned = re.sub(r"```(?:json)?\s*|\s*```", "", text).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    m = JSON_BLOCK_RE.search(cleaned)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


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


METADATA_EXTRACT_PROMPT = """\
이 시험지 이미지 상단에서 다음 정보를 JSON으로 추출해줘.

추출 항목:
- year: 학년도 숫자 (예: 2024) — "2024학년도" → 2024
- semester: 학기 숫자 (1 또는 2) — "하계"/"동계"이면 null
- examType: 시험 종류 문자열 (예: "기말시험", "계절수업시험", "출석수업대체시험")
- subjectName: 과목명 — 1번 문항 위에 표 형태로 "과목" 항목 옆에 적힌 이름 \
(예: "알 고 리 즘" → "알고리즘"). 출제위원 바로 위 행에도 위치할 수 있음. \
띄어쓰기를 모두 제거한 값으로 반환.

형식 (JSON만, 다른 텍스트 없음):
{"year":2024,"semester":1,"examType":"기말시험","subjectName":"알고리즘"}"""


def extract_metadata_via_vision(
    page_img: Path, provider: str, model: str | None
) -> dict:
    raw, _ = run_vision_with_prompt(page_img, METADATA_EXTRACT_PROMPT, provider, model)
    parsed = parse_json_loose(raw or "")
    if not isinstance(parsed, dict):
        return {}
    result = {}
    if isinstance(parsed.get("year"), int):
        result["year"] = parsed["year"]
    elif isinstance(parsed.get("year"), str) and parsed["year"].isdigit():
        result["year"] = int(parsed["year"])
    sem = parsed.get("semester")
    if isinstance(sem, int) and sem in (1, 2):
        result["semester"] = sem
    if isinstance(parsed.get("examType"), str):
        result["examType"] = parsed["examType"].strip()
    if isinstance(parsed.get("subjectName"), str):
        result["subjectName"] = parsed["subjectName"].strip()
    return result


def detect_question_y_anchors(page_img: Path, question_numbers: list[int], provider: str, model: str | None) -> dict[int, float]:
    if not question_numbers:
        return {}
    prompt = (
        "이 시험지 페이지 이미지에서 다음 문항 번호들의 시작 y좌표(퍼센트)를 추정해 JSON으로만 답해줘.\n"
        f"문항번호: {question_numbers}\n"
        '형식: {"anchors":[{"q":1,"y":12.3},{"q":2,"y":18.7}]}\n'
        "규칙: y는 0~100, 페이지 상단이 0, 하단이 100."
    )
    raw, _err = run_vision_with_prompt(page_img, prompt, provider, model)
    parsed = parse_json_loose(raw or "")
    out = {}
    if isinstance(parsed, dict):
        anchors = parsed.get("anchors", [])
        if isinstance(anchors, list):
            for a in anchors:
                try:
                    q = int(a.get("q"))
                    y = float(a.get("y"))
                    if 0 <= y <= 100:
                        out[q] = y
                except Exception:
                    pass
    return out


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
            if q_no is None or q_no not in q_map:
                continue

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
            if position in ("body", "example"):
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


def crop_region(src: Path, bbox: dict, dst: Path) -> bool:
    """PNG 파일에서 bbox 영역 크롭 (pymupdf 페이지 렌더링 방식)."""
    if fitz is None or not bbox:
        return False
    try:
        required = ("left", "top", "right", "bottom")
        if any(bbox.get(k) is None for k in required):
            return False
        doc = fitz.open(str(src))
        page = doc[0]
        w, h = page.rect.width, page.rect.height
        clip = fitz.Rect(
            bbox["left"] / 100 * w,
            bbox["top"] / 100 * h,
            bbox["right"] / 100 * w,
            bbox["bottom"] / 100 * h,
        )
        if clip.width <= 0 or clip.height <= 0:
            doc.close()
            return False
        pix = page.get_pixmap(clip=clip, alpha=False)
        pix.save(str(dst))
        doc.close()
        return True
    except Exception as e:
        print(f"    [crop] 실패: {e}")
        return False


def recover_question_images(
    questions: list[dict],
    page_render_paths: list[Path],
    provider: str,
    model: str | None,
    out_dir: Path,
) -> list[dict]:
    """2-pass 방식: 1차 문항 블록 크롭 → 2차 블록 내 선택지 좌표 요청."""
    targets = [q for q in questions if q.get("needsNonTextRecovery")]
    if not targets:
        return questions
    if fitz is None:
        print("[WARN] pymupdf 없음 — 이미지 크롭 불가")
        return questions

    crops_dir = out_dir / "crops"
    crops_dir.mkdir(exist_ok=True)

    for q in targets:
        page_idx = q.get("page", 1) - 1
        if page_idx >= len(page_render_paths):
            continue
        page_img = page_render_paths[page_idx]
        q_no = q["questionNumber"]

        # ── 1차: 문항 전체 블록 위치 ──────────────────────────────────
        print(f"  [recover] {q_no}번 1차(블록 위치) 요청 중...")
        raw, err = run_vision_with_prompt(
            page_img,
            BBOX_QUESTION_BLOCK_PROMPT.format(q_no=q_no, next_q_no=q_no + 1),
            provider, model,
        )
        if not raw:
            print(f"  [recover] {q_no}번 1차 실패: {err}")
            continue

        block_bbox = parse_bbox_response(raw)
        if not block_bbox or any(block_bbox.get(k) is None for k in ("left", "top", "right", "bottom")):
            print(f"  [recover] {q_no}번 블록 bbox 파싱 실패: {raw[:80]}")
            continue

        block_path = crops_dir / f"q{q_no:03d}_block.png"
        if not crop_region(page_img, block_bbox, block_path):
            print(f"  [recover] {q_no}번 블록 크롭 실패")
            continue
        print(f"  [recover] {q_no}번 블록 크롭 OK")

        # ── 2차: ①시작 y%, 레이아웃만 물어보고 나머지는 알고리즘 분할 ──
        print(f"  [recover] {q_no}번 2차(레이아웃 감지) 요청 중...")
        raw2, err2 = run_vision_with_prompt(block_path, SPLIT_PROMPT, provider, model)
        if not raw2:
            print(f"  [recover] {q_no}번 2차 실패: {err2}")
            continue

        split_data = parse_bbox_response(raw2)
        if not split_data or split_data.get("choices_start_y") is None:
            print(f"  [recover] {q_no}번 레이아웃 파싱 실패: {raw2[:80]}")
            continue

        choices_start_y = float(split_data["choices_start_y"])
        layout = split_data.get("layout", "2x2")
        print(f"  [recover] {q_no}번 레이아웃={layout}, ①시작={choices_start_y:.1f}%")

        # 선택지 시작이 80% 이상이면 블록이 다음 문항까지 캡처된 것으로 판단 → 재조정
        if choices_start_y > 80:
            print(f"  [WARN] {q_no}번 choices_start_y={choices_start_y:.1f}% — 블록이 너무 큼. 원본 페이지에서 하단 25% 제거 후 재시도...")
            block_h = block_bbox["bottom"] - block_bbox["top"]
            trimmed_full_bbox = {
                "left": block_bbox["left"],
                "top": block_bbox["top"],
                "right": block_bbox["right"],
                "bottom": block_bbox["top"] + block_h * 0.75,
            }
            block_trimmed_path = crops_dir / f"q{q_no:03d}_block_trimmed.png"
            if crop_region(page_img, trimmed_full_bbox, block_trimmed_path):
                block_path = block_trimmed_path
                raw2b, err2b = run_vision_with_prompt(block_path, SPLIT_PROMPT, provider, model)
                if raw2b:
                    split_data2 = parse_bbox_response(raw2b)
                    if split_data2 and split_data2.get("choices_start_y") is not None:
                        choices_start_y = float(split_data2["choices_start_y"])
                        layout = split_data2.get("layout", layout)
                        print(f"  [recover] {q_no}번 재조정 후 레이아웃={layout}, ①시작={choices_start_y:.1f}%")

        # 문항 본문 그림 (블록 상단 ~ ①시작 전)
        if choices_start_y > 5:
            dst = crops_dir / f"q{q_no:03d}_body.png"
            if crop_region(block_path, {"left": 0, "top": 0, "right": 100, "bottom": choices_start_y}, dst):
                q["questionImageUrls"] = [str(dst)]

        # 선택지 균등 분할
        remaining = 100 - choices_start_y
        choice_map = {c["number"]: c for c in q.get("choices", [])}

        if layout == "2x2":
            mid_y = choices_start_y + remaining / 2
            bboxes = [
                {"number": 1, "left": 0,  "top": choices_start_y, "right": 50,  "bottom": mid_y},
                {"number": 2, "left": 50, "top": choices_start_y, "right": 100, "bottom": mid_y},
                {"number": 3, "left": 0,  "top": mid_y,           "right": 50,  "bottom": 100},
                {"number": 4, "left": 50, "top": mid_y,           "right": 100, "bottom": 100},
            ]
        else:  # 1x4
            step = remaining / 4
            bboxes = [
                {"number": i + 1, "left": 0, "top": choices_start_y + step * i,
                 "right": 100, "bottom": choices_start_y + step * (i + 1)}
                for i in range(4)
            ]

        for cb in bboxes:
            num = cb["number"]
            dst = crops_dir / f"q{q_no:03d}_choice{num}.png"
            if crop_region(block_path, cb, dst):
                if num in choice_map:
                    choice_map[num]["imageUrls"] = str(dst)

        recovered = sum(1 for c in q.get("choices", []) if c.get("imageUrls"))
        print(f"  [recover] {q_no}번 완료 — 선택지 {recovered}개 크롭")

    return questions


FIGURE_BBOX_PROMPT = """\
이 시험지 페이지 이미지에서 {q_no}번 문항의 그림/도형/그래프/표 위치를 JSON으로 알려줘.

확인할 위치:
- question: 문항 본문(①이 나오기 전)에 그림이 있으면 그 영역
- example: 보기(네모 박스) 안에 그림/표가 있으면 보기 전체 박스 영역
- choices: ①②③④ 각 선택지에 그림이 있으면 그 선택지 영역

규칙:
- 좌표는 페이지 전체 기준 퍼센트(0~100): left, top, right, bottom
- 그림 없는 위치는 null
- choices는 1~4 각각 독립적으로 판단

형식 (JSON만, 다른 텍스트 없음):
{{
  "question": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
  "example": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
  "choices": {{
    "1": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "2": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "3": {{"left":0,"top":0,"right":0,"bottom":0}} | null,
    "4": {{"left":0,"top":0,"right":0,"bottom":0}} | null
  }}
}}"""


def crop_png_region(src: Path, bbox: dict, dst: Path) -> bool:
    """PIL로 PNG에서 bbox 퍼센트 영역 크롭."""
    try:
        from PIL import Image
        required = ("left", "top", "right", "bottom")
        if any(bbox.get(k) is None for k in required):
            return False
        img = Image.open(src)
        w, h = img.size
        left   = int(bbox["left"]   / 100 * w)
        top    = int(bbox["top"]    / 100 * h)
        right  = int(bbox["right"]  / 100 * w)
        bottom = int(bbox["bottom"] / 100 * h)
        if right <= left or bottom <= top:
            return False
        img.crop((left, top, right, bottom)).save(dst)
        return True
    except Exception as e:
        print(f"    [crop_png] 실패: {e}")
        return False


def recover_missing_choice_images_by_markers(
    pdf_path: Path,
    questions: list[dict],
    page_render_paths: list[Path],
    out_dir: Path,
) -> None:
    """텍스트 레이어의 문항/선택지 마커 좌표로 선택지 이미지를 결정론적으로 크롭."""
    if fitz is None:
        return

    crops_dir = out_dir / "crops"
    crops_dir.mkdir(exist_ok=True)

    by_page_q: dict[int, list[dict]] = {}
    for q in questions:
        by_page_q.setdefault(q.get("page", 1), []).append(q)

    doc = fitz.open(str(pdf_path))
    try:
        for page_idx in range(1, len(doc) + 1):
            page_qs = by_page_q.get(page_idx, [])
            if not page_qs:
                continue
            page_img_idx = page_idx - 1
            if page_img_idx >= len(page_render_paths):
                continue
            page_img = page_render_paths[page_img_idx]

            page = doc[page_img_idx]
            words = list(page.get_text("words"))
            if not words:
                continue
            pw = page.rect.width
            ph = page.rect.height

            q_numbers = {q["questionNumber"] for q in page_qs}
            q_anchors: dict[int, tuple[float, float]] = {}
            for i, wi in enumerate(words):
                x0, y0, word = wi[0], wi[1], str(wi[4]).strip()
                m = re.match(r"^(\d{1,3})[.)]\s*$", word)
                if m:
                    n = int(m.group(1))
                    if n in q_numbers and n not in q_anchors:
                        q_anchors[n] = (x0, y0)
                        continue
                if re.match(r"^\d{1,3}$", word) and i + 1 < len(words):
                    nxt = str(words[i + 1][4]).strip()
                    if nxt in (".", ")"):
                        n = int(word)
                        if n in q_numbers and n not in q_anchors:
                            q_anchors[n] = (x0, y0)

            if not q_anchors:
                continue

            q_sorted = sorted(q_anchors.items(), key=lambda kv: kv[1][1])
            q_order = [n for n, _ in q_sorted]
            q_to_next_y = {}
            for idx, qn in enumerate(q_order):
                if idx + 1 < len(q_order):
                    q_to_next_y[qn] = q_anchors[q_order[idx + 1]][1]
                else:
                    q_to_next_y[qn] = ph - 1

            choice_markers: dict[int, dict[int, float]] = {}
            marker_to_num = {"①": 1, "②": 2, "③": 3, "④": 4}
            for wi in words:
                x0, y0, word = wi[0], wi[1], str(wi[4]).strip()
                num = marker_to_num.get(word)
                if num is None:
                    continue
                qn = _nearest_question_above(y0, x0, q_anchors, pw)
                if qn is None:
                    continue
                if y0 >= q_to_next_y.get(qn, ph):
                    continue
                choice_markers.setdefault(qn, {})
                if num not in choice_markers[qn]:
                    choice_markers[qn][num] = y0

            for q in page_qs:
                qn = q["questionNumber"]
                markers = choice_markers.get(qn, {})
                if not markers:
                    continue
                choice_map = {c["number"]: c for c in q.get("choices", [])}
                col_left = 0.0 if q_anchors[qn][0] < pw / 2 else 50.0
                col_right = 50.0 if col_left == 0.0 else 100.0

                # 컬럼 여백을 조금 확보해 선택지 기호/텍스트를 덜 포함하도록 조정
                left = col_left + 2.0
                right = col_right - 2.0
                q_top_pct = q_anchors[qn][1] / ph * 100
                q_bottom_pct = q_to_next_y.get(qn, ph) / ph * 100

                for num in [1, 2, 3, 4]:
                    c = choice_map.get(num)
                    if not c or c.get("text") != "[그림]" or c.get("imageUrls"):
                        continue
                    y_top = markers.get(num)
                    if y_top is None:
                        continue
                    next_ys = [y for n, y in markers.items() if n > num]
                    y_bottom = min(next_ys) if next_ys else q_to_next_y.get(qn, ph)

                    top_pct = max(q_top_pct, y_top / ph * 100 - 1.0)
                    bottom_pct = min(q_bottom_pct, y_bottom / ph * 100 - 0.5)
                    if bottom_pct - top_pct < 2.0:
                        continue

                    dst = crops_dir / f"q{qn:03d}_choice{num}.png"
                    ok = crop_png_region(
                        page_img,
                        {
                            "left": left,
                            "top": top_pct,
                            "right": right,
                            "bottom": bottom_pct,
                        },
                        dst,
                    )
                    if ok:
                        c["imageUrls"] = [str(dst)]
                        print(f"  [marker-crop] Q{qn} choice{num} 크롭 성공")
    finally:
        doc.close()


def recover_figure_images(
    pdf_path: Path,
    questions: list[dict],
    page_render_paths: list[Path],
    provider: str,
    model: str | None,
    out_dir: Path,
) -> list[dict]:
    """[그림]이 있는 문항의 보기/선택지를 페이지 렌더에서 크롭하여 이미지로 저장."""
    targets = [q for q in questions if q.get("needsNonTextRecovery")]
    if not targets:
        return questions

    # 1차: 텍스트 레이어 기반 결정론적 크롭 (시험지 템플릿 의존도 낮음)
    recover_missing_choice_images_by_markers(pdf_path, questions, page_render_paths, out_dir)

    crops_dir = out_dir / "crops"
    crops_dir.mkdir(exist_ok=True)

    for q in targets:
        page_idx = q.get("page", 1) - 1
        if page_idx >= len(page_render_paths):
            continue
        page_img = page_render_paths[page_idx]
        q_no = q["questionNumber"]

        needs_question     = "[그림]" in (q.get("questionText") or "") and not (q.get("questionImageUrls"))
        needs_example      = "[그림]" in (q.get("exampleText") or "")
        # 이미 imageUrls가 있는 선택지는 제외
        needs_choices      = [c for c in q.get("choices") or [] if c.get("text") == "[그림]" and not c.get("imageUrls")]
        missing_choices    = len(q.get("choices") or []) < 4  # OCR이 선택지를 아예 못 읽은 경우

        if not (needs_question or needs_example or needs_choices or missing_choices):
            continue

        print(f"  [figure] Q{q_no} bbox 요청 중...")
        raw, err = run_vision_with_prompt(
            page_img, FIGURE_BBOX_PROMPT.format(q_no=q_no), provider, model
        )
        if not raw:
            print(f"  [figure] Q{q_no} 실패: {err}")
            continue

        data = parse_json_loose(raw)
        if not isinstance(data, dict):
            print(f"  [figure] Q{q_no} 파싱 실패: {raw[:60]}")
            continue
        print(f"  [figure] Q{q_no} bbox 반환값: {data}")

        # 문항 본문 그림
        # 문항 본문 그림
        if needs_question and isinstance(data.get("question"), dict):
            dst = crops_dir / f"q{q_no:03d}_body.png"
            if crop_png_region(page_img, data["question"], dst):
                q["questionImageUrls"] = (q.get("questionImageUrls") or []) + [str(dst)]

        # 보기 그림
        if needs_example and isinstance(data.get("example"), dict):
            dst = crops_dir / f"q{q_no:03d}_example.png"
            if crop_png_region(page_img, data["example"], dst):
                q["questionImageUrls"] = (q.get("questionImageUrls") or []) + [str(dst)]
                q["exampleText"] = None

        # 선택지 그림 (기존 [그림] 선택지 + 선택지 자체가 없는 경우)
        choices_data = data.get("choices") or {}
        choice_map = {c["number"]: c for c in q.get("choices") or []}
        recovered = 0

        target_nums = {c["number"] for c in needs_choices}
        if missing_choices:
            target_nums |= {1, 2, 3, 4}

        for num in sorted(target_nums):
            # 이미 attach_image_mappings에서 매핑된 선택지는 덮어쓰지 않음
            if num in choice_map and choice_map[num].get("imageUrls"):
                continue
            bbox = choices_data.get(str(num))
            if not isinstance(bbox, dict):
                continue
            dst = crops_dir / f"q{q_no:03d}_choice{num}.png"
            if crop_png_region(page_img, bbox, dst):
                if num not in choice_map:
                    choice_map[num] = {"number": num, "text": "[그림]", "imageUrls": None}
                    q["choices"].append(choice_map[num])
                choice_map[num]["imageUrls"] = [str(dst)]
                recovered += 1

        print(f"  [figure] Q{q_no} 완료 — 선택지 {recovered}/{len(target_nums)}개 크롭")

    return questions


def _html_escape(text: str) -> str:
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


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
    # PDF 내부 문항번호(1-35)와 CSV 번호(36-70)가 다를 수 있으므로 오프셋 자동 계산.
    # PDF numbers가 CSV numbers보다 낮으면 offset = min(csv_keys) - min(pdf_keys)
    q_offset = 0
    if answer_map and questions:
        pdf_min = min(q["questionNumber"] for q in questions)
        csv_min = min(answer_map.keys())
        if csv_min > pdf_min:
            q_offset = csv_min - pdf_min

    rows = []
    for q in questions:
        needs_recovery = q.get("needsNonTextRecovery", False)
        row_bg = "background:#fff8e1;" if needs_recovery else ""
        choices = q.get("choices", [])
        correct = set(answer_map.get(q["questionNumber"] + q_offset, [])) if answer_map else set()

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


def parse_choices_from_block(block: str):
    # <보기>...</보기> 안의 내용은 같은 길이의 공백으로 마스킹하여 선택지 마커 오인식 방지
    masked = re.sub(
        r"<보기>.*?</보기>",
        lambda m: " " * len(m.group()),
        block,
        flags=re.DOTALL,
    )
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


def parse_structured_questions(page_ocr_texts: list[str]):
    by_qn = {}
    pending_shared: str | None = None
    pending_shared_until: int = 9999  # ※ 범위의 마지막 문항 번호

    for page_idx, page_text in enumerate(page_ocr_texts, start=1):
        # 페이지 첫 문항 이전 preamble에 ※ 공통 설명이 있으면 pending_shared로 설정
        first_q = QUESTION_SPLIT_PATTERN.search(page_text)
        if first_q:
            preamble = page_text[:first_q.start()].strip()
            if "※" in preamble:
                note_start = preamble.find("※")
                note_text = normalize_ws(preamble[note_start:])
                if note_text:
                    pending_shared = note_text
                    m_range = re.search(r'[(\[]\s*\d+\s*[~\-]\s*(\d+)\s*[)\]]', note_text)
                    pending_shared_until = int(m_range.group(1)) if m_range else 9999

        raw_blocks = split_question_blocks(page_text)
        for qn, block, shared_note in raw_blocks:
            choices, stem = parse_choices_from_block(block)
            example_text = None
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
                # 태그 없는 날보기: 조사(의/에/를/은/는/로/가) 없이 단독으로 쓰인 경우만
                m = re.search(r'(?<![^\s가-힣])보기(?![의에를은는로가도])', question_text)
                if m:
                    view_idx = m.start()
            if view_idx == -1:
                # <u> 태그로 감싸진 긴 블록(50자 이상)이 있고 앞에 문제 본문이 있으면 보기로 분리
                u_block_m = re.search(r'<u>.{50,}?</u>', question_text, re.DOTALL)
                if u_block_m and question_text[:u_block_m.start()].strip():
                    view_idx = u_block_m.start()
            if view_idx != -1:
                example_text = convert_pipe_tables_to_markdown(normalize_ws(question_text[view_idx:]))
                question_text = normalize_ws(question_text[:view_idx])
            question_text = convert_pipe_tables_to_markdown(question_text)

            record = {
                "questionNumber": qn,
                "page": page_idx,
                "questionText": question_text,
                "exampleText": example_text,
                "sharedExample": pending_shared if qn <= pending_shared_until else None,
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
                pending_shared = shared_note
                # "※ (16~18)" 또는 "※ (16-18)" 형태에서 마지막 번호 파싱
                m = re.search(r'[(\[]\s*\d+\s*[~\-]\s*(\d+)\s*[)\]]', shared_note)
                pending_shared_until = int(m.group(1)) if m else 9999

    return [by_qn[k] for k in sorted(by_qn.keys())]


def analyze_pdf(
    pdf_path: Path,
    out_dir: Path,
    text_threshold: int,
    ocr_provider: str,
    ocr_model: str | None,
    dpi: int,
    reuse_pages: bool = False,
    answer_map: dict[int, list[int]] | None = None,
):
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
    if scanned_like and shutil.which("tesseract") is None:
        if (
            not os.getenv("OPENAI_API_KEY")
            and not os.getenv("GEMINI_API_KEY")
        ):
            blockers.append(
                "tesseract, OPENAI_API_KEY, GEMINI_API_KEY가 모두 없어 OCR을 수행할 수 없습니다."
            )

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
        "ocr_enabled": (pytesseract is not None and shutil.which("tesseract") is not None)
        or bool(os.getenv("OPENAI_API_KEY"))
        or bool(os.getenv("GEMINI_API_KEY")),
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

    # 메타데이터 추출: 첫 페이지 렌더링 이미지로 vision API 호출 (연도/학기/시험종류/과목명)
    metadata = {"year": None, "semester": None, "examType": None, "subjectName": None}
    if page_render_paths:
        print("[..] 첫 페이지에서 메타데이터 추출 중...")
        vision_meta = extract_metadata_via_vision(page_render_paths[0], ocr_provider, ocr_model)
        metadata.update({k: v for k, v in vision_meta.items() if v is not None})
        print(f"[OK] 메타데이터: {metadata}")

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

    print(f"\n[OK] report.json : {report_path}")
    print(f"[OK] image-mapping : {image_mapping_path}")
    print(f"[OK] structured : {structured_path}")
    print(f"[OK] report.html : {html_path}")
    print(f"[OK] pages={report['page_count']} text_chars={total_text_chars} embedded_images={len(extracted_images)}")
    if blockers:
        print("\n[WARN] blockers:")
        for b in blockers:
            print(f"  - {b}")
    print(f"\n브라우저에서 열기:\n  {html_path}")


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
    parser.add_argument(
        "--ocr-provider",
        default="auto",
        choices=["auto", "local", "openai", "gemini"],
    )
    parser.add_argument("--ocr-model", default=None, help="OCR 모델 이름 override")
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
        default="tmp/answers",
        help="연도별 정답 CSV 폴더 (기본값: tmp/answers)",
    )

    args = parser.parse_args()
    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    # 정답 CSV 로드 (선택적)
    answer_map: dict[int, list[int]] = {}
    if args.year and args.exam_type in (1, 2) and args.subject_name:
        csv_path = Path(args.answers_dir) / f"{args.year}-{args.exam_type}학기.csv"
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
                print(f"[OK] 정답 CSV 로드 — {len(answer_map)}개 문항 ({args.subject_name} {args.year} {args.exam_type}학기)")
            else:
                print(f"[WARN] 정답 CSV에서 '{args.subject_name}' 과목을 찾지 못했습니다: {csv_path}")
        else:
            print(f"[WARN] 정답 CSV 없음: {csv_path}")

    out_dir = Path(args.out_dir) / pdf_path.stem
    analyze_pdf(
        pdf_path, out_dir, args.text_threshold, args.ocr_provider, args.ocr_model,
        args.dpi, args.reuse_pages, answer_map=answer_map or None,
    )


if __name__ == "__main__":
    main()
