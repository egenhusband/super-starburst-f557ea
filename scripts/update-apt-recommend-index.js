#!/usr/bin/env node
/**
 * 예산 기반 단지 추천용 정적 인덱스 빌드.
 * - 수도권(서울/경기)만 선별 → regionKey 생성
 * - 면적별 실거래가(byArea)를 압축 적재 (필터/정렬=avgPrice, 표시=latestPrice+latestDate)
 * - school/station/households 메타를 kaptCode 기준 조인
 * - analyze-apt의 computeAptGrade를 빌드 타임에 1회 실행해 grade/clampedScore 사전계산
 *
 * 입력:  data/apt-code-map.json, data/apt-area-prices/{kaptCode}.json,
 *        data/apt-households.json, data/apt-school-meta.json,
 *        data/apt-station-meta.json, data/subway-seoul-times.json
 * 출력:  data/apt-recommend-index.json
 *
 * 실행:  node scripts/update-apt-recommend-index.js
 */

const fs = require('fs');
const path = require('path');

const { _private: { buildDashboardSubwayGraph, computeAptGrade } } =
  require('../netlify/functions/analyze-apt');

const DATA_DIR = path.join(__dirname, '..', 'data');
const AREA_DIR = path.join(DATA_DIR, 'apt-area-prices');
const OUTPUT_PATH = path.join(DATA_DIR, 'apt-recommend-index.json');

const CAPITAL_SIDO = new Set(['서울특별시', '경기도']);
const REGION_KEY_BY_SIDO = { 서울특별시: 'seoul', 경기도: 'gyeonggi' };

// 이상치(지분·분양권·오기 등) 제거 기준:
// 같은 시군구 ㎡당 중위가의 일정 비율 미만이면 비정상 거래로 보고 해당 평형을 제외.
// 보수적으로 20%로 잡아 명백한 오류만 거른다 (경기 외곽 저가·소형 정상 거래는 보존).
const ANOMALY_RATIO = 0.20;
const MIN_SGG_SAMPLES = 8; // 시군구 표본이 적으면 중위가 불안정 → 필터 미적용
const MIN_HOUSEHOLD = 500; // 이 세대수 이하 단지는 추천에서 제외 (0이면 미적용)

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildKaptMap(entries, pick) {
  const map = new Map();
  (entries || []).forEach(e => {
    if (e && e.kaptCode) map.set(e.kaptCode, pick(e));
  });
  return map;
}

