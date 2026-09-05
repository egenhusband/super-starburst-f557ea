#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { _private: { buildDashboardSubwayGraph, computeAptGrade } } = require('../netlify/functions/analyze-apt');

const root = process.cwd();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(root, filePath), 'utf8'));
}

function normalizePlaceToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]{}.,·\-_/]/g, '');
}

const sandbox = {
  console,
  window: {},
  document: {},
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  },
  Date,
  Map,
  Set,
  Number,
  String,
  Math,
  RegExp,
  JSON,
  URLSearchParams,
  normalizePlaceToken,
  getCache() { return null; },
  setCache() {},
  fetch: async () => ({ ok: false, json: async () => ({}) }),
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'dashboard-apt-search.js'), 'utf8'), sandbox);

const payload = {
  codeMap: readJson('data/apt-code-map.json'),
  households: readJson('data/apt-households.json'),
  schools: readJson('data/apt-school-meta.json'),
  stationMetas: readJson('data/apt-station-meta.json'),
  officialPrices: readJson('data/apt-official-price-meta.json'),
  convenienceMetas: readJson('data/apt-convenience-meta.json'),
  gradeIndex: fs.existsSync(path.join(root, 'data/apt-grade-index.json'))
    ? readJson('data/apt-grade-index.json')
    : { items: [] },
  trades: readJson('data/apt-trades-summary.json'),
  subway: readJson('data/subway-seoul-times.json'),
};

const dashboardSubwayGraph = buildDashboardSubwayGraph(payload.subway);

const entries = sandbox.buildDashboardSearchIndex(payload);
const entriesByCode = new Map(entries.map(entry => [String(entry.kaptCode), entry]));
const gradesByCode = new Map((payload.gradeIndex.items || []).map(item => [String(item.kaptCode), item]));

function buildInsight(entry) {
  return {
    ready: true,
    station: entry.stationMetaName && Number.isFinite(entry.stationMetaDistance)
      ? { placeName: entry.stationMetaName, distance: entry.stationMetaDistance }
      : null,
    school: entry.schoolName && Number.isFinite(entry.schoolDistance)
      ? { placeName: entry.schoolName, distance: entry.schoolDistance }
      : null,
  };
}

function summarizeScenario(label, kaptCode) {
  const entry = entriesByCode.get(String(kaptCode));
  if (!entry) return { label, kaptCode, error: 'entry not found' };
  const result = computeAptGrade(entry, buildInsight(entry), dashboardSubwayGraph);
  const staticGrade = gradesByCode.get(String(kaptCode));
  const hasMapLocation = Number.isFinite(Number(entry.lat)) && Number.isFinite(Number(entry.lng));
  if (hasMapLocation && !staticGrade) throw new Error(`${label}: 지도/상세 공통 등급 레코드가 없습니다.`);
  if (staticGrade && (entry.grade !== staticGrade.grade || Number(entry.displayScore) !== Number(staticGrade.displayScore))) {
    throw new Error(`${label}: 지도 입력값이 공통 등급 레코드와 다릅니다.`);
  }
  return {
    label,
    kaptCode,
    aptName: entry.aptName,
    location: [entry.sigunguName, entry.umdName].filter(Boolean).join(' '),
    stationDistance: Number(entry.stationMetaDistance || 0) || null,
    tier: result.scoring.tier,
    tierLabel: result.scoring.tierLabel,
    baseScore: result.scoring.baseScore,
    adjustments: {
      transport: {
        score: result.scoring.transport.score,
        raw: result.scoring.transport.raw,
        cap: result.scoring.transport.cap,
        items: result.scoring.transport.items,
      },
      infra: {
        score: result.scoring.infra.score,
        raw: result.scoring.infra.raw,
        cap: result.scoring.infra.cap,
        floor: result.scoring.infra.floor,
        items: result.scoring.infra.items,
      },
      marketPrice: result.scoring.marketPrice,
    },
    rawScore: result.scoring.rawScore,
    clampedScore: result.scoring.clampedScore,
    finalGrade: result.grade,
    canonicalMapAndDetailGrade: staticGrade ? {
      grade: staticGrade.grade,
      displayScore: staticGrade.displayScore,
      withheld: Boolean(staticGrade.withheld),
    } : null,
  };
}

const scenarios = [
  ['여의도 공작', 'A15001012'],
  ['판교 푸르지오그랑블', 'A46374606'],
  ['성남단대푸르지오', 'A46170401'],
  ['하남 미사강변루나리움', 'A10027782'],
  ['하남 창우 부영', 'A46571004'],
  ['구리 인창주공6', 'A47174523'],
  ['산성역 포레스티아', 'A10024631'],
  ['구리 대림한숲', 'A47103203'],
  ['암사 강동현대홈타운', 'A13485301'],
  ['이매동신3단지', 'A46379708'],
  ['목동 구축 소형', 'A10020839'],
  ['목동 신시가지 대단지', 'A15875103'],
];

