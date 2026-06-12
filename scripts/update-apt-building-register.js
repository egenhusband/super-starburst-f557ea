#!/usr/bin/env node
/**
 * 건축물대장 표제부에서 단지별 주용도(오피스텔 판별) + 물리 스펙을 수집.
 *  · 핵심: 주용도 '업무시설'(오피스텔)을 추천에서 제외 (codeAptNm로 못 거른 케이스 보완)
 *  · 부가(저장만): 세대당 주차, 용적률/건폐율, 구조, 층수 — 추후 고도화용
 *
 * 흐름: kaptCode → K-apt 기본정보(kaptAddr=지번) → 건축물대장 표제부 → 집계
 * 입력:  data/apt-recommend-index.json(대상 단지), data/apt-households.json(bjdCode)
 * 출력:  data/apt-building-register.json  { meta, byKapt: { [kaptCode]: {...} } }
 * 키:    MOLIT_API_KEY(기본정보), BLDRGST_API_KEY(건축물대장)
 * 특징:  재개 가능 · 동시성 · 체크포인트
 *
 * 실행:  node scripts/update-apt-building-register.js
 */

const fs = require('fs');
const path = require('path');
try { require('./lib/load-env-local').loadEnvLocal(process.cwd()); } catch (e) { /* optional */ }

const MK = process.env.MOLIT_API_KEY || process.env.MOLIT_HOUSING_API_KEY;
const BK = process.env.BLDRGST_API_KEY;
const BASIS_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4';
const TITLE_URL = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';
const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_PATH = path.join(DATA_DIR, 'apt-building-register.json');

const CONCURRENCY = Number(process.env.APT_BR_CONCURRENCY || 8);
const CHECKPOINT_EVERY = Number(process.env.APT_BR_CHECKPOINT_EVERY || 100);
const MAX_RETRY = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    if (!text.trim().startsWith('{')) throw new Error('non-json: ' + text.slice(0, 40));
    return JSON.parse(text);
  } catch (e) {
    if (attempt < MAX_RETRY) { await sleep(300 * attempt); return getJson(url, attempt + 1); }
    return null;
  }
}

// kaptAddr → 지번(번-지, 4자리 패딩)
function parseJibun(addr) {
  for (const tok of String(addr || '').split(/\s+/)) {
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (m) return { bun: m[1].padStart(4, '0'), ji: (m[2] || '0').padStart(4, '0') };
  }
  return null;
}

async function fetchRegister(kaptCode, bjdCode) {
  // 1) 기본정보로 지번 확보
  const bi = await getJson(`${BASIS_URL}?serviceKey=${encodeURIComponent(MK)}&kaptCode=${kaptCode}&_type=json`);
  const addr = bi?.response?.body?.item?.kaptAddr;
  const jb = parseJibun(addr);
  const code = String(bjdCode || '');
  if (!jb || code.length < 10) return { purps: null, matched: false };

  // 2) 건축물대장 표제부
  const url = `${TITLE_URL}?serviceKey=${encodeURIComponent(BK)}&sigunguCd=${code.slice(0, 5)}&bjdongCd=${code.slice(5, 10)}&platGbCd=0&bun=${jb.bun}&ji=${jb.ji}&numOfRows=50&pageNo=1&_type=json`;
  const j = await getJson(url);
  const it = j?.response?.body?.items?.item;
  const recs = Array.isArray(it) ? it : (it ? [it] : []);
  if (!recs.length) return { purps: null, matched: false };

  // 주거 동 우선(공동주택/아파트), 없으면 첫 동
  const resi = recs.find(r => /공동주택|아파트/.test(r.mainPurpsCdNm || ''));
  const main = resi || recs[0];
  // 부가 스펙(저장만)
  const parking = recs.reduce((s, r) =>
    s + (num(r.indrAutoUtcnt) || 0) + (num(r.indrMechUtcnt) || 0) + (num(r.oudrAutoUtcnt) || 0) + (num(r.oudrMechUtcnt) || 0), 0);
  return {
    matched: true,
    purps: main.mainPurpsCdNm || null,
    parking: parking || null,
    vlRat: num(main.vlRat),
    bcRat: num(main.bcRat),
    strct: main.strctCdNm || null,
    grndFlr: num(main.grndFlrCnt),
    elev: num(main.rideUseElvtCnt),
  };
}

async function main() {
  if (!MK || !BK) { console.error('✗ MOLIT_API_KEY / BLDRGST_API_KEY 필요 (.env.local)'); process.exit(1); }

  const targets = readJson(path.join(DATA_DIR, 'apt-recommend-index.json')).items.map(x => x.kaptCode);
  const hh = readJson(path.join(DATA_DIR, 'apt-households.json')).entries || [];
  const bjdByKapt = {}; hh.forEach(e => { if (e.kaptCode) bjdByKapt[e.kaptCode] = e.bjdCode; });

  let byKapt = {};
  if (fs.existsSync(OUTPUT_PATH)) { try { byKapt = readJson(OUTPUT_PATH).byKapt || {}; } catch (e) { byKapt = {}; } }
  // 미수집 + 직전 실패(매칭 안 됨, 대개 한도 초과로 지번 못 받음)을 재시도
  const todo = targets.filter(c => !byKapt[c] || byKapt[c].matched === false);
  console.log(`▶ 건축물대장 수집 — 대상 ${targets.length} · 완료 ${targets.length - todo.length} · 남음(재시도 포함) ${todo.length}`);

  function save() {
    const dist = {}; let officetel = 0, matched = 0;
    Object.values(byKapt).forEach(v => {
      if (v.matched) matched++;
      if (v.purps) dist[v.purps] = (dist[v.purps] || 0) + 1;
      if (v.purps && /업무시설/.test(v.purps)) officetel++;
    });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
      meta: { generatedAt: new Date().toISOString(), source: 'BldRgstHubService.getBrTitleInfo', count: Object.keys(byKapt).length, matched, officetel, purpsDist: dist },
      byKapt,
    }));
  }

  let done = 0, cursor = 0;
  async function worker() {
    while (cursor < todo.length) {
      const code = todo[cursor++];
      byKapt[code] = await fetchRegister(code, bjdByKapt[code]);
      done++;
      if (done % CHECKPOINT_EVERY === 0) { save(); console.log(`  · ${done}/${todo.length} (체크포인트)`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  const m = readJson(OUTPUT_PATH).meta;
  console.log(`✔ 완료 — ${m.count}개 (매칭 ${m.matched}, 업무시설/오피스텔 ${m.officetel})`);
  console.log('  주용도 분포:', JSON.stringify(m.purpsDist));
}

main();
