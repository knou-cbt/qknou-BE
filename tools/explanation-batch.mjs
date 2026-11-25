#!/usr/bin/env node
/**
 * 해설 없는 문제를 OpenAI Batch API로 생성해서 SQL 릴리스로 넣는 도구.
 * 운영 DB 권한 없이 동작한다 (문제는 공개 API에서 읽고, 결과는 SQL 릴리스로 반영).
 *
 * 데이터 폴더(기본 ~/qknou-release/explanations, 저장소 밖)에 모든 산출물을 둔다.
 *
 *   node tools/explanation-batch.mjs extract                 # 해설 없는 문제 수집 (~30분, 공개 API)
 *   node tools/explanation-batch.mjs build --days 7          # 중복 묶기 + pilot/day-N.jsonl 생성
 *   OPENAI_API_KEY=... node tools/explanation-batch.mjs submit pilot
 *   OPENAI_API_KEY=... node tools/explanation-batch.mjs status
 *   OPENAI_API_KEY=... node tools/explanation-batch.mjs download pilot
 *   node tools/explanation-batch.mjs to-sql pilot --release 20261117-1
 *
 * 옵션: --data <dir>, --model <name>(기본 gpt-5.4-mini), --max-tokens <n>(기본 2000),
 *       --reasoning <effort>(기본 low, 'off'면 안 보냄), --concise(선택지당 2~3문장으로 제한),
 *       --pilot <n>(기본 20)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://www.qknou.kr/api-proxy/api';
const OPENAI = 'https://api.openai.com/v1';
const PLACEHOLDER = '해설을 생성하지 못했습니다.';

// ── 인자 ────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').startsWith('--'));
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const DATA = path.resolve(opt('data', path.join(os.homedir(), 'qknou-release', 'explanations')));
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const P = (...p) => path.join(DATA, ...p);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJsonl = (f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const isMissing = (e) => !e || !String(e).trim() || String(e).trim() === PLACEHOLDER;

// ── 프롬프트 (src/tutor/tutor.service.ts 와 동일 + 공통 지문 포함) ──
function systemPrompt(concise) {
  return `KNOU 기출문제 해설 생성. JSON만 출력.
규칙: 각 선택지를 "N번. 개념명\n설명" 형식으로 작성. 선택지 사이는 빈 줄(\\n\\n)로 구분. 정답/오답 구분 표시 없음. 오답은 틀렸다는 표현 없이 그 개념이 무엇인지만 설명. 영문 명칭이 실제로 존재하는 용어에 한해 "한글발음(English)" 형식으로 표기하고, 한글 전용 개념은 그냥 한글만 쓸 것. 말투는 "~이다, ~때문이다" 체로 간결하게. 이모지 금지.${concise ? '\n각 선택지 설명은 2~3문장 이내.' : ''}
{"explanation":"1번. 개념명\\n설명\\n\\n2번. 개념명\\n설명\\n\\n...","concept_tags":["개념1","개념2"]}
concept_tags: 핵심 학술 개념 2~4개, 소문자, 일반어 제외.`;
}
function userPrompt(q) {
  const choices = (q.choices || []).map((c) => `${c.number}번: ${c.text}`).join('\n');
  return `${q.sharedExample ? `공통 지문: ${q.sharedExample}\n` : ''}문제: ${q.text}${q.example ? `\n보기: ${q.example}` : ''}
선택지:
${choices}
정답: ${(q.correctAnswers || []).join(', ')}번`;
}

// ── extract ─────────────────────────────────────
async function get(p) {
  for (let i = 0; i < 6; i++) {
    await sleep(600); // 공개 API 전역 제한(분당 120) 안쪽
    try {
      const r = await fetch(API + p);
      if (r.status === 429) { await sleep(30_000); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(5_000); }
  }
  return null;
}

async function extract() {
  const subjects = [];
  for (let p = 1; ; p++) {
    const j = await get(`/subjects?page=${p}&limit=100`);
    const s = j?.data?.subjects || [];
    subjects.push(...s);
    if (!s.length || p >= j.data.pagination.totalPages) break;
  }
  const out = fs.createWriteStream(P('questions.jsonl'));
  let exams = 0, total = 0, missing = 0, failedExams = [];
  for (const s of subjects) {
    const ej = await get(`/subjects/${s.id}/exams`);
    for (const e of Array.isArray(ej?.data) ? ej.data : []) {
      exams++;
      const qj = await get(`/exams/${e.id}/questions?mode=study`);
      if (!qj) { failedExams.push(e.id); continue; }
      for (const q of qj.data?.questions || []) {
        total++;
        if (!isMissing(q.explanation)) continue;
        missing++;
        out.write(JSON.stringify({
          id: q.id, examId: e.id, subject: s.name, year: e.year, examType: e.examType,
          number: q.number, text: q.text, example: q.example, sharedExample: q.sharedExample,
          choices: (q.choices || []).map((c) => ({ number: c.number, text: c.text, hasImage: !!c.imageUrls?.length })),
          correctAnswers: q.correctAnswers,
          hasImage: !!(q.imageUrls?.length || q.sharedExampleImageUrls?.length || q.choices?.some((c) => c.imageUrls?.length)),
        }) + '\n');
      }
      if (exams % 200 === 0) console.error(`진행: 시험 ${exams}, 문제 ${total}, 해설 없음 ${missing}`);
    }
  }
  await new Promise((r) => out.end(r));
  const summary = { at: new Date().toISOString(), subjects: subjects.length, exams, total, missing, failedExams };
  fs.writeFileSync(P('extract-summary.json'), JSON.stringify(summary, null, 1));
  console.log(summary);
}

// ── build ───────────────────────────────────────
function groupKey(q) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha1').update(JSON.stringify([
    norm(q.sharedExample), norm(q.text), norm(q.example),
    (q.choices || []).map((c) => [c.number, norm(c.text)]), q.correctAnswers,
  ])).digest('hex').slice(0, 16);
}

function build() {
  const days = Number(opt('days', 7));
  const pilotN = Number(opt('pilot', 20));
  const model = opt('model', 'gpt-5.4-mini');
  const maxTokens = Number(opt('max-tokens', 2000));
  const reasoning = opt('reasoning', 'low');
  const concise = !!opt('concise', false);

  const qs = readJsonl(P('questions.jsonl'));
  // 같은 문제(지문·문제·보기·선택지·정답 동일)는 한 번만 생성
  const groups = new Map();
  for (const q of qs) {
    const k = groupKey(q);
    if (!groups.has(k)) groups.set(k, { key: k, rep: q, ids: [] });
    groups.get(k).ids.push(q.id);
  }
  const list = [...groups.values()].sort((a, b) => a.rep.id - b.rep.id);
  fs.writeFileSync(P('groups.json'), JSON.stringify(Object.fromEntries(list.map((g) => [g.key, g.ids]))));

  const req = (g) => ({
    custom_id: g.key,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      messages: [
        { role: 'system', content: systemPrompt(concise) },
        { role: 'user', content: userPrompt(g.rep) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxTokens,
      ...(reasoning !== 'off' ? { reasoning_effort: reasoning } : {}),
    },
  });

  // pilot: 과목이 겹치지 않게 앞에서부터 골고루
  const seen = new Set(), pilot = [];
  for (const g of list) {
    if (pilot.length >= pilotN) break;
    if (seen.has(g.rep.subject) || g.rep.hasImage) continue;
    seen.add(g.rep.subject); pilot.push(g);
  }
  const pilotKeys = new Set(pilot.map((g) => g.key));
  writeJsonl(P('pilot.jsonl'), pilot.map(req));

  const rest = list.filter((g) => !pilotKeys.has(g.key));
  const per = Math.ceil(rest.length / days);
  for (let d = 0; d < days; d++) {
    const chunk = rest.slice(d * per, (d + 1) * per);
    if (chunk.length) writeJsonl(P(`day-${d + 1}.jsonl`), chunk.map(req));
  }
  const withImage = list.filter((g) => g.rep.hasImage).length;
  const summary = {
    questions: qs.length, uniqueGroups: list.length, dedupSaved: qs.length - list.length,
    withImage, pilot: pilot.length, perDay: per, days, model, maxTokens, reasoning, concise,
  };
  fs.writeFileSync(P('build-summary.json'), JSON.stringify(summary, null, 1));
  console.log(summary);
}

// ── OpenAI Batch ────────────────────────────────
function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) { console.error('OPENAI_API_KEY 환경변수가 필요합니다.'); process.exit(1); }
  return k;
}
async function openai(p, init = {}) {
  const r = await fetch(OPENAI + p, { ...init, headers: { Authorization: `Bearer ${key()}`, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${p} ${r.status}: ${(await r.text()).slice(0, 500)}`);
  return r;
}
const batchesFile = P('batches.json');
const loadBatches = () => (fs.existsSync(batchesFile) ? JSON.parse(fs.readFileSync(batchesFile, 'utf8')) : {});
const saveBatches = (b) => fs.writeFileSync(batchesFile, JSON.stringify(b, null, 1));

async function submit(name) {
  const file = P(`${name}.jsonl`);
  if (!fs.existsSync(file)) throw new Error(`${file} 없음`);
  const batches = loadBatches();
  if (batches[name] && !['failed', 'expired', 'cancelled'].includes(batches[name].status)) {
    throw new Error(`${name}은 이미 제출됨 (${batches[name].id}, ${batches[name].status})`);
  }
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([fs.readFileSync(file)]), `${name}.jsonl`);
  const up = await (await openai('/files', { method: 'POST', body: form })).json();
  const b = await (await openai('/batches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_file_id: up.id, endpoint: '/v1/chat/completions', completion_window: '24h', metadata: { name } }),
  })).json();
  batches[name] = { id: b.id, status: b.status, submittedAt: new Date().toISOString() };
  saveBatches(batches);
  console.log(`제출: ${name} → ${b.id} (${b.status})`);
}

async function status() {
  const batches = loadBatches();
  for (const [name, info] of Object.entries(batches)) {
    const b = await (await openai(`/batches/${info.id}`)).json();
    Object.assign(info, { status: b.status, output_file_id: b.output_file_id, error_file_id: b.error_file_id, counts: b.request_counts });
    console.log(`${name}: ${b.status} ${JSON.stringify(b.request_counts)}`);
  }
  saveBatches(batches);
}

async function download(name) {
  await status();
  const info = loadBatches()[name];
  if (!info) throw new Error(`${name} 제출 기록 없음`);
  if (info.status !== 'completed') throw new Error(`${name}은 아직 ${info.status}`);
  fs.mkdirSync(P('results'), { recursive: true });
  for (const [kind, id] of [['output', info.output_file_id], ['error', info.error_file_id]]) {
    if (!id) continue;
    const txt = await (await openai(`/files/${id}/content`)).text();
    fs.writeFileSync(P('results', `${name}.${kind}.jsonl`), txt);
    console.log(`저장: results/${name}.${kind}.jsonl`);
  }
}

// ── to-sql ──────────────────────────────────────
const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

function toSql(name) {
  const release = opt('release');
  if (!release || release === true) throw new Error('--release YYYYMMDD-n 필요');
  const groups = JSON.parse(fs.readFileSync(P('groups.json'), 'utf8'));
  const rows = readJsonl(P('results', `${name}.output.jsonl`));

  const ok = [], bad = [];
  let inTok = 0, outTok = 0, reasonTok = 0;
  for (const r of rows) {
    const u = r.response?.body?.usage;
    if (u) {
      inTok += u.prompt_tokens || 0; outTok += u.completion_tokens || 0;
      reasonTok += u.completion_tokens_details?.reasoning_tokens || 0;
    }
    try {
      if (r.error || r.response?.status_code !== 200) throw new Error(r.error?.message || `status ${r.response?.status_code}`);
      const choice = r.response.body.choices[0];
      if (choice.finish_reason === 'length') throw new Error('토큰 상한에서 잘림');
      const parsed = JSON.parse(choice.message.content);
      const explanation = String(parsed.explanation || '').trim();
      if (!explanation || explanation === PLACEHOLDER || !/1번/.test(explanation)) throw new Error('해설 형식 이상');
      const tags = (parsed.concept_tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 6);
      const ids = groups[r.custom_id];
      if (!ids) throw new Error('groups.json에 없는 custom_id');
      ok.push({ ids, explanation, tags });
    } catch (e) {
      bad.push({ custom_id: r.custom_id, reason: e.message });
    }
  }

  const dir = path.join(path.dirname(DATA), release);
  fs.mkdirSync(dir, { recursive: true });
  const sqlName = `${release.replace('-', '_')}_fill_explanations_${name}.sql`;
  const lines = [
    `-- ${name}: 해설 일괄 입력 (OpenAI Batch). 해설이 비어 있는 문제만 채움, 기존 해설은 덮어쓰지 않음`,
  ];
  let qCount = 0;
  for (const r of ok) {
    qCount += r.ids.length;
    lines.push(
      `UPDATE questions SET explanation = ${sqlStr(r.explanation)}, concept_tags = ${sqlStr(JSON.stringify(r.tags))}::jsonb` +
      ` WHERE id IN (${r.ids.join(',')}) AND (explanation IS NULL OR TRIM(explanation) = '' OR explanation = ${sqlStr(PLACEHOLDER)});`,
    );
  }
  fs.writeFileSync(path.join(dir, sqlName), lines.join('\n') + '\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, sqlName))).digest('hex');
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${sha}  ${sqlName}\n`);
  fs.writeFileSync(path.join(dir, 'RELEASE.md'), `# ${release}

- 작성: jes, ${new Date().toISOString().slice(0, 10)}
- 이미지: 변경 없음
- DB 마이그레이션: 있음 — ${sqlName}
- 환경변수 변경: 없음

## 변경 내용
- 해설 없는 문제에 해설 입력 (${name}): ${ok.length}개 생성 결과 → 문제 ${qCount}개
- 해설이 비어 있는 문제만 채우는 UPDATE라 기존 해설·다른 데이터는 바뀌지 않음, 앱 재시작 불필요
`);
  if (bad.length) writeJsonl(P('results', `${name}.failed.jsonl`), bad);

  console.log({
    release: dir, sql: sqlName, generated: rows.length, ok: ok.length, questionsFilled: qCount, failed: bad.length,
    tokens: { input: inTok, output: outTok, reasoning: reasonTok, perItem: rows.length ? { input: Math.round(inTok / rows.length), output: Math.round(outTok / rows.length) } : null },
  });
  if (bad.length) console.log(`실패 목록: results/${name}.failed.jsonl (다음 배치에서 retry)`);
}

// ── retry: 실패분만 다시 배치 파일로 ─────────────────
function retry(name) {
  const bad = new Set(readJsonl(P('results', `${name}.failed.jsonl`)).map((r) => r.custom_id));
  const src = readJsonl(P(`${name}.jsonl`)).filter((r) => bad.has(r.custom_id));
  writeJsonl(P(`${name}-retry.jsonl`), src);
  console.log(`${name}-retry.jsonl: ${src.length}건`);
}

const commands = {
  extract, build, status,
  submit: () => submit(positional[0]),
  download: () => download(positional[0]),
  'to-sql': () => toSql(positional[0]),
  retry: () => retry(positional[0]),
};
if (!commands[cmd]) {
  console.error('사용법: extract | build | submit <name> | status | download <name> | to-sql <name> --release <YYYYMMDD-n> | retry <name>');
  process.exit(1);
}
await commands[cmd]();
