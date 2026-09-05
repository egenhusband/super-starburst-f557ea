const fs = require('fs');
const path = require('path');

const CORE_BUSINESS_DISTRICTS = [
  { key: 'cbd', label: '종로·중구', shortLabel: 'CBD', stationNames: ['광화문역', '종각역', '시청역', '을지로입구역'] },
  { key: 'gbd', label: '강남·서초', shortLabel: 'GBD', stationNames: ['강남역', '역삼역', '선릉역', '삼성역'] },
  { key: 'ybd', label: '여의도', shortLabel: 'YBD', stationNames: ['여의도역', '여의나루역'] },
  { key: 'mbd', label: '마곡', shortLabel: 'MBD', stationNames: ['마곡나루역', '발산역'] },
  { key: 'yongsan', label: '용산국제업무지구', shortLabel: '용산', stationNames: ['용산역', '신용산역'] },
  { key: 'gasan', label: '가산디지털단지', shortLabel: '가산', stationNames: ['가산디지털단지역'] },
  { key: 'seongsu', label: '성수', shortLabel: '성수', stationNames: ['성수역', '뚝섬역'] },
  { key: 'pangyo', label: '판교테크노밸리', shortLabel: '판교', stationNames: ['판교역'] },
];
const JAMSIL_LIVING_DISTRICT = { key: 'jamsil', label: '잠실', stationNames: ['잠실역'] };
const STATION_AREA_MAX_DISTANCE = 350;

const LOCATION_GRADE_SCALE = [
  { grade: 'C', min: 0 },
  { grade: 'C+', min: 1 },
  { grade: 'B', min: 3 },
  { grade: 'B+', min: 6 },
  { grade: 'A', min: 9 },
  { grade: 'A+', min: 12 },
  { grade: 'S', min: 15 },
  { grade: 'S+', min: 18 },
];

const LOCATION_TIER_SCORES = {
  T1: { base: 12, min: 9, max: 18, label: '서울 핵심 입지' },
  T2: { base: 9, min: 9, max: 12, label: '서울 준핵심 입지' },
  T3_PLUS: { base: 7, min: 6, max: 12, label: '경기 핵심 상급 생활권' },
  T3: { base: 6, min: 3, max: 12, label: '서울 일반·경기 핵심 생활권' },
  T4_PLUS: { base: 3, min: 3, max: 10, label: '서울접근 우수 생활권' },
  T4: { base: 1, min: 0, max: 7, label: '서울 외곽·경기 일반 생활권' },
  T5: { base: 0, min: 0, max: 4, label: '경기 외곽 생활권' },
};

const LOCATION_TIER_TRANSPORT_CAPS = {
  T1: 2,
  T2: 3,
  T3_PLUS: 3,
  T3: 3,
  T4_PLUS: 4,
  T4: 4,
  T5: 4,
};

// 평당가를 등급의 주 신호로 쓰되, 생활권은 한 단계 이내의 안전장치로만 쓴다.
// 점수 상한은 해당 등급의 다음 경계 바로 아래 값이다.
const LOCATION_TIER_MARKET_GUARDRAILS = {
  T1: { score: 17.99, context: 1.0 },
  T2: { score: 14.99, context: 0.5 },
  T3_PLUS: { score: 14.99, context: 0.4 },
  T3: { score: 11.99, context: 0.0 },
  T4_PLUS: { score: 8.99, context: 0.15 },
  T4: { score: 8.99, context: 0.0 },
  T5: { score: 5.99, context: -0.5 },
};

const SEOUL_ACCESS_UPLIFT_LINES = /신분당|GTX|8호선|9호선|경의중앙|별내선/u;

const NINE_LINE_944_BENEFIT_NAMES = [
  '미사강변리슈빌nhf',
  '미사강변센트리버',
  '미사강변스타힐스',
  '미사강변리버뷰자이',
  '미사강변도시베라체아파트',
  '미사강변대원칸타빌',
  '미사강변루나리움',
  '미사강변2차푸르지오',
  '미사강변더샵리버포레아파트',
  '미사강변한신휴플러스',
  '리버나인',
  '리버나인rivernine',
];
const NINE_LINE_944_BENEFIT_CODES = new Set(['A10026523', 'A10028065']);

let subwayGraphCache = null;
let locationTierOverridesCache = null;

