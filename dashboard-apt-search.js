const DASHBOARD_APT_CODE_MAP_URL = '/data/apt-code-map.json?v=20260506b';
const DASHBOARD_APT_HOUSEHOLDS_URL = '/data/apt-households.json?v=20260506b';
const DASHBOARD_APT_SCHOOL_META_URL = '/data/apt-school-meta.json?v=20260507a';
const DASHBOARD_APT_STATION_META_URL = '/data/apt-station-meta.json?v=20260518a';
const DASHBOARD_APT_OFFICIAL_PRICE_META_URL = '/data/apt-official-price-meta.json?v=20260517a';
const DASHBOARD_APT_CONVENIENCE_META_URL = '/data/apt-convenience-meta.json?v=20260518a';
const DASHBOARD_SUBWAY_TIMES_URL = '/data/subway-seoul-times.json?v=20260517b';
const DASHBOARD_APT_SEARCH_CACHE_KEY = 'dashboard_apt_search_index_v11';
const DASHBOARD_APT_SEARCH_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const DASHBOARD_SUBWAY_TIMES_CACHE_KEY = 'dashboard_subway_times_v5';
const DASHBOARD_SUBWAY_TIMES_CACHE_TTL = 90 * 24 * 60 * 60 * 1000;
const CORE_BUSINESS_DISTRICTS = [
  {
    key: 'cbd',
    label: '종로·중구',
    shortLabel: 'CBD',
    stationNames: ['광화문역', '종각역', '시청역', '을지로입구역'],
  },
  {
    key: 'gbd',
    label: '강남·서초',
    shortLabel: 'GBD',
    stationNames: ['강남역', '역삼역', '선릉역', '삼성역'],
  },
  {
    key: 'ybd',
    label: '여의도',
    shortLabel: 'YBD',
    stationNames: ['여의도역', '여의나루역'],
  },
  {
    key: 'mbd',
    label: '마곡',
    shortLabel: 'MBD',
    stationNames: ['마곡나루역', '발산역'],
  },
  {
    key: 'yongsan',
    label: '용산국제업무지구',
    shortLabel: '용산',
    stationNames: ['용산역', '신용산역'],
  },
  {
    key: 'gasan',
    label: '가산디지털단지',
    shortLabel: '가산',
    stationNames: ['가산디지털단지역'],
  },
  {
    key: 'seongsu',
    label: '성수',
    shortLabel: '성수',
    stationNames: ['성수역', '뚝섬역'],
  },
  {
    key: 'pangyo',
    label: '판교테크노밸리',
    shortLabel: '판교',
    stationNames: ['판교역'],
  },
];

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
  T3: { base: 6, min: 3, max: 9, label: '서울 일반·경기 핵심 생활권' },
  T4: { base: 1, min: 0, max: 6, label: '서울 외곽·경기 일반 생활권' },
  T5: { base: 0, min: 0, max: 3, label: '경기 외곽 생활권' },
};

const LOCATION_TIER_TRANSPORT_CAPS = {
  T1: 2,
  T2: 3,
  T3: 3,
  T4: 4,
  T5: 4,
};

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
const NINE_LINE_944_BENEFIT_CODES = new Set([
  'A10026523', // 미사강변리슈빌NHF
  'A10028065', // 미사강변도시 베라체 아파트
]);

let dashboardAptSearchIndexPromise = null;
let dashboardSubwayTimesPromise = null;
let dashboardSubwayGraph = null;
const dashboardAptSearchInsightCache = new Map();
const dashboardAptSearchState = {
  entries: [],
  entriesById: new Map(),
  query: '',
  lastSearchQuery: '',
  results: [],
  selectedId: '',
  selectedInsight: null,
  isEditing: false,
  loading: false,
  ready: false,
  error: '',
};
const dashboardAptLoanState = {
  entryId: '',
  loanType: 'fund',
  price: '',
};

function getDashboardAptRegionFilter() {
  return 'capital';
}

function getDashboardAptRegionLabel() {
  return '서울·경기';
}

function buildDashboardAptCompositeKey(sigunguName, umdName, aptName) {
  return [
    normalizePlaceToken(sigunguName),
    normalizePlaceToken(umdName),
    normalizePlaceToken(aptName),
  ].join('|');
}

function extractBuildYear(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : null;
}

function formatBuildYearLabel(buildYear) {
  if (!Number.isFinite(buildYear)) return '준공 정보 확인 중';
  return `${buildYear}년 준공`;
}

function formatHouseholdLabel(householdCount) {
  if (!Number.isFinite(householdCount) || householdCount <= 0) return '세대수 확인 중';
  return `${householdCount.toLocaleString()}세대`;
}

function formatStationFallback(entry) {
  const stationLabel = [entry.stationMetaName || entry.subwayStation, entry.subwayLine].filter(Boolean).join(' ');
  const stationDistance = Number.isFinite(entry.stationMetaDistance)
    ? `직선 ${formatDistance(entry.stationMetaDistance)}`
    : String(entry.subwayDistance || '').trim();
  if (stationLabel && stationDistance) return `${stationLabel} · ${stationDistance}`;
  if (stationLabel) return stationLabel;
  if (stationDistance) return stationDistance;
  return '역 정보 확인 중';
}

function formatStationSummary(entry, insight) {
  if (insight?.station?.placeName && Number.isFinite(insight?.station?.distance)) {
    return `${insight.station.placeName} · 직선 ${formatDistance(insight.station.distance)}`;
  }
  return formatStationFallback(entry);
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
  return String(rawValue || '')
    .split(/[,/]/)
    .map(value => value.trim())
    .filter(Boolean);
}

function hasSubwayGraphStationMatch(rawValue) {
  if (!dashboardSubwayGraph) return false;
  return parseStationNameCandidates(rawValue)
    .map(normalizeStationToken)
    .filter(Boolean)
    .some(token => (dashboardSubwayGraph.nameToStationIds.get(token) || []).length > 0);
}

function parseLineNameCandidates(rawValue) {
  return String(rawValue || '')
    .split(/[,/]/)
    .map(value => value.trim())
    .filter(Boolean);
}

