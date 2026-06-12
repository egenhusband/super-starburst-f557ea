#!/usr/bin/env node
/**
 * 수도권(서울/경기) 공동주택의 건물 유형(codeAptNm)을 K-apt 기본정보 API에서 수집.
 * 추천 인덱스가 "아파트만" 필터링할 수 있도록 kaptCode → codeAptNm 맵을 만든다.
 *   codeAptNm 예: "아파트" / "주상복합" / "연립주택" / "도시형생활주택" 등
 *
 * 입력:  data/apt-code-map.json
 * 출력:  data/apt-building-type.json  { meta, types: { [kaptCode]: codeAptNm } }
 * 특징:  재개 가능(이미 받은 건 건너뜀) · 동시성 · 주기적 체크포인트
 *
 * 실행:  node scripts/update-apt-building-type.js
 */

const fs = require('fs');
const path = require('path');
try { require('./lib/load-env-local').loadEnvLocal(process.cwd()); } catch (e) { /* optional */ }

const KEY = process.env.MOLIT_API_KEY || process.env.MOLIT_HOUSING_API_KEY;
const BASIS_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'apt-building-type.json');

const CAPITAL_SIDO = new Set(['서울특별시', '경기도']);
const CONCURRENCY = Number(process.env.APT_TYPE_CONCURRENCY || 12);
const CHECKPOINT_EVERY = Number(process.env.APT_TYPE_CHECKPOINT_EVERY || 200);
const MAX_RETRY = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

async function fetchType(kaptCode, attempt = 1) {
  const url = `${BASIS_URL}?serviceKey=${encodeURIComponent(KEY)}&kaptCode=${kaptCode}&_type=json`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const json = JSON.parse(text);
    const item = json?.response?.body?.item;
    return item && item.codeAptNm ? String(item.codeAptNm) : '(미상)';
  } catch (e) {
    if (attempt < MAX_RETRY) { await sleep(300 * attempt); return fetchType(kaptCode, attempt + 1); }
    return null; // 실패 → 다음 실행에서 재시도
  }
}

async function main() {
  if (!KEY) { console.error('✗ MOLIT_API_KEY 없음 (.env.local 확인)'); process.exit(1); }

  const codeMap = readJson(path.join(DATA_DIR, 'apt-code-map.json')).items || [];
  const targets = codeMap.filter(c => CAPITAL_SIDO.has(c.as1)).map(c => c.kaptCode);

  // 기존 결과 로드 (재개)
  let types = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    try { types = readJson(OUTPUT_PATH).types || {}; } catch (e) { types = {}; }
  }
  const todo = targets.filter(code => !types[code]);
  console.log(`▶ 건물유형 수집 — 대상 ${targets.length} · 기수집 ${targets.length - todo.length} · 남음 ${todo.length}`);

  let done = 0;
  function save() {
    const dist = {};
    Object.values(types).forEach(v => { dist[v] = (dist[v] || 0) + 1; });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      meta: { generatedAt: new Date().toISOString(), source: 'AptBasisInfoServiceV4.codeAptNm', scope: 'capital', count: Object.keys(types).length, distribution: dist },
      types,
    }));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const code = todo[cursor++];
      const t = await fetchType(code);
      if (t) types[code] = t;
      done++;
      if (done % CHECKPOINT_EVERY === 0) { save(); console.log(`  · ${done}/${todo.length} 수집 (체크포인트 저장)`); }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  const dist = {};
  Object.values(types).forEach(v => { dist[v] = (dist[v] || 0) + 1; });
  console.log(`✔ 완료 — 총 ${Object.keys(types).length}개 → ${path.relative(process.cwd(), OUTPUT_PATH)}`);
  console.log('  분포:', JSON.stringify(dist));
}

main();
