#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
  trades: readJson('data/apt-trades-summary.json'),
  subway: readJson('data/subway-seoul-times.json'),
};

sandbox.dashboardSubwayGraph = sandbox.buildDashboardSubwayGraph(payload.subway);
vm.runInContext('dashboardSubwayGraph = globalThis.dashboardSubwayGraph;', sandbox);

const entries = sandbox.buildDashboardSearchIndex(payload);
const entriesByCode = new Map(entries.map(entry => [String(entry.kaptCode), entry]));

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
  const result = sandbox.computeDashboardApartmentGrade(entry, buildInsight(entry));
  return {
    label,
    kaptCode,
    aptName: entry.aptName,
    location: [entry.sigunguName, entry.umdName].filter(Boolean).join(' '),
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
    },
    rawScore: result.scoring.rawScore,
    clampedScore: result.scoring.clampedScore,
    finalGrade: result.grade,
  };
}

const scenarios = [
  ['여의도 공작', 'A15001012'],
  ['판교 푸르지오그랑블', 'A46374606'],
  ['구리 대림한숲', 'A47103203'],
  ['목동 구축 소형', 'A10020839'],
  ['목동 신시가지 대단지', 'A15875103'],
];

const summaries = scenarios.map(([label, kaptCode]) => summarizeScenario(label, kaptCode));
const mokdongSmall = summaries.find(item => item.label === '목동 구축 소형');
const pangyo = summaries.find(item => item.label === '판교 푸르지오그랑블');

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