function hasNineLineBenefitCandidate(entry) {
  if (entry?.kaptCode && NINE_LINE_944_BENEFIT_CODES.has(String(entry.kaptCode))) {
    return true;
  }
  const name = normalizePlaceToken(entry?.aptName || '');
  return NINE_LINE_944_BENEFIT_NAMES.some(candidate => name.includes(candidate));
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

function formatPricePoint(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '가격 확인 중';
  return `${Math.round(numeric).toLocaleString()}만원`;
}

function formatPriceRange(minValue, maxValue) {
  const min = Number(minValue);
  const max = Number(maxValue);
  if (!Number.isFinite(min) || min <= 0) return '가격 확인 중';
  if (!Number.isFinite(max) || max <= 0 || max === min) return formatPricePoint(min);
  return `${formatPricePoint(min)} ~ ${formatPricePoint(max)}`;
}

function formatLatestTradeSummary(entry) {
  if (!Number.isFinite(entry.latestTradePrice)) return '최근 실거래 정보 확인 중';
  const parts = [formatPricePoint(entry.latestTradePrice)];
  if (entry.latestDealDate) parts.push(entry.latestDealDate);
  return parts.join(' · ');
}

function hasTradePriceData(entry) {
  return Number.isFinite(entry?.latestTradePrice) || Number.isFinite(entry?.avgPrice);
}

function hasOfficialPriceData(entry) {
  return Number.isFinite(entry?.medianOfficialPrice);
}

function getPriceLevelSource(entry) {
  if (Number.isFinite(entry?.avgPrice)) return 'trade-average';
  if (Number.isFinite(entry?.latestTradePrice)) return 'trade-latest';
  if (hasOfficialPriceData(entry)) return 'official-fallback';
  return null;
}

function isLuxuryPriceTier(entry, options = {}) {
  const includeOfficial = options.includeOfficial === true;
  const priceCandidates = [
    Number(entry?.latestTradePrice || 0) || null,
    Number(entry?.avgPrice || 0) || null,
    ...(includeOfficial ? [Number(entry?.medianOfficialPrice || 0) || null] : []),
  ].filter(Number.isFinite);
  return priceCandidates.some(price => price >= 200000);
}

function formatPriceLevelSummary(entry) {
  const priceSource = getPriceLevelSource(entry);
  if (priceSource === 'trade-average') return `평균 실거래 ${formatPricePoint(entry.avgPrice)}`;
  if (priceSource === 'trade-latest') return `최근 실거래 기준 ${formatPricePoint(entry.latestTradePrice)}`;
  if (priceSource === 'official-fallback') {
    const sampleLabel = Number.isFinite(entry?.officialPriceSampleCount)
      ? ` · 공시 ${entry.officialPriceSampleCount.toLocaleString()}건`
      : '';
    if (Number.isFinite(entry?.medianOfficialPrice)) {
      return `공시가격 중앙값 ${formatPricePoint(entry.medianOfficialPrice)}${sampleLabel}`;
    }
    if (Number.isFinite(entry?.minOfficialPrice) && Number.isFinite(entry?.maxOfficialPrice)) {
      return `공시가격 ${formatPriceRange(entry.minOfficialPrice, entry.maxOfficialPrice)}${sampleLabel}`;
    }
  }
  return '가격 레벨 데이터 보강 중';
}

function splitDistanceLabel(rawLabel) {
  const label = String(rawLabel || '').trim();
  if (!label) return { primary: '', secondary: '' };
  const parts = label.split('·').map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      primary: parts[0],
      secondary: parts.slice(1).join(' · '),
    };
  }
  return { primary: label, secondary: '' };
}

function formatBusinessDistrictSummary(result) {
  if (!result?.available || !Array.isArray(result.candidates) || !result.candidates.length) {
    return ['서울 지하철 시간 데이터 준비 중'];
  }
  return result.candidates
    .slice(0, 2)
    .map(candidate => `${candidate.district.label} ${candidate.totalMinutes}분`);
}

function formatGradeClassName(grade) {
  const normalized = String(grade || '')
    .toLowerCase()
    .replace(/\+/g, '-plus')
    .replace(/[^a-z-]/g, '');
  return normalized || 'pending';
}

function renderBusinessDistrictSummaryHtml(result) {
  return formatBusinessDistrictSummary(result)
    .map(line => `<strong>${escapeHtml(line)}</strong>`)
    .join('');
}

function buildSchoolMetaCompositeKey(sigunguName, umdName, aptName) {
  return buildDashboardAptCompositeKey(sigunguName, umdName, aptName);
}

function getSchoolMetaDistance(entry) {
  const distance = Number(entry?.schoolDistance);
  return Number.isFinite(distance) && distance > 0 ? distance : null;
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

  return {
    stationMap,
    nameToStationIds,
    adjacency,
  };
}

