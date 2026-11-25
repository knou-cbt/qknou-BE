#!/usr/bin/env python3
"""OCR 레이아웃 기준으로 시험 문항의 그림·텍스트를 다시 구성한다 (DB는 바꾸지 않음).

스캔 PDF를 OCR(Chandra)로 파싱하면 그림이 영어 설명문(![..](..) …), 마크다운 표, [그림] 같은
텍스트로 들어가거나, 그림이 엉뚱한 문항에 붙는 문제가 있다. 이 스크립트는
ocr-page-layout.py로 받은 레이아웃(블록 종류·위치)을 따라
- 그림/표/코드/수식 블록 → 원본 PDF에서 200dpi로 잘라 문항·공통보기·선택지 그림으로 다시 연결
- OCR 잔해가 있는 문항은 문제 문장·보기·선택지 텍스트도 레이아웃 기준으로 다시 만든다
- 정답·문항 번호·해설은 그대로 둔다. 선택지에 이미 그림이 있으면(수동 크롭 등) 유지한다

사용 예 (로컬 DB의 exam id):
  DATABASE_URL=postgresql://... python3 src/scripts/rebuild-exam-figures.py 5 6 7
결과: tmp/figure-fix/<시험>/{crops/*.png, plan.json} — 변경안과 "확인필요" 목록을 출력한다.
다음 단계: apply-exam-figures.py (R2 업로드 + DB 반영 + 운영 UPDATE SQL)

필요 패키지: pymupdf psycopg2-binary
"""
import argparse
import json, os, re, html as H
from pathlib import Path
import pymupdf as fitz, psycopg2, psycopg2.extras

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("exam_ids", nargs="+", type=int)
ap.add_argument("--repo", default=".", help="저장소 루트 (tmp/pdf-validate, refs/가 있는 곳)")
ap.add_argument("--layout-dir", default="tmp/pdf-layout")
ap.add_argument("--out-dir", default="tmp/figure-fix")
args = ap.parse_args()
repo, ocr_root, out_root = Path(args.repo), Path(args.layout_dir), Path(args.out_dir)
exam_ids = args.exam_ids
db = psycopg2.connect(os.environ["DATABASE_URL"])
cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

FIG = {"Table", "Figure", "Picture", "Code", "Equation", "Form", "Diagram", "ComplexRegion", "Caption"}
SKIP = {"PageHeader", "PageFooter", "SectionHeader", "Footnote"}
CIRC = "①②③④"
Q_RE = re.compile(r"^\s*(\d{1,2})\s*[.．]\s*")
SH_RE = re.compile(r"^\s*※")
RANGE_RE = re.compile(r"\(\s*(\d{1,2})\s*[~∼～\-]\s*(\d{1,2})\s*\)")
JUNK = re.compile(r"<sub>|!\[|^\s*\|.*\|\s*$|\[그림\]|```|<t[dhr]|<table|graph TD|\s\|\s*$|^\s*\|", re.M)
SUBS = str.maketrans("0123456789+-", "₀₁₂₃₄₅₆₇₈₉₊₋")