function resolveDataFile(relativePath) {
  const candidates = [
    path.join(process.cwd(), relativePath),
    path.join(__dirname, '..', '..', relativePath),
    path.join(__dirname, relativePath),
  ];
  const found = candidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Missing data file: ${relativePath}`);
  }
  return found;
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function normalizePlaceToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()[\]{}.,·\-_/]/g, '');
}

function loadLocationTierOverrides() {
  if (locationTierOverridesCache) return locationTierOverridesCache;
  try {
    const payload = JSON.parse(fs.readFileSync(resolveDataFile('data/location-tier-overrides.json'), 'utf8'));
    locationTierOverridesCache = Array.isArray(payload?.overrides) ? payload.overrides : [];
  } catch (_) {
    locationTierOverridesCache = [];
  }
  return locationTierOverridesCache;
}

function matchesPlaceToken(value, candidates) {
  const normalizeAdministrativeName = input => normalizePlaceToken(input)
    // 원본에는 '성남분당구'처럼 시가 생략된 행정명이 있어, 구 앞의 '시'만 선택적으로 무시한다.
    .replace(/시(?=[가-힣]*구$|$)/gu, '');
  const normalized = normalizeAdministrativeName(value);
  return (candidates || []).some(candidate => normalized.includes(normalizeAdministrativeName(candidate)));
}

function applyLivingZoneTierOverride(entry, baseTier) {
  const sigungu = entry?.sigunguName || '';
  const umd = entry?.umdName || '';
  const override = loadLocationTierOverrides().find(item => (
    matchesPlaceToken(sigungu, item.sigungu)
    && (!Array.isArray(item.umd) || item.umd.length === 0 || matchesPlaceToken(umd, item.umd))
  ));
  if (!override || !LOCATION_TIER_SCORES[override.targetTier]) return baseTier;
  return {
    tier: override.targetTier,
    label: override.label || LOCATION_TIER_SCORES[override.targetTier].label,
    overriddenFrom: baseTier.tier,
    overrideId: override.id,
  };
}

function normalizeStationToken(value) {
  return String(value || '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+(?:\d+호선|신분당선|수인분당선|분당선|경의중앙선|경강선|공항철도공항선|공항철도|우이신설선|서해선|인천1호선|인천2호선)$/u, '')
    .replace(/\s+/g, '')
    .replace(/역$/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
}

function normalizeLineToken(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^서울/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('수인분당') || normalized.includes('분당')) return '분당선';
  if (normalized.includes('경의중앙')) return '경의중앙선';
  if (normalized.includes('경강')) return '경강선';
  if (normalized.includes('공항철도')) return '공항철도';
  if (normalized === '9호선' || normalized === '9') return '9호선';
  if (normalized === '8호선' || normalized === '8') return '8호선';
  return normalized;
}

function parseStationNameCandidates(rawValue) {
  return String(rawValue || '').split(/[,/]/).map(value => value.trim()).filter(Boolean);
}

function parseLineNameCandidates(rawValue) {
  return String(rawValue || '').split(/[,/]/).map(value => value.trim()).filter(Boolean);
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

function parseTransitWalkMinutes(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  if (raw.includes('5분이내')) return 4;
  if (raw.includes('5~10분')) return 8;
  if (raw.includes('10~15분')) return 13;
  if (raw.includes('15~20분')) return 18;
  if (raw.includes('20분초과')) return 24;
  return null;
}

function buildDashboardSubwayGraph(payload) {
  const stationMap = new Map();
  const nameToStationIds = new Map();
  const adjacency = new Map();

  (payload?.stations || []).forEach(station => {
    stationMap.set(station.id, station);
    const token = normalizeStationToken(station.stationNameNormalized || station.stationName);
    const current = nameToStationIds.get(token) || [];
    current.push(station.id);
    nameToStationIds.set(token, current);
  });

  function connect(from, to, minutes, type) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, minutes, type });
  }

  (payload?.edges || []).forEach(edge => {
    const minutes = Number(edge.minutes);
    if (!edge?.from || !edge?.to || !Number.isFinite(minutes)) return;
    connect(edge.from, edge.to, minutes, edge.type || 'ride');
    connect(edge.to, edge.from, minutes, edge.type || 'ride');
  });

  return { stationMap, nameToStationIds, adjacency };
}

function loadSubwayGraph() {
  if (subwayGraphCache) return subwayGraphCache;
  const filePath = resolveDataFile(path.join('data', 'subway-seoul-times.json'));
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  subwayGraphCache = buildDashboardSubwayGraph(payload);
  return subwayGraphCache;
}

function hasSubwayGraphStationMatch(graph, rawValue) {
  return parseStationNameCandidates(rawValue)
    .map(normalizeStationToken)
    .filter(Boolean)
    .some(token => (graph.nameToStationIds.get(token) || []).length > 0);
}

function estimateWalkMinutesToStation(entry, insight) {
  if (Number.isFinite(insight?.station?.distance)) {
    return Math.max(1, Math.round(Number(insight.station.distance) / 80));
  }
  return parseTransitWalkMinutes(entry?.subwayDistance);
}

function findShortestGraphMinutes(graph, originIds, targetIds) {
  const distances = new Map();
  const queue = [];

  originIds.forEach(id => {
    distances.set(id, 0);
    queue.push({ id, minutes: 0 });
  });

  const targetSet = new Set(targetIds);
  while (queue.length) {
    queue.sort((a, b) => a.minutes - b.minutes);
    const current = queue.shift();
    if (!current) break;
    if (current.minutes !== distances.get(current.id)) continue;
    if (targetSet.has(current.id)) return { stationId: current.id, minutes: current.minutes };

    (graph.adjacency.get(current.id) || []).forEach(edge => {
      const nextMinutes = current.minutes + edge.minutes;
      if (nextMinutes < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextMinutes);
        queue.push({ id: edge.to, minutes: nextMinutes });
      }
    });
  }

  return null;
}

function hasNineLineBenefitCandidate(entry) {
  if (entry?.kaptCode && NINE_LINE_944_BENEFIT_CODES.has(String(entry.kaptCode))) return true;
  const name = normalizePlaceToken(entry?.aptName || '');
  return NINE_LINE_944_BENEFIT_NAMES.some(candidate => name.includes(candidate));
}

function getPriceLevelSource(entry) {
  if (Number.isFinite(entry?.avgPrice)) return 'trade-average';
  if (Number.isFinite(entry?.latestTradePrice)) return 'trade-latest';
  if (Number.isFinite(entry?.medianOfficialPrice)) return 'official-fallback';
  return null;
}

function computeNewBuildScore(buildYear) {
  if (!Number.isFinite(buildYear)) return { score: 6, label: '준공 정보 일부만 확보' };
  const age = new Date().getFullYear() - buildYear;
  if (age <= 5) return { score: 12, label: '신축 기준에 들어오는 단지' };
  if (age <= 10) return { score: 10, label: '준신축으로 관리 기대감이 있는 편' };
  if (age <= 15) return { score: 8, label: '연식은 있지만 비교적 최근 공급 축' };
  return { score: 6, label: '연식은 있지만 입지 비교가 더 중요한 단지' };
}

function computeHouseholdScore(householdCount) {
  if (!Number.isFinite(householdCount) || householdCount <= 0) return { score: 5, label: '세대수 정보 확보 중' };
  if (householdCount >= 1500) return { score: 8, label: '대단지 스케일이 강점' };
  if (householdCount >= 1000) return { score: 7, label: '규모감이 있는 단지' };
  if (householdCount >= 500) return { score: 6, label: '중형 이상 단지로 보기 좋은 규모' };
  if (householdCount >= 200) return { score: 5, label: '도심 핵심지에서 보기 드문 희소 규모' };
  return { score: 4, label: '소규모 단지에 가까운 편' };
}

function computeStationScore(distance) {
  if (!Number.isFinite(distance)) return { score: 6, label: '역 접근성 계산 중' };
  if (distance <= STATION_AREA_MAX_DISTANCE) return { score: 25, label: '역세권 기준에 들어오는 거리' };
  return { score: 0, label: '역세권 가점 기준 밖의 거리' };
}

function computeSchoolScore(distance) {
  if (!Number.isFinite(distance)) return { score: 8, label: '초등학교 도보권 확인 중' };
  if (distance <= 300) return { score: 36, label: '초등학교 도보권이 매우 가까운 거리' };
  if (distance <= 500) return { score: 32, label: '초등학교 도보 접근성이 좋은 편' };
  if (distance <= 700) return { score: 24, label: '가까운 초등학교 접근성이 무난한 편' };
  if (distance <= 1000) return { score: 16, label: '통학 거리가 아주 짧지는 않은 편' };
  return { score: 6, label: '초등학교 접근성은 비교가 필요한 편' };
}

function computePriceLevelScore(entry) {
  const priceSource = getPriceLevelSource(entry);
  const priceCandidates = [
    Number(entry?.avgPrice || 0) || null,
    Number(entry?.latestTradePrice || 0) || null,
    Number(entry?.medianOfficialPrice || 0) || null,
    Number(entry?.avgOfficialPrice || 0) || null,
  ].filter(Number.isFinite);
  const priceLevel = priceCandidates.length ? Math.max(...priceCandidates) : null;

  if (!priceSource || !Number.isFinite(priceLevel)) return { score: 8, label: '가격 레벨 보강 중' };
  if (priceLevel >= 200000) return { score: 30, label: '20억 이상 초고가 아파트로 볼 수 있는 가격대' };
  if (priceLevel >= 150000) return { score: 25, label: '15억 이상 상급지 가격대가 확인되는 단지' };
  if (priceLevel >= 100000) return { score: 20, label: '10억 이상으로 가격 레벨이 탄탄한 편' };
  if (priceLevel >= 70000) return { score: 16, label: '수도권 상위권 가격대에 가까운 편' };
  if (priceLevel >= 50000) return { score: 12, label: '중상위권 가격대가 형성된 편' };
  return { score: 8, label: '가격 레벨은 비교가 더 필요한 편' };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gradeFromLocationScore(score) {
  let grade = 'C';
  LOCATION_GRADE_SCALE.forEach(item => {
    if (score >= item.min) grade = item.grade;
  });
  return grade;
}

function computePublicLocationScore(grade, clampedScore) {
  const gradeBands = {
    C: [50, 58],
    'C+': [59, 63],
    B: [64, 69],
    'B+': [70, 74],
    A: [75, 82],
    'A+': [83, 89],
    S: [90, 95],
    'S+': [96, 99],
  };
  const band = gradeBands[grade] || gradeBands.C;
  const gradeFloor = (LOCATION_GRADE_SCALE.find(item => item.grade === grade)?.min) ?? 0;
  const nextFloor = LOCATION_GRADE_SCALE.find(item => item.min > gradeFloor)?.min ?? 18;
  const progress = nextFloor === gradeFloor
    ? 1
    : clampNumber((clampedScore - gradeFloor) / (nextFloor - gradeFloor), 0, 1);
  return Math.round(band[0] + ((band[1] - band[0]) * progress));
}

function toPublicAptGradeResult(result) {
  const displayScore = result.withheld ? null : computePublicLocationScore(result.grade, result.clampedScore);
  return {
    ok: true,
    ready: result.ready,
    kaptCode: result.kaptCode,
    grade: result.grade,
    displayScore,
    scoreLabel: Number.isFinite(displayScore) ? `${displayScore}점` : '',
    tierLabel: result.tierLabel,
    businessDistrict: result.businessDistrict,
    reasons: result.reasons,
    withheld: result.withheld,
    missingCount: result.missingCount,
  };
}

function getLocationTier(entry) {
  const sigungu = normalizePlaceToken(entry?.sigunguName || '');
  const umd = normalizePlaceToken(entry?.umdName || '');
  const aptName = normalizePlaceToken(entry?.aptName || '');
  const isSeoul = entry?.regionKey === 'seoul'
    || ['강남구', '서초구', '송파구', '용산구', '마포구', '성동구', '양천구', '영등포구', '광진구', '동작구', '노원구', '도봉구', '강북구', '중랑구'].some(name => sigungu.includes(normalizePlaceToken(name)));
  const isGyeonggi = entry?.regionKey === 'gyeonggi' || !isSeoul;

  if (isSeoul) {
    if (
      ['강남구', '서초구', '송파구', '용산구'].some(name => sigungu.includes(normalizePlaceToken(name)))
      || (sigungu.includes('영등포구') && umd.includes('여의도'))
      || (sigungu.includes('성동구') && (umd.includes('성수') || umd.includes('옥수')))
      || (sigungu.includes('용산구') && (umd.includes('한남') || umd.includes('이촌') || umd.includes('서빙고')))
      || (sigungu.includes('마포구') && (umd.includes('아현') || umd.includes('공덕')))
    ) {
      return { tier: 'T1', label: LOCATION_TIER_SCORES.T1.label };
    }
    if (
      ['양천구', '성동구', '마포구', '광진구', '동작구'].some(name => sigungu.includes(normalizePlaceToken(name)))
      || (sigungu.includes('영등포구') && !umd.includes('여의도'))
      || (sigungu.includes('노원구') && (umd.includes('중계') || umd.includes('상계')))
    ) {
      return { tier: 'T2', label: LOCATION_TIER_SCORES.T2.label };
    }
    if (['도봉구', '강북구', '중랑구'].some(name => sigungu.includes(normalizePlaceToken(name)))) {
      return { tier: 'T4', label: LOCATION_TIER_SCORES.T4.label };
    }
    return { tier: 'T3', label: LOCATION_TIER_SCORES.T3.label };
  }

  if (isGyeonggi) {
    if (
      (sigungu.includes('성남분당구') && (umd.includes('백현') || umd.includes('삼평') || umd.includes('판교') || aptName.includes('판교')))
      || sigungu.includes('과천')
      || (sigungu.includes('성남분당구') && ['정자동', '수내동', '이매동', '서현동'].some(name => umd.includes(normalizePlaceToken(name))))
      || (sigungu.includes('수원영통구') && (umd.includes('광교') || aptName.includes('광교')))
      || sigungu.includes('안양')
      || sigungu.includes('수원')
      || sigungu.includes('용인')
      || sigungu.includes('고양')
      || sigungu.includes('성남')
      || sigungu.includes('하남')
      || sigungu.includes('부천')
      || sigungu.includes('광명')
    ) {
      return { tier: 'T3', label: LOCATION_TIER_SCORES.T3.label };
    }
    if (
      sigungu.includes('구리')
      || sigungu.includes('남양주')
      || sigungu.includes('김포')
      || sigungu.includes('의정부')
      || sigungu.includes('군포')
      || sigungu.includes('의왕')
      || sigungu.includes('시흥')
      || sigungu.includes('화성')
      || sigungu.includes('평택')
      || sigungu.includes('파주')
    ) {
      return { tier: 'T4', label: LOCATION_TIER_SCORES.T4.label };
    }
  }

  return { tier: 'T5', label: LOCATION_TIER_SCORES.T5.label };
}

function refineLocationTierByAccess(entry, locationTier, stationDistance) {
  const sigungu = normalizePlaceToken(entry?.sigunguName || '');
  const stationText = normalizePlaceToken(`${entry?.stationMetaName || ''} ${entry?.subwayStation || ''}`);

  if (
    sigungu.includes('하남')
    && stationText.includes('하남검단산')
    && Number.isFinite(stationDistance)
    && stationDistance <= STATION_AREA_MAX_DISTANCE
  ) {
    return { tier: 'T4_PLUS', label: LOCATION_TIER_SCORES.T4_PLUS.label, adjustedFrom: locationTier.tier };
  }

  return locationTier;
}

function computeBusinessDistrictScore(entry, insight, graph) {
  if (!graph) {
    return { available: false, score: 0, label: '서울 지하철 시간 데이터 준비 중', bestDistrict: null, totalMinutes: null };
  }

  const stationTokens = [
    ...parseStationNameCandidates(insight?.station?.placeName),
    ...parseStationNameCandidates(entry?.subwayStation),
  ].map(normalizeStationToken).filter(Boolean);

  if (!stationTokens.length) {
    return { available: false, score: 0, label: '가까운 역 정보를 먼저 확인하고 있어요.', bestDistrict: null, totalMinutes: null };
  }

  const walkMinutes = estimateWalkMinutesToStation(entry, insight);
  const lineTokens = new Set(parseLineNameCandidates(entry?.subwayLine).map(normalizeLineToken).filter(Boolean));
  const shouldRestrictLineMatch = lineTokens.size > 0 && hasSubwayGraphStationMatch(graph, entry?.subwayStation);
  const originIds = [];

  stationTokens.forEach(token => {
    const stationIds = graph.nameToStationIds.get(token) || [];
    stationIds.forEach(stationId => {
      const station = graph.stationMap.get(stationId);
      const lineToken = normalizeLineToken(station?.lineName);
      if (!shouldRestrictLineMatch || lineTokens.has(lineToken)) originIds.push(stationId);
    });
  });

  const dedupedOriginIds = [...new Set(originIds)];
  if (!dedupedOriginIds.length) {
    return { available: false, score: 0, label: '서울 지하철 노선망과 가까운 역 매칭을 보강 중이에요.', bestDistrict: null, totalMinutes: null };
  }

  const candidates = [];
  CORE_BUSINESS_DISTRICTS.forEach(district => {
    const targetIds = district.stationNames.flatMap(name => {
      const token = normalizeStationToken(name);
      return graph.nameToStationIds.get(token) || [];
    });
    if (!targetIds.length) return;
    const pathResult = findShortestGraphMinutes(graph, dedupedOriginIds, targetIds);
    if (!pathResult) return;
    const totalMinutes = pathResult.minutes + (Number.isFinite(walkMinutes) ? walkMinutes : 0);
    candidates.push({ district, path: pathResult, totalMinutes });
  });

  candidates.sort((a, b) => a.totalMinutes - b.totalMinutes);
  const bestCandidate = candidates[0] || null;
  if (!bestCandidate) {
    return {
      available: false,
      score: 0,
      label: '대표역 도착 시간을 계산할 서울 구간 데이터가 아직 부족해요.',
      bestDistrict: null,
      totalMinutes: null,
      candidates: [],
    };
  }

  const totalMinutes = Math.max(1, Math.round(bestCandidate.totalMinutes));
  const topCandidates = candidates.slice(0, 2).map(candidate => ({
    district: {
      key: candidate.district.key,
      label: candidate.district.label,
      shortLabel: candidate.district.shortLabel,
    },
    totalMinutes: Math.max(1, Math.round(candidate.totalMinutes)),
  }));
  const score = totalMinutes <= 20 ? 25
    : totalMinutes <= 30 ? 22
      : totalMinutes <= 40 ? 17
        : totalMinutes <= 50 ? 11
          : 6;

  return {
    available: true,
    score,
    label: `${bestCandidate.district.label} 대표역까지 예상 ${totalMinutes}분`,
    bestDistrict: {
      key: bestCandidate.district.key,
      label: bestCandidate.district.label,
      shortLabel: bestCandidate.district.shortLabel,
    },
    totalMinutes,
    candidates: topCandidates,
  };
}

// 잠실은 전 단지의 업무지구 점수에는 포함하지 않고, 구리 생활권 비교에만 사용한다.
function computeJamsilLivingAccess(entry, insight, graph) {
  if (!graph) return { available: false, label: '잠실 접근 시간 데이터 준비 중', totalMinutes: null };
  const stationTokens = [
    ...parseStationNameCandidates(insight?.station?.placeName),
    ...parseStationNameCandidates(entry?.subwayStation),
  ].map(normalizeStationToken).filter(Boolean);
  if (!stationTokens.length) return { available: false, label: '가까운 역 정보를 먼저 확인하고 있어요.', totalMinutes: null };

  const walkMinutes = estimateWalkMinutesToStation(entry, insight);
  const lineTokens = new Set(parseLineNameCandidates(entry?.subwayLine).map(normalizeLineToken).filter(Boolean));
  const shouldRestrictLineMatch = lineTokens.size > 0 && hasSubwayGraphStationMatch(graph, entry?.subwayStation);
  const originIds = [];
  stationTokens.forEach(token => {
    (graph.nameToStationIds.get(token) || []).forEach(stationId => {
      const station = graph.stationMap.get(stationId);
      if (!shouldRestrictLineMatch || lineTokens.has(normalizeLineToken(station?.lineName))) originIds.push(stationId);
    });
  });
  const targetIds = JAMSIL_LIVING_DISTRICT.stationNames.flatMap(name => (
    graph.nameToStationIds.get(normalizeStationToken(name)) || []
  ));
  const pathResult = findShortestGraphMinutes(graph, [...new Set(originIds)], targetIds);
  if (!pathResult) return { available: false, label: '잠실 접근 시간 데이터 준비 중', totalMinutes: null };
  const totalMinutes = Math.max(1, Math.round(pathResult.minutes + (Number.isFinite(walkMinutes) ? walkMinutes : 0)));
  return { available: true, label: `잠실 대표역까지 예상 ${totalMinutes}분`, totalMinutes };
}

function computeTransportAdjustment(entry, stationDistance, businessDistrictResult, tier, jamsilLivingAccess = null) {
  const items = [];
  const isStationArea = Number.isFinite(stationDistance) && stationDistance <= STATION_AREA_MAX_DISTANCE;
  if (isStationArea) items.push({ key: 'station', points: 2, label: '역세권 기준에 들어오는 거리' });
  const isGuri = normalizePlaceToken(entry?.sigunguName || '').includes('구리');
  const access = isGuri ? jamsilLivingAccess : businessDistrictResult;
  if (Number.isFinite(access?.totalMinutes)) {
    const key = isGuri ? 'jamsil' : 'business';
    if (access.totalMinutes <= 30) items.push({ key, points: 2, label: access.label });
    else if (!isGuri && access.totalMinutes <= 35) items.push({ key, points: 1, label: access.label });
  }
  const lineText = `${entry?.subwayLine || ''} ${entry?.stationMetaName || ''} ${entry?.subwayStation || ''}`;
  // 350m까지는 역세권 기본 가점만 적용하고, 핵심 노선 추가 보정은 300m 이내에서만 준다.
  const isCoreStationArea = Number.isFinite(stationDistance) && stationDistance <= 300;
  if (isCoreStationArea && (/신분당|GTX|8호선|9호선/u.test(lineText) || hasNineLineBenefitCandidate(entry))) {
    items.push({ key: 'line', points: 1, label: '핵심 노선 접근성 보정' });
  }
  const raw = items.reduce((sum, item) => sum + item.points, 0);
  const cap = LOCATION_TIER_TRANSPORT_CAPS[tier] || LOCATION_TIER_TRANSPORT_CAPS.T5;
  return { score: Math.min(raw, cap), raw, cap, items };
}

function computeInfraAdjustment(entry, schoolDistance) {
  const items = [];
  if (Number.isFinite(schoolDistance)) {
    if (schoolDistance <= 400) items.push({ key: 'school', points: 1, label: '초등학교 도보권이 가까운 편' });
    else if (schoolDistance >= 900) items.push({ key: 'school', points: -1, label: '초등학교 도보권은 비교가 필요한 편' });
  }
  if (Number.isFinite(entry?.householdCount)) {
    if (entry.householdCount >= 1000) items.push({ key: 'household', points: 2, label: '대단지 스케일이 강점' });
    else if (entry.householdCount >= 700) items.push({ key: 'household', points: 1, label: '중형 이상 단지 규모' });
    else if (entry.householdCount > 0 && entry.householdCount < 200) items.push({ key: 'household', points: -1, label: '소규모 단지에 가까운 편' });
  }
  if (Number.isFinite(entry?.buildYear)) {
    const age = new Date().getFullYear() - entry.buildYear;
    if (age <= 10) items.push({ key: 'newBuild', points: 1, label: '준신축 이상 연식 보정' });
    else if (age >= 35) items.push({ key: 'oldBuild', points: -1, label: '노후 단지 보정' });
  }
  const convenienceCount = [entry?.convenienceDept, entry?.convenienceMart, entry?.conveniencePark].filter(Boolean).length;
  if (convenienceCount >= 2) items.push({ key: 'convenience', points: 1, label: '생활편의 인프라가 확인되는 단지' });
  const raw = items.reduce((sum, item) => sum + item.points, 0);
  return { score: clampNumber(raw, -2, 2), raw, cap: 2, floor: -2, items };
}

function computeMarketPositionScore(entry) {
  const recentPercentile = entry?.capitalRecentPricePerPyeongPercentile;
  if (Number.isFinite(recentPercentile) && recentPercentile >= 0 && recentPercentile <= 1) {
    const score = recentPercentile >= 0.95 ? 15
      : recentPercentile >= 0.90 ? 12
        : recentPercentile >= 0.80 ? 9
          : recentPercentile >= 0.73 ? 6.5
            : recentPercentile >= 0.60 ? 4.5
              : recentPercentile >= 0.45 ? 1.5
                : 0;
    return {
      score,
      source: 'recent-trade-pyeong-percentile',
      percentile: recentPercentile,
      confidence: 'high',
      label: '수도권 최근 실거래 평당가 백분위를 등급의 주요 기준으로 반영했어요.',
    };
  }

  const recentPricePerPyeong = Number(entry?.recentPricePerPyeong);
  const capitalMedianPricePerPyeong = Number(entry?.capitalMedianPricePerPyeong);
  if (
    Number.isFinite(recentPricePerPyeong)
    && recentPricePerPyeong > 0
    && Number.isFinite(capitalMedianPricePerPyeong)
    && capitalMedianPricePerPyeong > 0
  ) {
    const ratio = recentPricePerPyeong / capitalMedianPricePerPyeong;
    const score = ratio >= 2.0 ? 15
      : ratio >= 1.6 ? 12
        : ratio >= 1.3 ? 9
          : ratio >= 1.1 ? 6.5
            : ratio >= 0.9 ? 4.5
              : ratio >= 0.75 ? 3.5
                : ratio >= 0.55 ? 1.5
                  : 0;
    return {
      score,
      source: 'recent-trade-pyeong',
      ratio,
      confidence: 'high',
      label: '최근 실거래 평당가를 등급의 주요 기준으로 반영했어요.',
    };
  }

  const percentile = entry?.capitalOfficialPricePerPyeongPercentile;
  if (Number.isFinite(percentile) && percentile >= 0 && percentile <= 1) {
    const score = percentile >= 0.95 ? 15
      : percentile >= 0.85 ? 12
        : percentile >= 0.77 ? 9
          : percentile >= 0.72 ? 6.5
            : percentile >= 0.65 ? 4.5
              : percentile >= 0.60 ? 3.5
                : percentile >= 0.40 ? 1.5
                  : 0;
    return {
      score,
      source: 'official-pyeong-percentile',
      percentile,
      confidence: 'fallback',
      label: '실거래 평당가가 부족해 수도권 공시가격 평당가로 보완했어요.',
    };
  }

  return { score: 0, source: null, confidence: 'none', label: '평당가 비교 데이터 보강 중' };
}

function getPreviousGradeCeiling(grade) {
  const index = LOCATION_GRADE_SCALE.findIndex(item => item.grade === grade);
  if (index <= 0) return LOCATION_GRADE_SCALE[0].min;
  const currentFloor = LOCATION_GRADE_SCALE[index].min;
  return currentFloor - 0.01;
}

function getCurrentGradeCeiling(grade) {
  const index = LOCATION_GRADE_SCALE.findIndex(item => item.grade === grade);
  const nextFloor = LOCATION_GRADE_SCALE[index + 1]?.min;
  return Number.isFinite(nextFloor) ? nextFloor - 0.01 : 18.99;
}

function computeSupportingLocationAdjustment(locationTier, transportAdjustment, infraAdjustment) {
  const guardrail = LOCATION_TIER_MARKET_GUARDRAILS[locationTier] || LOCATION_TIER_MARKET_GUARDRAILS.T5;
  // 보조 항목은 시장 가격이 만든 등급 안에서 순서만 조정한다.
  const transport = Math.min(Number(transportAdjustment?.score || 0), 3) / 3 * 1.2;
  const infra = clampNumber(Number(infraAdjustment?.score || 0) * 0.4, -0.8, 0.8);
  const score = clampNumber(guardrail.context + transport + infra, -1, 2);
  return { score, transport, infra, context: guardrail.context };
}

function qualifiesSeoulAccessUplift(entry, stationDistance, businessDistrictResult, schoolDistance) {
  if (normalizePlaceToken(entry?.sigunguName || '').includes('구리')) return false;
  if (!Number.isFinite(stationDistance) || stationDistance > STATION_AREA_MAX_DISTANCE) return false;
  if (!businessDistrictResult?.available
    || !Number.isFinite(businessDistrictResult.totalMinutes)
    || businessDistrictResult.totalMinutes > 35) return false;

  const lineText = `${entry?.subwayLine || ''} ${entry?.stationMetaName || ''} ${entry?.subwayStation || ''}`;
  if (!SEOUL_ACCESS_UPLIFT_LINES.test(lineText) && !hasNineLineBenefitCandidate(entry)) return false;

  const householdCount = Number(entry?.householdCount);
  const schoolOk = Number.isFinite(schoolDistance) && schoolDistance <= 500;
  const householdOk = Number.isFinite(householdCount) && householdCount >= 700;
  return schoolOk && householdOk;
}

function computeAptGrade(entry, insight, graph) {
  const businessDistrictResult = computeBusinessDistrictScore(entry, insight, graph);
  const jamsilLivingAccess = normalizePlaceToken(entry?.sigunguName || '').includes('구리')
    ? computeJamsilLivingAccess(entry, insight, graph)
    : null;
  const stationDistance = Number.isFinite(insight?.station?.distance)
    ? Number(insight.station.distance)
    : parseTransitWalkDistance(entry?.subwayDistance);
  const schoolDistance = Number.isFinite(insight?.school?.distance)
    ? Number(insight.school.distance)
    : (Number.isFinite(Number(entry?.schoolDistance)) && Number(entry.schoolDistance) > 0 ? Number(entry.schoolDistance) : null);
  const priceLevelSource = getPriceLevelSource(entry);
  const priceLevelResult = computePriceLevelScore(entry);
  const hasOfficialFallback = priceLevelSource === 'official-fallback';
  const baseLocationTier = getLocationTier(entry);
  let locationTier = refineLocationTierByAccess(
    entry,
    applyLivingZoneTierOverride(entry, baseLocationTier),
    stationDistance,
  );
  if (locationTier.tier === 'T4' && qualifiesSeoulAccessUplift(entry, stationDistance, businessDistrictResult, schoolDistance)) {
    locationTier = { tier: 'T4_PLUS', label: LOCATION_TIER_SCORES.T4_PLUS.label, upliftFrom: 'T4' };
  }
  const tierScore = LOCATION_TIER_SCORES[locationTier.tier] || LOCATION_TIER_SCORES.T5;
  const transportAdjustment = computeTransportAdjustment(
    entry,
    stationDistance,
    businessDistrictResult,
    locationTier.tier,
    jamsilLivingAccess,
  );
  const infraAdjustment = computeInfraAdjustment(entry, schoolDistance);
  const marketPriceAdjustment = computeMarketPositionScore(entry);
  const dimensions = [
    { key: 'priceLevel', available: priceLevelSource !== null, result: priceLevelResult },
    { key: 'school', available: Number.isFinite(schoolDistance), result: computeSchoolScore(schoolDistance) },
    { key: 'station', available: Number.isFinite(stationDistance), result: computeStationScore(stationDistance) },
    { key: 'businessDistrict', available: businessDistrictResult.available, result: businessDistrictResult },
    { key: 'household', available: Number.isFinite(entry.householdCount) && entry.householdCount > 0, result: computeHouseholdScore(entry.householdCount) },
    { key: 'newBuild', available: Number.isFinite(entry.buildYear), result: computeNewBuildScore(entry.buildYear) },
  ];
  const missingLabels = dimensions
    .filter(item => !item.available)
    .map(item => item.key === 'priceLevel'
      ? '가격 레벨'
      : item.key === 'school'
        ? '초등학교 거리'
        : item.key === 'station'
          ? '역 거리'
          : item.key === 'household'
            ? '세대수'
            : item.key === 'newBuild'
              ? '준공 정보'
              : '업무지구 접근성');
  if (!marketPriceAdjustment.source) {
    return {
      ready: true,
      kaptCode: entry.kaptCode || '',
      grade: '',
      tier: locationTier.tier,
      tierLabel: locationTier.label,
      baseScore: tierScore.base,
      rawScore: null,
      clampedScore: null,
      transportAdjustment,
      infraAdjustment,
      marketPriceAdjustment,
      businessDistrict: businessDistrictResult,
      reasons: [
        `${locationTier.label}으로 분류했어요.`,
        '최근 실거래 평당가를 취합 중이라 등급과 점수는 표기하지 않아요.',
      ],
      withheld: true,
      missingCount: missingLabels.length + 1,
      scoring: {
        tier: locationTier.tier,
        tierLabel: locationTier.label,
        transport: transportAdjustment,
        infra: infraAdjustment,
        marketPrice: marketPriceAdjustment,
        jamsilLivingAccess,
      },
    };
  }
  const locationScore = tierScore.base + transportAdjustment.score + infraAdjustment.score;
  const locationClampedScore = clampNumber(locationScore, tierScore.min, tierScore.max);
  const marketGrade = gradeFromLocationScore(marketPriceAdjustment.score);
  const locationAdjustment = computeSupportingLocationAdjustment(
    locationTier.tier,
    transportAdjustment,
    infraAdjustment,
  );
  const rawScore = marketPriceAdjustment.score + locationAdjustment.score;
  const guardrail = LOCATION_TIER_MARKET_GUARDRAILS[locationTier.tier] || LOCATION_TIER_MARKET_GUARDRAILS.T5;
  // 광역·생활권 상한은 시장 가격이 만든 등급을 최대 한 단계만 낮출 수 있다.
  // 역·학교·단지 규모는 같은 등급 안에서만 점수 순서를 바꾼다.
  const oneBandGuardrail = Math.max(guardrail.score, getPreviousGradeCeiling(marketGrade));
  const maxScore = Math.min(getCurrentGradeCeiling(marketGrade), oneBandGuardrail);
  const clampedScore = clampNumber(rawScore, 0, maxScore);
  const grade = gradeFromLocationScore(clampedScore);
  const primaryTransportReason = transportAdjustment.items.find(item => item.key === 'jamsil')
    || transportAdjustment.items.slice().sort((a, b) => b.points - a.points)[0];
  const reasons = [
    locationTier.overriddenFrom
      ? `${locationTier.label} 기준으로 시군구 기본 생활권을 세분화했어요.`
      : locationTier.upliftFrom
      ? '서울 접근성과 생활 인프라가 좋아 등급 범위를 넓혔어요.'
      : locationTier.adjustedFrom
        ? '같은 시군구 안에서도 실제 역 위치와 업무지구 접근성을 기준으로 등급 범위를 다시 잡았어요.'
      : `${locationTier.label} 기준으로 기본 등급 범위를 먼저 잡았어요.`,
    ...(primaryTransportReason ? [primaryTransportReason.label] : []),
    ...(infraAdjustment.items.length ? [infraAdjustment.items.slice().sort((a, b) => b.points - a.points)[0].label] : []),
    ...(marketPriceAdjustment.source ? [marketPriceAdjustment.label] : []),
    ...(hasOfficialFallback ? ['실거래 커버리지가 얇아 가격 레벨은 공시가격으로 우선 보완했어요.'] : []),
    ...(missingLabels.length ? [`아직 ${missingLabels.join(', ')} 데이터는 순차 보강 중이에요.`] : []),
  ];

  return {
    ready: true,
    kaptCode: entry.kaptCode || '',
    grade,
    tier: locationTier.tier,
    tierLabel: locationTier.label,
    baseScore: tierScore.base,
    rawScore,
    clampedScore,
    transportAdjustment,
    infraAdjustment,
    marketPriceAdjustment,
    businessDistrict: businessDistrictResult,
    reasons: reasons.slice(0, 3),
    withheld: false,
    missingCount: missingLabels.length,
    scoring: {
      tier: locationTier.tier,
      tierLabel: locationTier.label,
      baseScore: tierScore.base,
      tierMin: tierScore.min,
      tierMax: tierScore.max,
      transport: transportAdjustment,
      infra: infraAdjustment,
      marketPrice: marketPriceAdjustment,
      marketGrade,
      locationAdjustment,
      marketGuardrail: {
        maxScore,
        tierMaxScore: guardrail.score,
        oneBandFloor: getPreviousGradeCeiling(marketGrade),
        marketBandMaxScore: getCurrentGradeCeiling(marketGrade),
      },
      jamsilLivingAccess,
      locationScore: locationClampedScore,
      rawScore,
      clampedScore,
    },
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    const entry = payload.entry || payload;
    const insight = payload.insight || {
      ready: true,
      station: entry.stationMetaName && Number.isFinite(Number(entry.stationMetaDistance))
        ? { placeName: entry.stationMetaName, distance: Number(entry.stationMetaDistance) }
        : null,
      school: entry.schoolName && Number.isFinite(Number(entry.schoolDistance))
        ? { placeName: entry.schoolName, distance: Number(entry.schoolDistance) }
        : null,
    };
    if (!entry?.kaptCode && !entry?.aptName) return jsonResponse(400, { ok: false, error: 'Apartment entry is required.' });
    const graph = loadSubwayGraph();
    return jsonResponse(200, toPublicAptGradeResult(computeAptGrade(entry, insight, graph)));
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message || 'Apartment analysis failed.' });
  }
};

exports._private = {
  buildDashboardSubwayGraph,
  computeAptGrade,
  computePublicLocationScore,
  applyLivingZoneTierOverride,
};