async function fetchDashboardSubwayGraph() {
  const cached = getCache(DASHBOARD_SUBWAY_TIMES_CACHE_KEY, DASHBOARD_SUBWAY_TIMES_CACHE_TTL);
  if (cached?.stations?.length && cached?.edges?.length) return buildDashboardSubwayGraph(cached);

  const response = await fetch(DASHBOARD_SUBWAY_TIMES_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('서울 지하철 시간 데이터를 불러오지 못했어요.');
  const payload = await response.json();
  setCache(DASHBOARD_SUBWAY_TIMES_CACHE_KEY, payload);
  return buildDashboardSubwayGraph(payload);
}

function loadDashboardSubwayGraph() {
  if (!dashboardSubwayTimesPromise) {
    dashboardSubwayTimesPromise = fetchDashboardSubwayGraph()
      .then(graph => {
        dashboardSubwayGraph = graph;
        renderDashboardSelectedApartment();
        return graph;
      })
      .catch(error => {
        dashboardSubwayTimesPromise = null;
        throw error;
      });
  }
  return dashboardSubwayTimesPromise;
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
  if (distance <= 400) return { score: 25, label: '역세권 체감이 강한 거리' };
  if (distance <= 700) return { score: 20, label: '도보 접근성이 괜찮은 편' };
  if (distance <= 1000) return { score: 12, label: '걸어서 접근 가능하지만 체감은 갈릴 수 있음' };
  return { score: 5, label: '역 접근은 다소 거리가 있는 편' };
}

function computeSchoolScore(distance) {
  if (!Number.isFinite(distance)) return { score: 8, label: '초품아 거리 확인 중' };
  if (distance <= 300) return { score: 36, label: '초품아 성격이 아주 강한 거리' };
  if (distance <= 500) return { score: 32, label: '도보 통학 체감이 좋은 편' };
  if (distance <= 700) return { score: 24, label: '가까운 초등학교 접근성이 무난한 편' };
  if (distance <= 1000) return { score: 16, label: '통학 거리가 아주 짧지는 않은 편' };
  return { score: 6, label: '초등학교 접근성은 비교가 필요한 편' };
}

function computeBusinessDistrictScore(entry, insight) {
  if (!dashboardSubwayGraph) {
    return {
      available: false,
      score: 0,
      label: '서울 지하철 시간 데이터 준비 중',
      bestDistrict: null,
      totalMinutes: null,
    };
  }

  const stationTokens = [
    ...parseStationNameCandidates(insight?.station?.placeName),
    ...parseStationNameCandidates(entry?.subwayStation),
  ].map(normalizeStationToken).filter(Boolean);

  if (!stationTokens.length) {
    return {
      available: false,
      score: 0,
      label: '가까운 역 정보를 먼저 확인하고 있어요.',
      bestDistrict: null,
      totalMinutes: null,
    };
  }

  const walkMinutes = estimateWalkMinutesToStation(entry, insight);
  const lineTokens = new Set(
    parseLineNameCandidates(entry?.subwayLine)
      .map(normalizeLineToken)
      .filter(Boolean),
  );
  const shouldRestrictLineMatch = lineTokens.size > 0 && hasSubwayGraphStationMatch(entry?.subwayStation);

  const originIds = [];
  stationTokens.forEach(token => {
    const stationIds = dashboardSubwayGraph.nameToStationIds.get(token) || [];
    stationIds.forEach(stationId => {
      const station = dashboardSubwayGraph.stationMap.get(stationId);
      const lineToken = normalizeLineToken(station?.lineName);
      if (!shouldRestrictLineMatch || lineTokens.has(lineToken)) originIds.push(stationId);
    });
  });

  const dedupedOriginIds = [...new Set(originIds)];
  if (!dedupedOriginIds.length) {
    return {
      available: false,
      score: 0,
      label: '서울 지하철 노선망과 가까운 역 매칭을 보강 중이에요.',
      bestDistrict: null,
      totalMinutes: null,
    };
  }

  const candidates = [];
  CORE_BUSINESS_DISTRICTS.forEach(district => {
    const targetIds = district.stationNames.flatMap(name => {
      const token = normalizeStationToken(name);
      return dashboardSubwayGraph.nameToStationIds.get(token) || [];
    });
    if (!targetIds.length) return;

    const path = findShortestGraphMinutes(dashboardSubwayGraph, dedupedOriginIds, targetIds);
    if (!path) return;

    const totalMinutes = path.minutes + (Number.isFinite(walkMinutes) ? walkMinutes : 0);
    candidates.push({
      district,
      path,
      totalMinutes,
    });
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

function computePriceLevelScore(entry) {
  const priceSource = getPriceLevelSource(entry);
  const priceCandidates = [
    Number(entry?.avgPrice || 0) || null,
    Number(entry?.latestTradePrice || 0) || null,
    Number(entry?.medianOfficialPrice || 0) || null,
    Number(entry?.avgOfficialPrice || 0) || null,
  ].filter(Number.isFinite);
  const priceLevel = priceCandidates.length ? Math.max(...priceCandidates) : null;

  if (!priceSource || !Number.isFinite(priceLevel)) {
    return { score: 8, label: '가격 레벨 보강 중' };
  }
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

function computeTransportAdjustment(entry, stationDistance, businessDistrictResult, tier) {
  const items = [];
  if (Number.isFinite(stationDistance)) {
    if (stationDistance <= 400) items.push({ key: 'station', points: 2, label: '역세권 체감이 강한 거리' });
    else if (stationDistance <= 700) items.push({ key: 'station', points: 1, label: '도보 역 접근성이 무난한 편' });
  }
  if (Number.isFinite(businessDistrictResult?.totalMinutes)) {
    if (businessDistrictResult.totalMinutes <= 25) items.push({ key: 'business', points: 2, label: businessDistrictResult.label });
    else if (businessDistrictResult.totalMinutes <= 35) items.push({ key: 'business', points: 1, label: businessDistrictResult.label });
  }
  const lineText = `${entry?.subwayLine || ''} ${entry?.stationMetaName || ''} ${entry?.subwayStation || ''}`;
  if (/신분당|GTX|8호선|9호선/u.test(lineText) || hasNineLineBenefitCandidate(entry)) {
    items.push({ key: 'line', points: 1, label: '핵심 노선 접근성 보정' });
  }
  const raw = items.reduce((sum, item) => sum + item.points, 0);
  const cap = LOCATION_TIER_TRANSPORT_CAPS[tier] || LOCATION_TIER_TRANSPORT_CAPS.T5;
  return {
    score: Math.min(raw, cap),
    raw,
    cap,
    items,
  };
}

function computeInfraAdjustment(entry, schoolDistance) {
  const items = [];
  if (Number.isFinite(schoolDistance)) {
    if (schoolDistance <= 400) items.push({ key: 'school', points: 1, label: '초등학교 접근성이 좋은 편' });
    else if (schoolDistance >= 900) items.push({ key: 'school', points: -1, label: '초등학교 거리는 약점' });
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
  const convenienceCount = [
    entry?.convenienceDept,
    entry?.convenienceMart,
    entry?.conveniencePark,
  ].filter(Boolean).length;
  if (convenienceCount >= 2) items.push({ key: 'convenience', points: 1, label: '생활편의 인프라가 확인되는 단지' });
  const raw = items.reduce((sum, item) => sum + item.points, 0);
  return {
    score: clampNumber(raw, -2, 2),
    raw,
    cap: 2,
    floor: -2,
    items,
  };
}

function computeDashboardApartmentGrade(entry, insight) {
  const businessDistrictResult = computeBusinessDistrictScore(entry, insight);
  const stationDistance = Number.isFinite(insight?.station?.distance)
    ? Number(insight.station.distance)
    : parseTransitWalkDistance(entry?.subwayDistance);
  const schoolDistance = Number.isFinite(insight?.school?.distance)
    ? Number(insight.school.distance)
    : getSchoolMetaDistance(entry);
  const priceLevelSource = getPriceLevelSource(entry);
  const priceLevelResult = computePriceLevelScore(entry);
  const hasOfficialFallback = priceLevelSource === 'official-fallback';
  const locationTier = getLocationTier(entry);
  const tierScore = LOCATION_TIER_SCORES[locationTier.tier] || LOCATION_TIER_SCORES.T5;
  const transportAdjustment = computeTransportAdjustment(entry, stationDistance, businessDistrictResult, locationTier.tier);
  const infraAdjustment = computeInfraAdjustment(entry, schoolDistance);
  const dimensions = [
    {
      key: 'priceLevel',
      available: priceLevelSource !== null,
      result: priceLevelResult,
    },
    {
      key: 'school',
      available: Number.isFinite(schoolDistance),
      result: computeSchoolScore(schoolDistance),
    },
    {
      key: 'station',
      available: Number.isFinite(stationDistance),
      result: computeStationScore(stationDistance),
    },
    {
      key: 'businessDistrict',
      available: businessDistrictResult.available,
      result: businessDistrictResult,
    },
    {
      key: 'household',
      available: Number.isFinite(entry.householdCount) && entry.householdCount > 0,
      result: computeHouseholdScore(entry.householdCount),
    },
    {
      key: 'newBuild',
      available: Number.isFinite(entry.buildYear),
      result: computeNewBuildScore(entry.buildYear),
    },
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

  const missingCount = missingLabels.length;
  const rawScore = tierScore.base + transportAdjustment.score + infraAdjustment.score;
  const clampedScore = clampNumber(rawScore, tierScore.min, tierScore.max);
  const grade = gradeFromLocationScore(clampedScore);
  const shouldHold = false;
  const supportingReasons = [
    `${locationTier.label} 기준으로 기본 등급 범위를 먼저 잡았어요.`,
    ...(transportAdjustment.items.length
      ? [transportAdjustment.items.sort((a, b) => b.points - a.points)[0].label]
      : []),
    ...(infraAdjustment.items.length
      ? [infraAdjustment.items.sort((a, b) => b.points - a.points)[0].label]
      : []),
    ...(hasOfficialFallback ? ['실거래 커버리지가 얇아 가격 레벨은 공시가격으로 우선 보완했어요.'] : []),
    ...(missingLabels.length ? [`아직 ${missingLabels.join(', ')} 데이터는 순차 보강 중이에요.`] : []),
  ];

  return {
    ready: true,
    grade,
    withheld: shouldHold,
    missingCount,
    reasons: supportingReasons.slice(0, 3),
    scoring: {
      tier: locationTier.tier,
      tierLabel: locationTier.label,
      baseScore: tierScore.base,
      tierMin: tierScore.min,
      tierMax: tierScore.max,
      transport: transportAdjustment,
      infra: infraAdjustment,
      rawScore,
      clampedScore,
    },
  };
}

function formatConvenienceDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1).replace(/\.0$/, '')}km`;
}

function getConvenienceChipClass(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return 'is-gray';
  if (meters <= 500) return 'is-green';
  if (meters <= 1500) return 'is-yellow';
  return 'is-gray';
}

function renderConvenienceChip(emoji, label, item) {
  const distText = item?.distance ? formatConvenienceDistance(item.distance) : null;
  const chipClass = item?.distance ? getConvenienceChipClass(item.distance) : 'is-gray';
  const valueText = distText || (item ? '인근' : '없음');
  return `<div class="db-apt-convenience-chip ${chipClass}"><span>${emoji} ${escapeHtml(label)}</span><strong>${escapeHtml(valueText)}</strong></div>`;
}

function renderConvenienceSectionHtml(entry) {
  if (!entry.convenienceHospital && !entry.convenienceMart && !entry.convenienceDept && !entry.conveniencePark) return '';
  return `
    <div class="db-apt-convenience-section">
      <div class="db-apt-convenience-divider">── 주변 생활편의 ──</div>
      <div class="db-apt-convenience-chips">
        ${renderConvenienceChip('🏥', '종합병원', entry.convenienceHospital)}
        ${renderConvenienceChip('🛒', '대형마트', entry.convenienceMart)}
        ${renderConvenienceChip('🏬', '백화점', entry.convenienceDept)}
        ${renderConvenienceChip('🌳', '공원', entry.conveniencePark)}
      </div>
    </div>
  `;
}

function buildDashboardSearchIndex({ codeMap, households, trades, schools, stationMetas, officialPrices, convenienceMetas }) {
  const householdByCode = new Map();
  const householdByKey = new Map();
  (households?.entries || []).forEach(entry => {
    if (entry?.kaptCode) householdByCode.set(entry.kaptCode, entry);
    const key = buildDashboardAptCompositeKey(entry.sigunguName, entry.umdName, entry.aptName);
    if (key) householdByKey.set(key, entry);
  });
  const schoolByCode = new Map();
  const schoolByKey = new Map();
  (schools?.entries || []).forEach(entry => {
    if (entry?.kaptCode) schoolByCode.set(entry.kaptCode, entry);
    const key = buildSchoolMetaCompositeKey(entry.sigunguName, entry.umdName, entry.aptName);
    if (key) schoolByKey.set(key, entry);
  });
  const stationByCode = new Map();
  const stationByKey = new Map();
  (stationMetas?.entries || []).forEach(entry => {
    if (entry?.kaptCode) stationByCode.set(entry.kaptCode, entry);
    const key = buildSchoolMetaCompositeKey(entry.sigunguName, entry.umdName, entry.aptName);
    if (key) stationByKey.set(key, entry);
  });
  const officialByCode = new Map();
  const officialByKey = new Map();
  (officialPrices?.entries || []).forEach(entry => {
    if (entry?.kaptCode) officialByCode.set(entry.kaptCode, entry);
    const key = buildSchoolMetaCompositeKey(entry.sigunguName, entry.umdName, entry.aptName);
    if (key) officialByKey.set(key, entry);
  });
  const convenienceByCode = new Map(
    Object.entries(
      typeof convenienceMetas === 'object' && convenienceMetas !== null && !Array.isArray(convenienceMetas)
        ? convenienceMetas
        : {},
    ),
  );

  const tradeByKey = new Map();
  const applyTrade = (payload) => {
    if (!payload?.aptName || !payload?.sigunguName) return;
    const key = buildDashboardAptCompositeKey(payload.sigunguName, payload.umdName, payload.aptName);
    if (!key) return;

    const prev = tradeByKey.get(key) || {};
    const priceCandidate = Number(payload.latestTradePrice || payload.price || 0) || prev.latestTradePrice || null;
    const dealDateCandidate = payload.latestDealDate || payload.dealDate || prev.latestDealDate || '';

    tradeByKey.set(key, {
      latestTradePrice: priceCandidate,
      latestDealDate: dealDateCandidate,
      medianPrice: Number(payload.medianPrice || 0) || prev.medianPrice || null,
      avgPrice: Number(payload.avgPrice || 0) || prev.avgPrice || null,
      avgArea: Number(payload.avgArea || payload.area || 0) || prev.avgArea || null,
      tradeCount: Number(payload.tradeCount || 0) || prev.tradeCount || null,
      buildYear: Number(payload.buildYear || 0) || prev.buildYear || null,
    });
  };

  Object.values(trades?.sigungu || {}).forEach(region => {
    (region?.popularComplexes || []).forEach(applyTrade);
    (region?.recentDeals || []).forEach(applyTrade);
    (region?.cityScopes || []).forEach(scope => (scope?.popularComplexes || []).forEach(applyTrade));
  });

  const entries = [];
  const seenIds = new Set();
  (codeMap?.items || []).forEach(item => {
    const sidoName = item?.as1 || '';
    if (sidoName !== '서울특별시' && sidoName !== '경기도') return;

    const sigunguName = item.as2 || '';
    const umdName = item.as3 || '';
    const aptName = item.kaptName || '';
    if (!aptName || !sigunguName) return;

    const compositeKey = buildDashboardAptCompositeKey(sigunguName, umdName, aptName);
    const household = householdByCode.get(item.kaptCode) || householdByKey.get(compositeKey) || null;
    const school = schoolByCode.get(item.kaptCode) || schoolByKey.get(compositeKey) || null;
    const stationMeta = stationByCode.get(item.kaptCode) || stationByKey.get(compositeKey) || null;
    const officialPrice = officialByCode.get(item.kaptCode) || officialByKey.get(compositeKey) || null;
    const convenience = convenienceByCode.get(item.kaptCode) || null;
    const trade = tradeByKey.get(compositeKey) || null;
    const id = item.kaptCode || compositeKey;
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);

    const buildYear = extractBuildYear(household?.kaptUsedate) || Number(trade?.buildYear || 0) || null;
    const regionKey = sidoName === '서울특별시' ? 'seoul' : 'gyeonggi';
    const regionLabel = regionKey === 'seoul' ? '서울' : '경기';
    const searchTokens = [aptName, sigunguName, umdName, regionLabel, item.kaptCode].filter(Boolean).join(' ');

    entries.push({
      id,
      kaptCode: item.kaptCode || '',
      aptName,
      sigunguName,
      umdName,
      regionKey,
      regionLabel,
      householdCount: Number(household?.householdCount || 0) || null,
      buildYear,
      latestTradePrice: Number(trade?.latestTradePrice || 0) || null,
      avgPrice: Number(trade?.avgPrice || 0) || null,
      latestDealDate: trade?.latestDealDate || '',
      tradeCount: Number(trade?.tradeCount || 0) || null,
      avgTradeArea: Number(trade?.avgArea || 0) || null,
      minOfficialPrice: Number(officialPrice?.minOfficialPrice || 0) || null,
      maxOfficialPrice: Number(officialPrice?.maxOfficialPrice || 0) || null,
      avgOfficialPrice: Number(officialPrice?.avgOfficialPrice || 0) || null,
      medianOfficialPrice: Number(officialPrice?.medianOfficialPrice || 0) || null,
      officialPriceSampleCount: Number(officialPrice?.sampleCount || 0) || null,
      subwayLine: household?.subwayLine || '',
      subwayStation: household?.subwayStation || '',
      subwayDistance: household?.subwayDistance || '',
      stationMetaName: stationMeta?.stationName || '',
      stationMetaDistance: Number(stationMeta?.stationDistance || 0) || null,
      busDistance: household?.busDistance || '',
      doroJuso: household?.doroJuso || '',
      schoolName: school?.schoolName || '',
      schoolDistance: Number(school?.schoolDistance || 0) || null,
      convenienceHospital: convenience?.hospital || null,
      convenienceMart: convenience?.mart || null,
      convenienceDept: convenience?.dept || null,
      conveniencePark: convenience?.park || null,
      searchTextNormalized: normalizePlaceToken(searchTokens),
      displayLocation: [sigunguName, umdName].filter(Boolean).join(' '),
    });
  });

  entries.sort((a, b) => a.aptName.localeCompare(b.aptName, 'ko'));
  return entries;
}

async function fetchDashboardAptSearchIndex() {
  const cached = getCache(DASHBOARD_APT_SEARCH_CACHE_KEY, DASHBOARD_APT_SEARCH_CACHE_TTL);
  if (cached?.entries?.length) return cached.entries;

  const [schoolMetaRes, stationMetaRes, officialPriceRes, convenienceMetaRes, codeMapRes, householdsRes, trades] = await Promise.all([
    fetch(DASHBOARD_APT_SCHOOL_META_URL, { cache: 'no-store' }).catch(() => null),
    fetch(DASHBOARD_APT_STATION_META_URL, { cache: 'no-store' }).catch(() => null),
    fetch(DASHBOARD_APT_OFFICIAL_PRICE_META_URL, { cache: 'no-store' }).catch(() => null),
    fetch(DASHBOARD_APT_CONVENIENCE_META_URL, { cache: 'no-store' }).catch(() => null),
    fetch(DASHBOARD_APT_CODE_MAP_URL, { cache: 'no-store' }),
    fetch(DASHBOARD_APT_HOUSEHOLDS_URL, { cache: 'no-store' }),
    preloadAptTrades(),
  ]);

  if (!codeMapRes.ok) throw new Error('단지 목록을 불러오지 못했어요.');
  if (!householdsRes.ok) throw new Error('단지 기본정보를 불러오지 못했어요.');

  const [codeMap, households, schools, stationMetas, officialPrices, convenienceMetas] = await Promise.all([
    codeMapRes.json(),
    householdsRes.json(),
    schoolMetaRes?.ok ? schoolMetaRes.json() : Promise.resolve({ entries: [] }),
    stationMetaRes?.ok ? stationMetaRes.json() : Promise.resolve({ entries: [] }),
    officialPriceRes?.ok ? officialPriceRes.json() : Promise.resolve({ entries: [] }),
    convenienceMetaRes?.ok ? convenienceMetaRes.json().catch(() => ({})) : Promise.resolve({}),
  ]);
  const entries = buildDashboardSearchIndex({ codeMap, households, trades, schools, stationMetas, officialPrices, convenienceMetas });
  setCache(DASHBOARD_APT_SEARCH_CACHE_KEY, { entries });
  return entries;
}

function loadDashboardAptSearchIndex() {
  if (!dashboardAptSearchIndexPromise) {
    dashboardAptSearchState.loading = true;
    dashboardAptSearchIndexPromise = fetchDashboardAptSearchIndex()
      .then(entries => {
        dashboardAptSearchState.entries = entries;
        dashboardAptSearchState.entriesById = new Map(entries.map(entry => [entry.id, entry]));
        dashboardAptSearchState.ready = true;
        dashboardAptSearchState.loading = false;
        dashboardAptSearchState.error = '';
        syncDashboardAptSearchUi();
        return entries;
      })
      .catch(error => {
        dashboardAptSearchState.loading = false;
        dashboardAptSearchState.ready = false;
        dashboardAptSearchState.error = error?.message || '단지 검색 데이터를 준비하지 못했어요.';
        dashboardAptSearchIndexPromise = null;
        syncDashboardAptSearchUi();
        throw error;
      });
  }
  return dashboardAptSearchIndexPromise;
}

function getDashboardAptSearchScopeEntries() {
  return dashboardAptSearchState.entries;
}

function scoreDashboardAptEntry(entry, queryNormalized, queryTokens) {
  let score = 0;
  const nameNorm = normalizePlaceToken(entry.aptName);
  const locationNorm = normalizePlaceToken(`${entry.sigunguName} ${entry.umdName}`);
  const combinedNorm = entry.searchTextNormalized;

  if (nameNorm === queryNormalized) score += 120;
  else if (nameNorm.startsWith(queryNormalized)) score += 90;
  else if (nameNorm.includes(queryNormalized)) score += 70;

  if (combinedNorm.includes(queryNormalized)) score += 20;
  if (locationNorm.includes(queryNormalized)) score += 18;

  queryTokens.forEach(token => {
    if (nameNorm.includes(token)) score += 18;
    if (locationNorm.includes(token)) score += 12;
    if (combinedNorm.includes(token)) score += 6;
  });

  if (entry.latestTradePrice) score += 6;
  if (entry.householdCount) score += 4;
  return score;
}

function searchDashboardApartments(rawQuery) {
  const query = String(rawQuery || '').trim();
  if (!query) return [];

  const queryTokens = query.split(/\s+/).map(normalizePlaceToken).filter(Boolean);
  const queryNormalized = normalizePlaceToken(query);
  if (!queryNormalized) return [];

  return getDashboardAptSearchScopeEntries()
    .map(entry => ({ entry, score: scoreDashboardAptEntry(entry, queryNormalized, queryTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (b.entry.latestTradePrice || 0) - (a.entry.latestTradePrice || 0))
    .slice(0, 8)
    .map(item => item.entry);
}

function updateDashboardAptSearchResults() {
  dashboardAptSearchState.results = searchDashboardApartments(dashboardAptSearchState.query);
}

function getDashboardSelectedEntry() {
  return dashboardAptSearchState.entriesById.get(dashboardAptSearchState.selectedId) || null;
}

function renderDashboardAptSearchBar() {
  const mount = document.getElementById('dbAptSearchBarMount');
  if (!mount) return;

  mount.innerHTML = `
    <button class="db-apt-search-trigger" type="button" onclick="showAptSearchScreen()">
      <span class="db-apt-search-trigger-placeholder">${escapeHtml(getDashboardAptRegionLabel())} 단지명 또는 지역명으로 검색</span>
    </button>
  `;
}

function renderAptSearchScreenLayout() {
  const screen = document.getElementById('aptSearchScreen');
  if (!screen) return;

  screen.innerHTML = `
    <div class="db-apt-page">
      <div class="db-apt-page-sticky">
        <div class="db-topbar">
          <button class="db-back-btn" type="button" onclick="showDashboard()">← 대시보드로</button>
          <div class="db-topbar-copy">
            <strong>아파트 분석</strong>
            <span>검색과 결과는 여기서만 확인해요</span>
          </div>
        </div>
        <div class="db-apt-page-search">
          <input
            id="dbAptSearchInput"
            class="db-apt-search-input"
            type="search"
            placeholder="${getDashboardAptRegionLabel()} 단지명 또는 지역명으로 검색"
            autocomplete="off"
            value="${escapeHtml(dashboardAptSearchState.query)}"
            oninput="handleDashboardAptSearchInput(event)"
            onfocus="handleDashboardAptSearchFocus()"
            onkeydown="handleDashboardAptSearchKeydown(event)"
          >
        </div>
      </div>
      <div class="db-apt-page-body">
        <div class="db-apt-finder-copy">단지명과 지역명을 함께 입력하면 초품아 거리, 가까운 역, 세대수, 신축 여부와 핵심 업무지구 접근성을 함께 보여드려요.</div>
        <div class="db-apt-search-results" id="dbAptSearchResults"></div>
        <div class="db-apt-search-selected" id="dbAptSearchSelected"></div>
      </div>
      <div class="db-apt-search-toast-layer" id="dbAptSearchToast"></div>
    </div>
  `;
}

function renderDashboardAptSearchResults() {
  const resultWrap = document.getElementById('dbAptSearchResults');
  if (!resultWrap) return;

  if (!dashboardAptSearchState.query.trim() || !dashboardAptSearchState.results.length) {
    resultWrap.innerHTML = '';
    return;
  }

  resultWrap.innerHTML = dashboardAptSearchState.results.map(entry => `
    <button class="db-apt-search-item" type="button" onclick='pickDashboardApartment(${JSON.stringify(entry.id)})'>
      <div class="db-apt-search-item-main">
        <strong>${escapeHtml(entry.aptName)}</strong>
        <span>${escapeHtml(entry.displayLocation)}</span>
      </div>
      <div class="db-apt-search-item-side">
        <span>${escapeHtml(entry.regionLabel)}</span>
      </div>
    </button>
  `).join('');
}

function isDashboardAptAnalysisUnlocked() {
  if (window.PaywallController?.isUnlocked) return window.PaywallController.isUnlocked();
  return localStorage.getItem('authVerified') === '1';
}

function renderDashboardSelectedApartment() {
  const target = document.getElementById('dbAptSearchSelected');
  if (!target) return;

  if (dashboardAptSearchState.isEditing) {
    target.innerHTML = '';
    delete target.dataset.renderedEntryId;
    return;
  }

  const entry = getDashboardSelectedEntry();
  if (!entry) {
    target.innerHTML = '';
    delete target.dataset.renderedEntryId;
    return;
  }
  try {
    const insight = dashboardAptSearchState.selectedInsight;
    const gradeData = insight?.ready ? computeDashboardApartmentGrade(entry, insight) : null;
    const businessDistrictData = insight?.ready ? computeBusinessDistrictScore(entry, insight) : null;
    const isGradeReady = gradeData?.ready && gradeData?.grade;
    const isGradeWithheld = Boolean(gradeData?.withheld);
    const gradeClass = isGradeReady ? `grade-${formatGradeClassName(gradeData.grade)}` : isGradeWithheld ? 'grade-pending' : 'grade-pending';
    const stationText = formatStationSummary(entry, insight);
    const schoolDistance = getSchoolMetaDistance(entry);
    const schoolText = entry.schoolName && Number.isFinite(schoolDistance)
      ? `${entry.schoolName} · 직선 ${formatDistance(schoolDistance)}`
      : '초등학교 거리 확인 중';
    const schoolParts = splitDistanceLabel(schoolText);
    const stationParts = splitDistanceLabel(stationText);
    const hasNineLineBenefit = hasNineLineBenefitCandidate(entry);
    const statusText = !insight?.ready
      ? '단지 입지 데이터를 불러오는 중이에요.'
      : gradeData?.withheld
        ? '핵심 축이 너무 적어서 등급은 잠시 보류하고, 확보된 정보만 먼저 보여드려요.'
        : '선택한 단지 기준으로 정적 입지 데이터를 묶어서 정리했어요.';
    const calculatorIcon = typeof icon === 'function' ? icon('calculator', 18) : '';
    target.innerHTML = `
      <article class="db-apt-grade-card">
        <div class="db-apt-grade-head">
          <div>
            <div class="db-fact-label">단지 간단 등급</div>
            <strong>${escapeHtml(entry.aptName)}</strong>
            <span>${escapeHtml(entry.regionLabel)} · ${escapeHtml(entry.displayLocation)}</span>
          </div>
          <div class="db-apt-grade-badge ${gradeClass}">
            <span>등급</span>
            <strong>${isGradeReady ? gradeData.grade : '보류'}</strong>
          </div>
        </div>
        <p class="db-apt-grade-status">${escapeHtml(statusText)}</p>
        ${hasNineLineBenefit ? `
          <div class="db-apt-benefit-badges">
            <span class="db-apt-benefit-badge">9호선 연장 수혜 예상</span>
            <span class="db-apt-benefit-badge is-muted">강동하남남양주선 기본계획 기준</span>
          </div>
        ` : ''}
        <div class="db-apt-grade-grid">
          <div class="db-apt-grade-chip">
            <span>초품아</span>
            <strong>${escapeHtml(schoolParts.primary || schoolText)}</strong>
            ${schoolParts.secondary ? `<em>${escapeHtml(schoolParts.secondary)}</em>` : ''}
          </div>
          <div class="db-apt-grade-chip">
            <span>가까운 역</span>
            <strong>${escapeHtml(stationParts.primary || stationText)}</strong>
            ${stationParts.secondary ? `<em>${escapeHtml(stationParts.secondary)}</em>` : ''}
          </div>
          <div class="db-apt-grade-chip">
            <span>세대수</span>
            <strong>${escapeHtml(formatHouseholdLabel(entry.householdCount))}</strong>
          </div>
          <div class="db-apt-grade-chip">
            <span>준공</span>
            <strong>${escapeHtml(formatBuildYearLabel(entry.buildYear))}</strong>
          </div>
          <div class="db-apt-grade-chip">
            <span>핵심 업무지구</span>
            <strong class="db-apt-grade-business-lines">${renderBusinessDistrictSummaryHtml(businessDistrictData)}</strong>
          </div>
          <div class="db-apt-grade-chip">
            <span>가격 레벨</span>
            <strong>${escapeHtml(formatPriceLevelSummary(entry))}</strong>
          </div>
        </div>
        ${renderConvenienceSectionHtml(entry)}
        <div class="db-apt-grade-summary">
          <div class="db-apt-grade-reasons">
            ${(gradeData?.reasons || ['초품아 거리와 가까운 역 거리를 우선 정리하는 중이에요.']).map(reason => `<p>${escapeHtml(reason)}</p>`).join('')}
          </div>
        </div>
        <div class="db-apt-grade-disclaimer">
          <p>입지 등급은 현재 확보된 실거래·공시가격·학교·역·업무지구 데이터 기준으로 계산해요.</p>
          <p>원천 DB 특성상 일부 단지 정보가 다르게 들어가거나 늦게 반영될 수 있고, 지하철 연장·재개발 같은 미래 호재는 별도 배지 외에는 등급에 강하게 반영하지 않았어요.</p>
        </div>
        <button class="db-apt-loan-cta" type="button" onclick='openAptLoanSheet(${JSON.stringify(entry.id)})'>
          <span>${calculatorIcon}</span>
          이 단지로 대출 계산하기
        </button>
      </article>
    `;
  } catch (error) {
    target.innerHTML = `
      <article class="db-apt-grade-card">
        <div class="db-apt-grade-head">
          <div>
            <div class="db-fact-label">단지 간단 등급</div>
            <strong>${escapeHtml(entry.aptName)}</strong>
            <span>${escapeHtml(entry.regionLabel)} · ${escapeHtml(entry.displayLocation)}</span>
          </div>
          <div class="db-apt-grade-badge grade-pending">
            <span>등급</span>
            <strong>보류</strong>
          </div>
        </div>
        <p class="db-apt-grade-status">단지 분석 데이터를 정리하는 중이에요. 다시 선택하면 최신 상태로 불러올게요.</p>
        <button class="db-apt-loan-cta" type="button" onclick='openAptLoanSheet(${JSON.stringify(entry.id)})'>
          이 단지로 대출 계산하기
        </button>
      </article>
    `;
    console.error(error);
  }

  target.dataset.renderedEntryId = entry.id;
}

function getDashboardAptBasisPriceManwon(entry) {
  if (!entry) return null;
  const candidates = [
    Number(entry.latestTradePrice || 0),
    Number(entry.avgPrice || 0),
    Number(entry.medianOfficialPrice || 0),
    Number(entry.avgOfficialPrice || 0),
    Number(entry.maxOfficialPrice || 0),
  ].filter(value => Number.isFinite(value) && value > 0);
  return candidates.length ? candidates[0] : null;
}

function formatDashboardAptPriceEok(priceManwon) {
  if (!Number.isFinite(priceManwon) || priceManwon <= 0) return '';
  const eok = priceManwon / 10000;
  return Number.isInteger(eok) ? String(eok) : eok.toFixed(1).replace(/\.0$/, '');
}

function updateAptLoanSheetState() {
  const input = document.getElementById('aptLoanPriceInput');
  const submit = document.getElementById('aptLoanSubmitBtn');
  const price = input?.value?.trim() || '';
  dashboardAptLoanState.price = price;

  if (submit) {
    submit.disabled = !(parseFloat(price) > 0);
    submit.textContent = dashboardAptLoanState.loanType === 'bank'
      ? '시중대출 비교 입력하기'
      : '기금대출 조건 확인하기';
  }
}

function setAptLoanType(type) {
  dashboardAptLoanState.loanType = type === 'bank' ? 'bank' : 'fund';
  document.querySelectorAll('.apt-loan-type').forEach(button => {
    button.classList.toggle('active', button.dataset.loanType === dashboardAptLoanState.loanType);
  });
  updateAptLoanSheetState();
}

function openAptLoanSheet(entryId) {
  if (!isDashboardAptAnalysisUnlocked()) {
    openAptAnalysisPaywallSheet();
    return;
  }

  const entry = dashboardAptSearchState.entriesById.get(entryId) || getDashboardSelectedEntry();
  if (!entry) return;

  const overlay = document.getElementById('aptLoanSheetOverlay');
  const sheet = document.getElementById('aptLoanSheet');
  const input = document.getElementById('aptLoanPriceInput');
  const desc = document.getElementById('aptLoanSheetDesc');
  if (!overlay || !sheet || !input) return;

  const priceManwon = getDashboardAptBasisPriceManwon(entry);
  const basisPrice = formatDashboardAptPriceEok(priceManwon);
  dashboardAptLoanState.entryId = entry.id;
  dashboardAptLoanState.price = basisPrice;
  input.value = basisPrice;
  if (desc) {
    desc.textContent = basisPrice
      ? `${entry.aptName} 기준 가격을 확인하고 필요하면 직접 수정해주세요.`
      : `${entry.aptName}의 매수 예정가나 확인한 실거래가를 직접 입력해주세요.`;
  }

  setAptLoanType(dashboardAptLoanState.loanType);
  overlay.classList.add('open');
  sheet.classList.add('open');
  if (typeof window.renderIcons === 'function') window.renderIcons(sheet);
  window.setTimeout(() => input.focus(), 260);
}

function closeAptLoanSheet() {
  document.getElementById('aptLoanSheetOverlay')?.classList.remove('open');
  document.getElementById('aptLoanSheet')?.classList.remove('open');
}

function openAptAnalysisPaywallSheet() {
  if (typeof window.openPaySheet === 'function') {
    window.openPaySheet('apt-analysis');
  }
}

function closeAptAnalysisPaywallSheet() {
  if (typeof window.closePaySheet === 'function') {
    window.closePaySheet();
  }
}

function hasDashboardAptSelection() {
  return Boolean(dashboardAptSearchState.selectedId && getDashboardSelectedEntry());
}

function revealDashboardAptAnalysisAfterAuth() {
  renderDashboardSelectedApartment();
  if (typeof showAptSearchScreen === 'function') showAptSearchScreen();
}

function submitAptLoanSheet() {
  const price = parseFloat(document.getElementById('aptLoanPriceInput')?.value);
  if (!(price > 0)) return;

  closeAptLoanSheet();
  if (typeof startCalculatorFromApartment !== 'function') return;

  startCalculatorFromApartment({
    loanType: dashboardAptLoanState.loanType,
    price,
  });
}

let dashboardAptToastExitTimer = null;

function getDashboardAptMotionMs(varName, fallback) {
  if (typeof getMotionMs === 'function') return getMotionMs(varName, fallback);
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  if (!raw) return fallback;
  if (raw.endsWith('ms')) return parseFloat(raw) || fallback;
  if (raw.endsWith('s')) return (parseFloat(raw) || 0) * 1000 || fallback;
  return parseFloat(raw) || fallback;
}

function renderDashboardAptSearchToast() {
  const toast = document.getElementById('dbAptSearchToast');
  const pageBody = document.querySelector('.db-apt-page-body');
  if (!toast || !pageBody) return;

  const hasReturnResults = Boolean(
    !dashboardAptSearchState.isEditing
    && dashboardAptSearchState.selectedId
    && dashboardAptSearchState.lastSearchQuery.trim(),
  );

  pageBody.classList.toggle('has-search-toast', hasReturnResults);

  if (!hasReturnResults) {
    if (dashboardAptToastExitTimer) clearTimeout(dashboardAptToastExitTimer);
    toast.classList.remove('is-visible');
    dashboardAptToastExitTimer = window.setTimeout(() => {
      const nextToast = document.getElementById('dbAptSearchToast');
      if (nextToast && !nextToast.classList.contains('is-visible')) nextToast.innerHTML = '';
    }, getDashboardAptMotionMs('--motion-toast-exit', 250));
    return;
  }

  if (toast.classList.contains('is-visible') && toast.querySelector('.db-apt-grade-return')) {
    return;
  }

  const showToast = () => {
    const nextToast = document.getElementById('dbAptSearchToast');
    if (!nextToast) return;
    nextToast.innerHTML = `
      <button class="db-apt-grade-return" type="button" onclick="returnToDashboardAptResults()">
        다시 검색 결과 보기
      </button>
    `;
    nextToast.classList.add('is-visible');
  };

  if (dashboardAptToastExitTimer) clearTimeout(dashboardAptToastExitTimer);
  if (toast.classList.contains('is-visible')) {
    toast.classList.remove('is-visible');
    dashboardAptToastExitTimer = window.setTimeout(showToast, getDashboardAptMotionMs('--motion-toast-exit', 250));
    return;
  }

  window.requestAnimationFrame(showToast);
}

function syncDashboardAptSearchUi() {
  renderDashboardAptSearchBar();
  renderAptSearchScreenLayout();
  renderDashboardAptSearchResults();
  renderDashboardSelectedApartment();
  renderDashboardAptSearchToast();
}

function renderDashboardAptSearchSection() {
  syncDashboardAptSearchUi();
  loadDashboardAptSearchIndex().catch(() => {});
  loadDashboardSubwayGraph().catch(() => {});
}

function handleDashboardAptSearchInput(event) {
  dashboardAptSearchState.query = event?.target?.value || '';
  dashboardAptSearchState.lastSearchQuery = dashboardAptSearchState.query.trim();
  dashboardAptSearchState.isEditing = true;
  if (!dashboardAptSearchState.query.trim()) {
    dashboardAptSearchState.selectedId = '';
    dashboardAptSearchState.selectedInsight = null;
    dashboardAptSearchState.lastSearchQuery = '';
  }
  updateDashboardAptSearchResults();
  renderDashboardAptSearchResults();
  renderDashboardSelectedApartment();
  renderDashboardAptSearchToast();
}

function handleDashboardAptSearchFocus() {
  dashboardAptSearchState.isEditing = true;
  updateDashboardAptSearchResults();
  renderDashboardAptSearchResults();
  renderDashboardSelectedApartment();
  renderDashboardAptSearchToast();
}

function handleDashboardAptSearchKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
}

function hydrateDashboardApartmentInsight(entry) {
  const cacheKey = `dashboard_apt_insight_${entry.id}`;
  const memoryCached = dashboardAptSearchInsightCache.get(cacheKey);
  if (memoryCached) {
    dashboardAptSearchState.selectedInsight = memoryCached;
    renderDashboardSelectedApartment();
    return;
  }

  const schoolDistance = getSchoolMetaDistance(entry);
  const insight = {
    ready: true,
    failed: false,
    station: entry.stationMetaName && Number.isFinite(entry.stationMetaDistance)
      ? { placeName: entry.stationMetaName, distance: entry.stationMetaDistance }
      : null,
    school: entry.schoolName && Number.isFinite(schoolDistance)
      ? { placeName: entry.schoolName, distance: schoolDistance }
      : null,
  };
  dashboardAptSearchInsightCache.set(cacheKey, insight);
  dashboardAptSearchState.selectedInsight = insight;
  renderDashboardSelectedApartment();

  const needsStationBackfill = !hasSubwayGraphStationMatch(entry.subwayStation);
  const canBackfillStation = typeof searchComplexLocation === 'function' && typeof searchNearestStation === 'function';
  if (!needsStationBackfill || !canBackfillStation) return;

  searchComplexLocation(entry)
    .then(location => searchNearestStation(location))
    .then(station => {
      if (!station) return;
      insight.station = station;
      dashboardAptSearchInsightCache.set(cacheKey, insight);
      if (dashboardAptSearchState.selectedId === entry.id) {
        dashboardAptSearchState.selectedInsight = insight;
        renderDashboardSelectedApartment();
      }
    })
    .catch(() => {});
}

function pickDashboardApartment(id) {
  const entry = dashboardAptSearchState.entriesById.get(id);
  if (!entry) return;

  const currentQuery = dashboardAptSearchState.query.trim();
  if (currentQuery) {
    dashboardAptSearchState.lastSearchQuery = currentQuery;
  }
  dashboardAptSearchState.selectedId = id;
  dashboardAptSearchState.isEditing = false;
  dashboardAptSearchState.query = `${entry.aptName} ${entry.displayLocation}`.trim();
  dashboardAptSearchState.results = [];
  syncDashboardAptSearchUi();

  const input = document.getElementById('dbAptSearchInput');
  if (input) input.value = dashboardAptSearchState.query;
  const body = document.querySelector('.db-apt-page-body');
  if (body) body.scrollTo({ top: 0, behavior: 'smooth' });
  if (!isDashboardAptAnalysisUnlocked()) {
    window.setTimeout(openAptAnalysisPaywallSheet, 180);
  }
  hydrateDashboardApartmentInsight(entry);
}

function returnToDashboardAptResults() {
  const query = dashboardAptSearchState.lastSearchQuery.trim();
  if (!query) return;

  dashboardAptSearchState.query = query;
  dashboardAptSearchState.isEditing = true;
  updateDashboardAptSearchResults();
  renderDashboardAptSearchResults();
  renderDashboardSelectedApartment();
  renderDashboardAptSearchToast();

  const input = document.getElementById('dbAptSearchInput');
  if (input) {
    input.value = query;
    input.focus();
    if (typeof input.setSelectionRange === 'function') {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }
}

function renderAptSearchScreen() {
  syncDashboardAptSearchUi();
  loadDashboardAptSearchIndex().catch(() => {});
  loadDashboardSubwayGraph().catch(() => {});
  window.setTimeout(() => {
    const input = document.getElementById('dbAptSearchInput');
    if (input) input.focus();
  }, 10);
}

window.renderDashboardAptSearchSection = renderDashboardAptSearchSection;
window.renderAptSearchScreen = renderAptSearchScreen;
window.handleDashboardAptSearchInput = handleDashboardAptSearchInput;
window.handleDashboardAptSearchFocus = handleDashboardAptSearchFocus;
window.handleDashboardAptSearchKeydown = handleDashboardAptSearchKeydown;
window.pickDashboardApartment = pickDashboardApartment;
window.returnToDashboardAptResults = returnToDashboardAptResults;
window.openAptLoanSheet = openAptLoanSheet;
window.closeAptLoanSheet = closeAptLoanSheet;
window.openAptAnalysisPaywallSheet = openAptAnalysisPaywallSheet;
window.closeAptAnalysisPaywallSheet = closeAptAnalysisPaywallSheet;
window.hasDashboardAptSelection = hasDashboardAptSelection;
window.revealDashboardAptAnalysisAfterAuth = revealDashboardAptAnalysisAfterAuth;
window.setAptLoanType = setAptLoanType;
window.updateAptLoanSheetState = updateAptLoanSheetState;
window.submitAptLoanSheet = submitAptLoanSheet;