function parseBuildYear(kaptUsedate) {
  if (!kaptUsedate) return null;
  const y = Number(String(kaptUsedate).slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : null;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTransitWalkDistance(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  if (raw.includes('5분이내')) return 350;
  if (raw.includes('5~10분')) return 600;
  if (raw.includes('10~15분')) return 900;
  if (raw.includes('15~20분')) return 1200;
  if (raw.includes('20분초과')) return 1600;
  return null;
}

function perM2(area, avgPrice) {
  const m2 = parseFloat(area);
  return m2 > 0 ? avgPrice / m2 : null;
}

// byArea(객체) → 압축 areas 배열 + min/max avgPrice (단위: 만원)
// minPerM2: 이상치 하한(㎡당 만원). 이 미만 평형은 비정상 거래로 제외.
function compactAreas(byArea, minPerM2) {
  const areas = [];
  let minAvg = Infinity;
  let maxAvg = -Infinity;
  let removed = 0;

  Object.entries(byArea || {}).forEach(([area, v]) => {
    const avgPrice = toFiniteNumber(v.avgPrice);
    if (avgPrice === null || avgPrice <= 0) return; // 가격 없는 평형은 제외
    const pm = perM2(area, avgPrice);
    if (minPerM2 && pm !== null && pm < minPerM2) { removed += 1; return; } // 이상치 제외
    areas.push({
      area,
      avgPrice,
      latestPrice: toFiniteNumber(v.latestPrice),
      latestDate: v.latestDate || null,
      ...(v.recentHigh?.within3M ? {
        recentHigh: {
          within3M: true,
          label: v.recentHigh.label || '최근 최고가',
          price: toFiniteNumber(v.recentHigh.price),
          date: v.recentHigh.date || null,
          previousHighPrice: toFiniteNumber(v.recentHigh.previousHighPrice),
        },
      } : {}),
    });
    if (avgPrice < minAvg) minAvg = avgPrice;
    if (avgPrice > maxAvg) maxAvg = avgPrice;
  });

  areas.sort((a, b) => a.avgPrice - b.avgPrice);
  return areas.length
    ? { areas, minAvgPrice: minAvg, maxAvgPrice: maxAvg, removed }
    : { areas: [], removed };
}

function main() {
  console.log('▶ 추천 인덱스 빌드 시작');

  // ── 메타 로드 ──
  const codeMap = readJson(path.join(DATA_DIR, 'apt-code-map.json')).items || [];
  const households = readJson(path.join(DATA_DIR, 'apt-households.json')).entries || [];
  const schoolMeta = readJson(path.join(DATA_DIR, 'apt-school-meta.json')).entries || [];
  const stationMeta = readJson(path.join(DATA_DIR, 'apt-station-meta.json')).entries || [];
  const subwayPayload = readJson(path.join(DATA_DIR, 'subway-seoul-times.json'));
  const graph = buildDashboardSubwayGraph(subwayPayload);

  // ── kaptCode 기준 조인용 Map ──
  const houseByKapt = buildKaptMap(households, e => e);
  const schoolByKapt = buildKaptMap(schoolMeta, e => ({
    schoolName: e.schoolName || '',
    schoolDistance: toFiniteNumber(e.schoolDistance),
  }));
  const stationByKapt = buildKaptMap(stationMeta, e => ({
    stationMetaName: e.stationName || '',
    stationMetaDistance: toFiniteNumber(e.stationDistance),
  }));

  // ── 건물 유형 맵 (codeAptNm) — '아파트'만 추천에 포함 ──
  const typePath = path.join(DATA_DIR, 'apt-building-type.json');
  const typeMap = fs.existsSync(typePath) ? (readJson(typePath).types || {}) : null;
  if (!typeMap) console.log('  ⚠ apt-building-type.json 없음 → 유형 필터 미적용 (update-apt-building-type.js 먼저 실행 권장)');

  // 건축물대장 주용도 — '업무시설'(오피스텔) 확정 제외용 (있으면 적용, 미수집 단지는 유지)
  const regPath = path.join(DATA_DIR, 'apt-building-register.json');
  const registerByKapt = fs.existsSync(regPath) ? (readJson(regPath).byKapt || {}) : {};

  // ── 수도권 단지만 선별 ──
  const capital = codeMap.filter(c => CAPITAL_SIDO.has(c.as1));
  console.log(`  · 수도권 단지: ${capital.length} / 전체 ${codeMap.length}`);

  // ── Pass 1: 면적별 가격 로드 + 시군구별 ㎡당 중위가 계산 ──
  const candidates = []; // { c, kaptCode, regionKey, sigunguName, byArea }
  const perM2BySgg = new Map(); // sigunguName → [㎡당 단가]
  let skippedNoPrice = 0;
  let skippedNonApt = 0;

  for (const c of capital) {
    const kaptCode = c.kaptCode;
    // 아파트만 (주상복합·연립·도시형생활주택·다세대·미상 제외)
    if (typeMap && typeMap[kaptCode] !== '아파트') { skippedNonApt += 1; continue; }
    const areaFile = path.join(AREA_DIR, `${kaptCode}.json`);
    if (!fs.existsSync(areaFile)) { skippedNoPrice += 1; continue; }
    const byArea = readJson(areaFile).byArea || {};
    const house = houseByKapt.get(kaptCode) || {};
    const sigunguName = house.sigunguName || c.as2 || '';

    let hasPrice = false;
    Object.entries(byArea).forEach(([area, v]) => {
      const avg = toFiniteNumber(v.avgPrice);
      if (avg === null || avg <= 0) return;
      hasPrice = true;
      const pm = perM2(area, avg);
      if (pm !== null) {
        if (!perM2BySgg.has(sigunguName)) perM2BySgg.set(sigunguName, []);
        perM2BySgg.get(sigunguName).push(pm);
      }
    });
    if (!hasPrice) { skippedNoPrice += 1; continue; }
    candidates.push({ c, kaptCode, regionKey: REGION_KEY_BY_SIDO[c.as1], sigunguName, byArea });
  }

  // 시군구별 ㎡당 중위가 + 이상치 하한(중위 × ANOMALY_RATIO)
  const minPerM2BySgg = new Map();
  perM2BySgg.forEach((arr, sgg) => {
    if (arr.length < MIN_SGG_SAMPLES) return; // 표본 부족 → 필터 미적용
    arr.sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    minPerM2BySgg.set(sgg, median * ANOMALY_RATIO);
  });

  // ── Pass 2: 이상치 제거 + 메타 조인 + 등급 계산 ──
  const index = [];
  let anomalyAreasRemoved = 0;
  let skippedAllAnomalous = 0;
  let skippedNonAptStructural = 0; // 오피스텔/도시형(1동+소형, 또는 명칭)
  let skippedOfficetel = 0; // 건축물대장 주용도=업무시설
  let skippedSmall = 0; // 소규모 단지(세대수 기준)

  for (const cand of candidates) {
    const { kaptCode, regionKey, sigunguName: sgg } = cand;
    const minPerM2 = minPerM2BySgg.get(sgg) || 0;
    const priced = compactAreas(cand.byArea, minPerM2);
    anomalyAreasRemoved += priced.removed || 0;
    if (!priced.areas.length) { skippedAllAnomalous += 1; continue; } // 전 평형이 이상치 → 단지 제외

    const c = cand.c;
    const house = houseByKapt.get(kaptCode) || {};

    // 오피스텔·도시형생활주택 구조적 제외 (codeAptNm이 '아파트'로 잘못 등록된 케이스 보완)
    //  · 1동 + 전 평형 소형(<50㎡) = 오피스텔/도시형 패턴 (59㎡ 소형 아파트·다동 주공은 보존)
    //  · 명칭에 '오피스텔'/'도시형생활주택' 포함
    const maxAreaM2 = Math.max(...priced.areas.map(a => parseFloat(a.area) || 0));
    const dongCnt = toFiniteNumber(house.dongCount);
    const nameRaw = c.kaptName || house.aptName || '';
    if ((dongCnt != null && dongCnt <= 1 && maxAreaM2 < 50) || /오피스텔|도시형\s*생활주택/.test(nameRaw)) {
      skippedNonAptStructural += 1;
      continue;
    }

    // 건축물대장 주용도가 '업무시설'이면 오피스텔 → 제외 (수집된 단지에 한해)
    const reg = registerByKapt[kaptCode];
    if (reg && reg.purps && /업무시설/.test(reg.purps)) { skippedOfficetel += 1; continue; }

    // 소규모 단지 제외 (세대수 기준)
    const hhCnt = toFiniteNumber(house.householdCount);
    if (MIN_HOUSEHOLD > 0 && hhCnt != null && hhCnt <= MIN_HOUSEHOLD) { skippedSmall += 1; continue; }

    const school = schoolByKapt.get(kaptCode) || {};
    const station = stationByKapt.get(kaptCode) || {};

    const sigunguName = house.sigunguName || c.as2 || '';
    const umdName = house.umdName || c.as3 || c.umdName || '';
    const householdCount = toFiniteNumber(house.householdCount);
    const buildYear = parseBuildYear(house.kaptUsedate);
    const schoolDistance = school.schoolDistance ?? null;
    const stationDistance = station.stationMetaDistance ?? parseTransitWalkDistance(house.subwayDistance);

    // computeAptGrade 입력 (가격 레벨은 최고가 평형 avgPrice로 대표)
    const entry = {
      kaptCode,
      aptName: c.kaptName || house.aptName || '',
      sigunguName,
      umdName,
      regionKey,
      householdCount,
      buildYear,
      avgPrice: priced.maxAvgPrice,
      subwayLine: house.subwayLine || '',
      subwayStation: house.subwayStation || '',
      subwayDistance: house.subwayDistance || '',
      stationMetaName: station.stationMetaName || house.subwayStation || '',
      stationMetaDistance: stationDistance,
      schoolName: school.schoolName || '',
      schoolDistance,
    };
    const insight = {
      ready: true,
      station: entry.stationMetaName && Number.isFinite(entry.stationMetaDistance)
        ? { placeName: entry.stationMetaName, distance: entry.stationMetaDistance }
        : null,
      school: entry.schoolName && Number.isFinite(entry.schoolDistance)
        ? { placeName: entry.schoolName, distance: entry.schoolDistance }
        : null,
    };

    const gradeResult = computeAptGrade(entry, insight, graph);

    index.push({
      kaptCode,
      aptName: entry.aptName,
      sigunguName,
      umdName,
      regionKey,
      areas: priced.areas,
      minAvgPrice: priced.minAvgPrice,
      maxAvgPrice: priced.maxAvgPrice,
      grade: gradeResult.grade,
      clampedScore: gradeResult.clampedScore,
      schoolDistance,
      stationDistance,
      stationName: station.stationMetaName || house.subwayStation || null,
      businessDistrict: gradeResult.businessDistrict ? {
        available: Boolean(gradeResult.businessDistrict.available),
        label: gradeResult.businessDistrict.label || '',
        totalMinutes: toFiniteNumber(gradeResult.businessDistrict.totalMinutes),
        bestDistrict: gradeResult.businessDistrict.bestDistrict || null,
      } : null,
      householdCount,
      buildYear,
    });
  }

  // 종합 등급 점수 내림차순 기본 정렬
  index.sort((a, b) => (b.clampedScore || 0) - (a.clampedScore || 0));

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: 'apt-code-map + apt-area-prices + households/school/station meta',
      scope: 'capital (서울/경기)',
      regionKeys: ['seoul', 'gyeonggi'],
      priceUnit: '만원',
      priceBasis: { filterSort: 'avgPrice', display: 'latestPrice + latestDate' },
      anomalyFilter: { ratio: ANOMALY_RATIO, minSggSamples: MIN_SGG_SAMPLES, areasRemoved: anomalyAreasRemoved, complexesExcluded: skippedAllAnomalous },
      typeFilter: { keep: '아파트', excludedByCode: skippedNonApt, excludedByStructure: skippedNonAptStructural, excludedByRegister: skippedOfficetel, applied: !!typeMap },
      minHousehold: { threshold: MIN_HOUSEHOLD, excluded: skippedSmall },
      count: index.length,
      skippedNoPrice,
    },
    items: index,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  const sizeMb = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`  · 아파트 아님(codeAptNm: 주상복합·연립·도시형 등) 제외: ${skippedNonApt}`);
  console.log(`  · 오피스텔/도시형 구조적 제외(1동+소형·명칭): ${skippedNonAptStructural}`);
  console.log(`  · 건축물대장 업무시설(오피스텔) 제외: ${skippedOfficetel}`);
  console.log(`  · 소규모 단지(${MIN_HOUSEHOLD}세대 이하) 제외: ${skippedSmall}`);
  console.log(`  · 가격 없어 제외: ${skippedNoPrice}`);
  console.log(`  · 이상치 평형 제거: ${anomalyAreasRemoved}개 · 전 평형 이상치로 단지 제외: ${skippedAllAnomalous}개`);
  console.log(`✔ 인덱스 ${index.length}개 → ${path.relative(process.cwd(), OUTPUT_PATH)} (${sizeMb} MB)`);
}

main();
