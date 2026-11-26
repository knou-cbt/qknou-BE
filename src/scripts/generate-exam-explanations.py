#!/usr/bin/env python3
"""로컬 DB의 시험 문항으로 LLM(Gemini 기본, OpenAI 선택) 해설을 만들고, 운영 반영용 SQL 릴리스를 만든다.

운영 DB·공개 API를 쓰지 않는다 (공개 API는 봇 차단 규칙에 걸림, docs/BOT_BLOCKING.md).
- 프롬프트는 tools/explanation-batch.mjs(= 서버 tutor 프롬프트 + 공통 지문)와 같다
- 그림이 있는 문항은 R2 그림 URL을 함께 보내 모델이 그림을 보고 해설한다
- 결과는 tmp/explanations/<run>/results.jsonl 에 쌓이고, 다시 실행하면 이미 성공한 문항은 건너뛴다

사용 예:
  # 1) 시험 1개 일부로 품질 확인
  python3 src/scripts/generate-exam-explanations.py generate --run 1125 --exam-ids 11 --limit 5
  # 2) 전체 생성
  python3 src/scripts/generate-exam-explanations.py generate --run 1125 --exam-ids 2,3,4,5,6,7,8,9,10,11,12,13,14
  # 3) 로컬 DB 반영(선택) + 운영 SQL 릴리스
  python3 src/scripts/generate-exam-explanations.py to-sql --run 1125 --release 20261126-1 [--apply-local]
  → 운영 SQL은 시험 제목·문항 번호로 찾아 해설이 비어 있는 문항에만 넣는다(기존 해설 유지)

키: GEMINI_API_KEY(--provider gemini, 기본) 또는 OPENAI_API_KEY(--provider openai). 환경변수 또는 --env-file(.env.development). 필요 패키지: psycopg2-binary
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Lock

sys.path.insert(0, str(Path(__file__).parent))
from r2_env import load_env_file  # noqa: E402

import psycopg2  # noqa: E402
import psycopg2.extras  # noqa: E402

PLACEHOLDER = "해설을 생성하지 못했습니다."
SYSTEM = """KNOU 기출문제 해설 생성. JSON만 출력.
규칙: 각 선택지를 "N번. 개념명\\n설명" 형식으로 작성. 선택지 사이는 빈 줄(\\\\n\\\\n)로 구분. 정답/오답 구분 표시 없음. 오답은 틀렸다는 표현 없이 그 개념이 무엇인지만 설명. 영문 명칭이 실제로 존재하는 용어에 한해 "한글발음(English)" 형식으로 표기하고, 한글 전용 개념은 그냥 한글만 쓸 것. 말투는 "~이다, ~때문이다" 체로 간결하게. 이모지 금지.
{"explanation":"1번. 개념명\\\\n설명\\\\n\\\\n2번. 개념명\\\\n설명\\\\n\\\\n...","concept_tags":["개념1","개념2"]}
concept_tags: 핵심 학술 개념 2~4개, 소문자, 일반어 제외."""
IMAGE_NOTE = "첨부 그림은 문제에 포함된 그림이다(공통 지문 그림 → 문제 그림 → 선택지 그림 순서). 그림 내용을 근거로 해설할 것."


PROVIDERS = {
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "GEMINI_API_KEY", "gemini-3.8-flash"),
    "openai": ("https://api.openai.com/v1/chat/completions", "OPENAI_API_KEY", "gpt-5.4-mini"),
}
_img_cache: dict = {}


def data_url(url: str) -> str:
    """그림을 내려받아 data URL로 첨부 (Gemini 호환 API는 원격 URL보다 base64가 안정적)."""
    if url not in _img_cache:
        # r2.dev는 Python 기본 User-Agent(Python-urllib)를 403으로 막음
        req = urllib.request.Request(enc(url), headers={"User-Agent": "qknou-explanation-script/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            ct = r.headers.get_content_type() or "image/png"
            _img_cache[url] = f"data:{ct};base64,{base64.b64encode(r.read()).decode()}"
    return _img_cache[url]


def enc(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((p.scheme, p.netloc, urllib.parse.quote(urllib.parse.unquote(p.path), safe="/()"), p.query, p.fragment))


def build_messages(q: dict) -> list:
    imgs = []
    for u in q["shared_example_image_urls"] or []:
        imgs.append(("공통 지문 그림", u))
    for u in q["question_image_urls"] or []:
        imgs.append(("문제 그림", u))
    lines = []
    for c in q["choices"]:
        cimgs = c.get("imageUrls") if isinstance(c.get("imageUrls"), list) else []
        for u in cimgs:
            imgs.append((f"{c['number']}번 선택지 그림", u))
        text = (c.get("text") or "").strip()
        lines.append(f"{c['number']}번: {text or '(그림)'}" if not cimgs or not text else f"{c['number']}번: {text} (그림 있음)")
    prompt = (
        (f"공통 지문: {q['shared_example']}\n" if q["shared_example"] else "")
        + f"문제: {q['question_text']}"
        + (f"\n보기: {q['example_text']}" if q["example_text"] else "")
        + "\n선택지:\n" + "\n".join(lines)
        + f"\n정답: {', '.join(str(a) for a in q['correct_answers'])}번"
    )
    if not imgs:
        return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    content = [{"type": "text", "text": prompt + "\n\n" + IMAGE_NOTE}]
    for label, u in imgs:
        content.append({"type": "text", "text": f"[{label}]"})
        content.append({"type": "image_url", "image_url": {"url": data_url(u)}})
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": content}]


def call_api(endpoint: str, key: str, body: dict) -> dict:
    req = urllib.request.Request(
        endpoint, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            return json.load(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            if e.code in (429, 500, 502, 503) and attempt < 4:
                time.sleep(5 * (attempt + 1)); continue
            raise RuntimeError(f"HTTP {e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(5 * (attempt + 1)); continue
            raise
    raise RuntimeError("재시도 초과")


def fix_latex_escapes(raw: str) -> str:
    """모델이 JSON 문자열 안의 LaTeX 역슬래시(\\rightarrow, \\times, \\cdot …)를 이스케이프하지 않은 경우를 고친다.
    \\r·\\t·\\n·\\b·\\f 뒤에 영문자가 이어지면 JSON 이스케이프가 아니라 LaTeX 명령으로 보고 역슬래시를 두 배로.
    그 밖의 잘못된 이스케이프(\\c, \\l …)도 두 배로. 정상 이스케이프(\\\\, \\", \\n+한글 등)는 그대로."""
    out, i, n = [], 0, len(raw)
    while i < n:
        c = raw[i]
        if c != "\\" or i + 1 >= n:
            out.append(c); i += 1; continue
        nxt = raw[i + 1]
        if nxt in '"\\/':
            out.append(raw[i:i + 2]); i += 2
        elif nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", raw[i + 2:i + 6] or ""):
            out.append(raw[i:i + 6]); i += 6
        elif nxt in "bfnrt" and not (i + 2 < n and raw[i + 2].isascii() and raw[i + 2].isalpha()):
            out.append(raw[i:i + 2]); i += 2
        else:
            out.append("\\\\"); i += 1
    return "".join(out)


def parse(resp: dict) -> tuple[str, list]:
    ch = resp["choices"][0]
    if ch.get("finish_reason") == "length":
        raise ValueError("토큰 상한에서 잘림")
    d = json.loads(fix_latex_escapes(ch["message"]["content"]))
    exp = str(d.get("explanation") or "").strip()
    if "\\n" in exp:  # 모델이 줄바꿈을 "\n" 글자로 이중 이스케이프한 경우
        exp = re.sub(r"\\n(?![a-zA-Z])", "\n", exp)  # \\neq 같은 LaTeX는 그대로
    if not exp or exp == PLACEHOLDER or "1번" not in exp:
        raise ValueError("해설 형식 이상")
    tags = [str(t).lower().replace("_", " ").strip() for t in (d.get("concept_tags") or []) if str(t).strip()][:6]
    return exp, tags


def load_questions(cur, exam_ids, only_missing=True):
    cur.execute(
        "select q.*, e.title, e.year, e.exam_type, s.name sname from questions q join exams e on e.id=q.exam_id"
        " join subjects s on s.id=e.subject_id where e.id = any(%s) order by e.id, q.question_number", (exam_ids,))
    rows = cur.fetchall()
    if only_missing:
        rows = [r for r in rows if not (r["explanation"] or "").strip() or r["explanation"].strip() == PLACEHOLDER]
    return rows


def generate(args, cur, run_dir: Path):
    endpoint, key_env, default_model = PROVIDERS[args.provider]
    key = os.getenv(key_env, "")
    if not key or "dummy" in key:
        raise SystemExit(f"{key_env}가 없거나 로컬용 가짜 값입니다.")
    args.model = args.model or default_model
    out = run_dir / "results.jsonl"
    done = set()
    if out.exists():
        for l in out.read_text(encoding="utf-8").splitlines():
            r = json.loads(l)
            if r.get("ok"):
                done.add(r["question_id"])
    qs = [q for q in load_questions(cur, args.exam_ids) if q["id"] not in done]
    if args.limit:
        qs = qs[: args.limit]
    print(f"생성 대상 {len(qs)}문항 (이미 성공 {len(done)}), 모델 {args.model}")
    lock, stats = Lock(), {"ok": 0, "fail": 0, "in": 0, "out": 0}

    def work(q):
        rec = {"question_id": q["id"], "subject": q["sname"], "year": q["year"], "exam_type": q["exam_type"],
               "title": q["title"], "qn": q["question_number"], "model": args.model}
        try:
            body = {"model": args.model, "messages": build_messages(q), "response_format": {"type": "json_object"},
                    "max_completion_tokens": args.max_tokens}
            if args.reasoning != "off":
                body["reasoning_effort"] = args.reasoning
            resp = call_api(endpoint, key, body)
            u = resp.get("usage") or {}
            exp, tags = parse(resp)
            rec.update(ok=True, explanation=exp, concept_tags=tags, usage=u)
        except Exception as e:  # noqa: BLE001
            rec.update(ok=False, error=str(e)[:300])
            u = {}
        with lock:
            with out.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            stats["ok" if rec["ok"] else "fail"] += 1
            stats["in"] += u.get("prompt_tokens", 0); stats["out"] += u.get("completion_tokens", 0)
            n = stats["ok"] + stats["fail"]
            if not rec["ok"] or n % 20 == 0 or n == len(qs):
                print(f"  {n}/{len(qs)} 성공 {stats['ok']} 실패 {stats['fail']}" + ("" if rec["ok"] else f" — {rec['title']} Q{rec['qn']}: {rec['error']}"))

    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        list(ex.map(work, qs))
    print(f"완료: 성공 {stats['ok']}, 실패 {stats['fail']}, 토큰 입력 {stats['in']:,} / 출력 {stats['out']:,} → {out}")


def to_sql(args, db, cur, run_dir: Path):
    res = {}
    for l in (run_dir / "results.jsonl").read_text(encoding="utf-8").splitlines():
        r = json.loads(l)
        if r.get("ok"):
            res[r["question_id"]] = r  # 같은 문항이 여러 번이면 마지막 성공분
    if not res:
        raise SystemExit("성공한 결과가 없습니다.")
    lit = lambda s: "'" + str(s).replace("'", "''") + "'"  # noqa: E731
    lines = [f"-- {args.release}: 시험 문항 해설 입력 ({len(res)}문항, 모델 {sorted({r['model'] for r in res.values()})}).",
             "-- 시험 제목·문항 번호로 찾아 해설이 비어 있는 문항만 채움. 기존 해설은 덮어쓰지 않음.", "BEGIN;"]
    for r in sorted(res.values(), key=lambda r: (r["title"], r["qn"])):
        et = "NULL" if r["exam_type"] is None else r["exam_type"]
        lines.append(
            f"UPDATE questions q SET explanation = {lit(r['explanation'])}, concept_tags = {lit(json.dumps(r['concept_tags'], ensure_ascii=False))}::jsonb"
            f" FROM exams e JOIN subjects s ON s.id = e.subject_id WHERE q.exam_id = e.id AND s.name = {lit(r['subject'])}"
            f" AND e.year = {r['year']} AND e.exam_type IS NOT DISTINCT FROM {et} AND e.title = {lit(r['title'])}"
            f" AND q.question_number = {r['qn']}"
            f" AND (q.explanation IS NULL OR TRIM(q.explanation) = '' OR q.explanation = {lit(PLACEHOLDER)});")
        if args.apply_local:
            cur.execute("update questions set explanation=%s, concept_tags=%s where id=%s and (explanation is null or trim(explanation)='' or explanation=%s)",
                        (r["explanation"], json.dumps(r["concept_tags"], ensure_ascii=False), r["question_id"], PLACEHOLDER))
    lines.append("COMMIT;")
    if args.apply_local:
        db.commit()
    rdir = Path(args.release_dir or Path.home() / "qknou-release" / args.release)
    rdir.mkdir(parents=True, exist_ok=True)
    name = f"{args.release.replace('-', '_')}_fill_exam_explanations.sql"
    (rdir / name).write_text("\n".join(lines) + "\n", encoding="utf-8")
    sha = hashlib.sha256((rdir / name).read_bytes()).hexdigest()
    (rdir / "SHA256SUMS").write_text(f"{sha}  {name}\n")
    titles = sorted({r["title"] for r in res.values()})
    (rdir / "RELEASE.md").write_text(f"""# {args.release}

- 작성: {date.today().isoformat()}
- 이미지: 변경 없음
- DB 마이그레이션: 있음 — {name}
- 환경변수 변경: 없음

## 변경 내용
- 시험 {len(titles)}개, {len(res)}문항 해설 입력 (LLM 생성, 그림 문항은 그림 포함해 생성)
- 해설이 비어 있는 문항만 채우는 UPDATE라 기존 해설·다른 데이터는 바뀌지 않음, 앱 재시작 불필요
""", encoding="utf-8")
    print(f"{rdir / name}: {len(res)}문항" + (" (로컬 DB 반영)" if args.apply_local else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["generate", "to-sql"])
    ap.add_argument("--run", required=True, help="결과 폴더 이름 (tmp/explanations/<run>)")
    ap.add_argument("--exam-ids", type=lambda s: [int(x) for x in s.split(",")])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--provider", choices=list(PROVIDERS), default="gemini")
    ap.add_argument("--model", help="기본: gemini-3.8-flash / gpt-5.4-mini")
    ap.add_argument("--reasoning", default="low", help="low|medium|high|off")
    ap.add_argument("--max-tokens", type=int, default=4000)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--release")
    ap.add_argument("--release-dir")
    ap.add_argument("--apply-local", action="store_true")
    ap.add_argument("--env-file", default=".env.development")
    args = ap.parse_args()

    load_env_file(args.env_file)
    db = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    run_dir = Path("tmp/explanations") / args.run
    run_dir.mkdir(parents=True, exist_ok=True)
    if args.cmd == "generate":
        if not args.exam_ids:
            raise SystemExit("--exam-ids 필요")
        generate(args, cur, run_dir)
    else:
        if not args.release:
            raise SystemExit("--release 필요")
        to_sql(args, db, cur, run_dir)


if __name__ == "__main__":
    main()