def h2t(s):
    s = s or ""
    maths = []
    def _m(m):
        maths.append(f"${H.unescape(m.group(1)).strip()}$")
        return f"\x00{len(maths)-1}\x00"
    s = re.sub(r"<math[^>]*>(.*?)</math>", _m, s, flags=re.S)
    s = re.sub(r"<sub>(.*?)</sub>", lambda m: m.group(1).translate(SUBS) if re.fullmatch(r"[0-9+\-]+", m.group(1)) else "_" + m.group(1), s)
    s = re.sub(r"<sup>(.*?)</sup>", r"^\1", s)
    s = re.sub(r"<br\s*/?>|</p>\s*<p[^>]*>|</li>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = H.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s)
    s = re.sub(r" *\n *", "\n", s).strip()
    s = re.sub(r"\x00(\d+)\x00", lambda m: maths[int(m.group(1))], s)
    return s


def junk(v):
    if v is None:
        return False
    if isinstance(v, list):
        return any(junk(c.get("text")) for c in v)
    return bool(JUNK.search(v))


def as_crops(v):
    """이미 반영된 R2 URL(.../v2/<파일>)을 crops/<파일>로 바꿔, 다시 돌려도 같은 그림이면 변경 없음으로 본다."""
    if isinstance(v, str):
        m = re.search(r"/exam-images/[^/]+/v2/([^/]+)$", v)
        return f"crops/{m.group(1)}" if m else v
    if isinstance(v, list):
        return [as_crops(x) for x in v]
    if isinstance(v, dict):
        return {k: as_crops(x) for k, x in v.items()}
    return v


def split_choices(text):
    parts = re.split(f"([{CIRC}])", text)
    out = {}
    for i in range(1, len(parts) - 1, 2):
        out[CIRC.index(parts[i]) + 1] = parts[i + 1].strip()
    return out


for eid in exam_ids:
    cur.execute("select title from exams where id=%s", (eid,))
    title = cur.fetchone()["title"]
    vd = repo / "tmp/pdf-validate" / title
    doc = fitz.open(repo / json.loads((vd / "report.json").read_text())["pdf_path"])
    cur.execute("select * from questions where exam_id=%s order by question_number", (eid,))
    rows = {r["question_number"]: r for r in cur.fetchall()}
    qmin, qmax = min(rows), max(rows)
    out = out_root / title
    (out / "crops").mkdir(parents=True, exist_ok=True)

    Q = {}       # n -> dict(stem, extra[], choices{}, figs[(pi,bbox)], choice_figs{k:[(pi,bbox)]}, shared=(a,b))
    SH = {}      # (a,b) -> dict(text[], figs[])
    owner = None
    phase = None
    last_shared = None
    for pi in range(len(doc)):
        page = json.loads((ocr_root / title / f"page_{pi+1:02d}" / "page.json").read_text())["children"][0]
        W, Hh = page["bbox"][2], page["bbox"][3]
        for b in page.get("children") or []:
            bt = b["block_type"]
            if bt in SKIP:
                continue
            t = h2t(b.get("html"))
            rel = (b["bbox"][0] / W, b["bbox"][1] / Hh, b["bbox"][2] / W, b["bbox"][3] / Hh)
            ms, mq = SH_RE.match(t), Q_RE.match(t)
            if bt == "Text" and ms:
                mr = RANGE_RE.search(t)
                if mr and int(mr.group(2)) - int(mr.group(1)) > 10:  # (1~35) 같은 과목 범위 → 공통보기 아님
                    owner = None
                    continue
                if mr:
                    key = (int(mr.group(1)), int(mr.group(2)))
                else:  # 범위 표기가 없으면 DB의 공통보기 텍스트로 범위 추정
                    head = re.sub(r"\s+", "", t)[:20]
                    hit = sorted(n for n, r in rows.items() if r["shared_example"] and re.sub(r"\s+", "", r["shared_example"])[:20] == head)
                    if not hit:  # 범위도 DB 근거도 없음(시험 안내문 등) → 무시
                        owner = None
                        continue
                    key = (hit[0], hit[-1])
                SH[key] = {"text": [t], "figs": []}
                owner, phase, last_shared = ("S", key), "stem", key
                continue
            if bt == "Text" and mq and qmin <= int(mq.group(1)) <= qmax and int(mq.group(1)) not in Q:
                n = int(mq.group(1))
                sh = sorted((k for k in SH if k[0] <= n <= k[1]), key=lambda k: (k[0], -k[1])) or None
                Q[n] = {"stem": t[mq.end():].strip(), "extra": [], "choices": {}, "figs": [], "choice_figs": {}, "shared": sh}
                owner, phase = ("Q", n), "stem"
                continue
            if owner is None:
                continue
            if owner[0] == "S":
                if bt in FIG:
                    SH[owner[1]]["figs"].append((pi, rel))
                elif bt in ("Text", "ListGroup"):
                    SH[owner[1]]["text"].append(t)
                continue
            q = Q[owner[1]]
            if bt == "ListGroup" and "⑤" in t and phase == "stem":
                q["extra"].append(t)  # ①~⑤… 는 선택지가 아니라 지문 목록
            elif bt == "ListGroup":
                q["choices"].update(split_choices(t))
                phase = "after"
            elif bt in FIG:
                nums = [CIRC.index(c) + 1 for c in re.findall(f"[{CIRC}]", t[:2] + "".join(re.findall(f"(?:^|\\n|\\s{{2,}})([{CIRC}])", t)))]
                lead = t[:1] in CIRC
                if lead:
                    nums = sorted(set(CIRC.index(c) + 1 for c in re.findall(f"[{CIRC}]", t)))
                    if len(nums) == 2:  # 좌우 두 개짜리 → 가운데로 나눔
                        x0, y0, x1, y1 = rel; xm = (x0 + x1) / 2
                        q["choice_figs"].setdefault(nums[0], []).append((pi, (x0, y0, xm, y1)))
                        q["choice_figs"].setdefault(nums[1], []).append((pi, (xm, y0, x1, y1)))
                        q.setdefault("warn", []).append("선택지 그림 좌우 분할")
                    else:
                        for k in nums[:1]:
                            q["choice_figs"].setdefault(k, []).append((pi, rel))
                        if len(nums) > 2:
                            q.setdefault("warn", []).append(f"선택지 그림 한 블록에 {len(nums)}개")
                elif phase == "stem":
                    q["figs"].append((pi, rel))
                else:
                    q.setdefault("warn", []).append(f"선택지 뒤 {bt} 블록 무시")
            elif bt == "Text":
                if phase == "stem":
                    q["extra"].append(t)
                elif split_choices(t):
                    q["choices"].update(split_choices(t))

    def crop(regs, name):
        files = []
        by = {}
        for pi, bb in regs:
            col = "F" if bb[2] - bb[0] > 0.6 else ("L" if (bb[0] + bb[2]) / 2 < 0.5 else "R")
            by.setdefault((pi, col), []).append(bb)
        for k, ((pi, _col), bbs) in enumerate(sorted(by.items())):
            p = doc[pi]; R = p.rect; pad = 5
            x0 = min(b[0] for b in bbs); y0 = min(b[1] for b in bbs); x1 = max(b[2] for b in bbs); y1 = max(b[3] for b in bbs)
            clip = fitz.Rect(x0 * R.width - pad, y0 * R.height - pad, x1 * R.width + pad, y1 * R.height + pad) & R
            fn = f"{name}{'' if k == 0 else f'_{k+1}'}.png"
            p.get_pixmap(clip=clip, dpi=200).save(out / "crops" / fn)
            files.append(f"crops/{fn}")
        return files or None

    shared_imgs = {k: crop(v["figs"], f"shared_{k[0]:02d}-{k[1]:02d}") for k, v in SH.items()}
    plan, issues = [], []
    for n, r in rows.items():
        q = Q.get(n)
        if not q:
            issues.append((n, "레이아웃에서 문항을 못 찾음 — 변경 안 함")); continue
        new = {}
        all_choice_img = all(c.get("imageUrls") for c in r["choices"]) and not any(q["choice_figs"].values())
        if all_choice_img and q["figs"]:
            q.setdefault("warn", []).append("선택지가 모두 기존 그림 → 문항 그림 블록은 선택지 묶음으로 보고 제외")
            q["figs"] = []
        new["question_image_urls"] = crop(q["figs"], f"q{n:03d}")
        new["shared_example_image_urls"] = [u for k in (q["shared"] or []) for u in (shared_imgs.get(k) or [])] or None
        shared_text = "\n".join(t for k in (q["shared"] or []) for t in SH[k]["text"]) or None
        cf = {k: crop(v, f"q{n:03d}_c{k}") for k, v in q["choice_figs"].items()}
        broken = any(junk(r[c]) for c in ("question_text", "example_text", "shared_example")) or junk(r["choices"])
        # 이미지 있는 선택지는 항상 레이아웃 기준
        db_cimg = {c["number"]: c for c in r["choices"] if c.get("imageUrls")}
        for k in db_cimg:
            if k not in cf:
                cf[k] = "KEEP"
        only_in_image = not q["choices"] and not cf and (q["figs"] or new["shared_example_image_urls"])
        choices = []
        ok_choices = only_in_image or len(set(q["choices"]) | set(cf)) == len(r["choices"])
        for c in r["choices"]:
            k = c["number"]
            text = q["choices"].get(k, "") if (broken or k in cf) else c.get("text")
            if cf.get(k) == "KEEP":
                choices.append(db_cimg[k]); continue
            if k in cf:
                text = text if text and not JUNK.search(text) else ""
            if only_in_image and broken:
                text = CIRC[k - 1]
            choices.append({"text": text, "number": k, "imageUrls": cf.get(k)})
        if broken:
            if not q["stem"] or not ok_choices:
                issues.append((n, f"잔해 있으나 재구성 불완전(stem={bool(q['stem'])}, choices={sorted(set(q['choices'])|set(cf))}) — 텍스트 유지, 그림만 교체"))
                choices = [c if cf.get(c["number"]) in (None, "KEEP") else {"text": c.get("text"), "number": c["number"], "imageUrls": cf[c["number"]]} for c in r["choices"]]
            else:
                new["question_text"] = q["stem"]
                new["example_text"] = "\n".join(q["extra"]) or None
                if q["shared"]:
                    new["shared_example"] = shared_text
                elif r["shared_example"]:
                    issues.append((n, "DB엔 공통보기가 있는데 레이아웃에서 못 찾음 — 공통보기 텍스트 유지"))
        new["choices"] = choices
        if q["shared"] and not r["shared_example"] and "shared_example" not in new:
            new["shared_example"] = shared_text
        if r["shared_example"] and not q["shared"]:
            new.pop("shared_example_image_urls", None)
            issues.append((n, "공통보기 범위 미검출 — 공통보기 그림 기존 유지"))
        for w in q.get("warn", []):
            issues.append((n, w))
        changed = {k: v for k, v in new.items() if v != as_crops(r[k])}
        if changed:
            plan.append({"qn": n, "id": r["id"], "broken": broken, "new": changed, "old": {k: r[k] for k in changed}})
    (out / "plan.json").write_text(json.dumps({"exam_id": eid, "title": title, "plan": plan, "issues": issues}, ensure_ascii=False, indent=1, default=str))
    nb = sum(p["broken"] for p in plan)
    print(f"{title}: 변경 {len(plan)}문항(텍스트 재구성 {nb}), 확인필요 {len(issues)}")
    for i in issues:
        print("   !", i)