const summaries = scenarios.map(([label, kaptCode]) => summarizeScenario(label, kaptCode));
const mokdongSmall = summaries.find(item => item.label === '목동 구축 소형');
const pangyo = summaries.find(item => item.label === '판교 푸르지오그랑블');
const inchangJugong = summaries.find(item => item.label === '구리 인창주공6');
const forestia = summaries.find(item => item.label === '산성역 포레스티아');
const dandaePrugio = summaries.find(item => item.label === '성남단대푸르지오');
const daelimHansup = summaries.find(item => item.label === '구리 대림한숲');
const misaLunarium = summaries.find(item => item.label === '하남 미사강변루나리움');
const amsaHyundai = summaries.find(item => item.label === '암사 강동현대홈타운');
const imaedongDongshin3 = summaries.find(item => item.label === '이매동신3단지');

const daelimStationBonus = daelimHansup?.adjustments?.transport?.items?.some(item => item.key === 'station');
if (Number(daelimHansup?.stationDistance) > 350 || !daelimStationBonus) {
  throw new Error('350m 이하인 대림한숲에는 역세권 가점이 적용되어야 합니다.');
}
const inchangStationBonus = inchangJugong?.adjustments?.transport?.items?.some(item => item.key === 'station');
if (Number(inchangJugong?.stationDistance) <= 350 && !inchangStationBonus) {
  throw new Error('350m 이하인 인창주공6단지에는 역세권 가점이 적용되어야 합니다.');
}
if (!(Number(forestia?.clampedScore) > Number(daelimHansup?.clampedScore))) {
  throw new Error('포레스티아의 입지·시장가격 종합점수가 대림한숲보다 높아야 합니다.');
}
if (pangyo?.tier !== 'T2') {
  throw new Error('판교 핵심 생활권 보정이 T2로 적용되어야 합니다.');
}
if (daelimHansup?.tier !== 'T4') {
  throw new Error('구리 수택 생활권 기본 티어가 T4로 유지되어야 합니다.');
}
if (misaLunarium?.tier !== 'T3_PLUS' || misaLunarium?.finalGrade !== 'A') {
  throw new Error('미사 핵심 생활권은 T3+로 분리되어 루나리움이 A 등급이어야 합니다.');
}
if (!(Number(misaLunarium?.clampedScore) > Number(daelimHansup?.clampedScore))) {
  throw new Error('미사강변루나리움은 구리 대림한숲보다 높은 입지 점수를 받아야 합니다.');
}
if (dandaePrugio?.finalGrade !== 'B+') {
  throw new Error('성남단대푸르지오는 가격 중심 기준에서 B+ 등급이어야 합니다.');
}
if (amsaHyundai?.finalGrade !== 'A+' || !(Number(amsaHyundai?.clampedScore) > Number(dandaePrugio?.clampedScore))) {
  throw new Error('암사 강동현대홈타운은 단대푸르지오보다 높은 A+ 등급이어야 합니다.');
}
const canonicalExpectations = [
  [dandaePrugio, 'B+'],
  [misaLunarium, 'A'],
  [daelimHansup, 'B+'],
  [inchangJugong, 'B'],
  [amsaHyundai, 'A'],
  [pangyo, 'A+'],
];
canonicalExpectations.forEach(([scenario, grade]) => {
  if (scenario?.canonicalMapAndDetailGrade?.grade !== grade) {
    throw new Error(`${scenario?.label || '시나리오'}: 지도와 상세 공통 등급은 ${grade}여야 합니다.`);
  }
});
if (!imaedongDongshin3?.canonicalMapAndDetailGrade?.withheld
  || imaedongDongshin3?.canonicalMapAndDetailGrade?.grade
  || imaedongDongshin3?.canonicalMapAndDetailGrade?.displayScore) {
  throw new Error('최근 실거래 가격이 없는 단지는 등급·점수 대신 데이터 취합 중 상태여야 합니다.');
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  scenarios: summaries,
  boundaryChecks: {
    mokdongSmallVsPangyo: {
      left: mokdongSmall?.aptName,
      leftGrade: mokdongSmall?.finalGrade,
      leftScore: mokdongSmall?.clampedScore,
      right: pangyo?.aptName,
      rightGrade: pangyo?.finalGrade,
      rightScore: pangyo?.clampedScore,
      needsTierReview: Number(mokdongSmall?.clampedScore) < Number(pangyo?.clampedScore),
    },
  },
}, null, 2));
