const DASHBOARD_APT_CODE_MAP_URL = '/data/apt-code-map.json?v=20260506b';
const DASHBOARD_APT_HOUSEHOLDS_URL = '/data/apt-households.json?v=20260506b';
const DASHBOARD_SUBWAY_TIMES_URL = '/data/subway-seoul-times.json?v=20260506a';
const DASHBOARD_APT_SEARCH_CACHE_KEY = 'dashboard_apt_search_index_v3';
const DASHBOARD_APT_SEARCH_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
const DASHBOARD_SUBWAY_TIMES_CACHE_KEY = 'dashboard_subway_times_v1';
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

let dashboardAptSearchIndexPromise = null;
let dashboardSubwayTimesPromise = null;
let dashboardSubwayGraph = null;
let dashboardAptSearchHydrateSeq = 0;
const dashboardAptSearchInsightCache = new Map();
const dashboardAptSearchState = {
  entries: [],
  entriesById: new Map(),
  query: '',
  results: [],
  selectedId: '',
  selectedInsight: null,
  loading: false,
  ready: false,
  error: '',
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
  const stationLabel = [entry.subwayLine, entry.subwayStation].filter(Boolean).join(' ');
  const stationDistance = String(entry.subwayDistance || '').trim();
  if (stationLabel && stationDistance) return `${stationLabel} · ${stationDistance}`;
  if (stationLabel) return stationLabel;
  if (stationDistance) return stationDistance;
  return '역 정보 확인 중';
}

function normalizeStationToken(value) {
  return String(value || '')
    .trim()
    .replace(/\s+(?:\d+호선|신분당선|수인분당선|분당선|경의중앙선|경강선|공항철도공항선|공항철도|우이신설선|서해선|인천1호선|인천2호선)$/u, '')
    .replace(/\s+/g, '')
    .replace(/역$/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
}

function normalizeLineToken(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^서울/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
}

function parseStationNameCandidates(rawValue) {
  return String(rawValue || '')
    .split(/[,/]/)
    .map(value => value.trim())
    .filter(Boolean);
}

function parseLineNameCandidates(rawValue) {
  return String(rawValue || '')
    .split(/[,/]/)
    .map(value => value.trim())
    .filter(Boolean);
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

function formatLatestTradeSummary(entry) {
  if (!Number.isFinite(entry.latestTradePrice)) return '최근 실거래 정보 확인 중';
  const parts = [formatPricePoint(entry.latestTradePrice)];
  if (entry.latestDealDate) parts.push(entry.latestDealDate);
  return parts.join(' · ');
}

function isLuxuryPriceTier(entry) {
  const priceCandidates = [
    Number(entry?.latestTradePrice || 0) || null,
    Number(entry?.avgPrice || 0) || null,
  ].filter(Number.isFinite);
  return priceCandidates.some(price => price >= 200000);
}

function formatPriceLevelSummary(entry) {
  if (Number.isFinite(entry?.avgPrice)) return `평균 실거래 ${formatPricePoint(entry.avgPrice)}`;
  if (Number.isFinite(entry?.latestTradePrice)) return `최근 실거래 기준 ${formatPricePoint(entry.latestTradePrice)}`;
  return '가격 레벨 데이터 보강 중';
}

function formatBusinessDistrictSummary(result) {
  if (!result?.available || !result.bestDistrict || !Number.isFinite(result.totalMinutes)) {
    return '서울 지하철 시간 데이터 준비 중';
  }
  return `${result.bestDistrict.label} · ${result.totalMinutes}분`;
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
  if (!Number.isFinite(distance)) return { score: 8, label: '초품아 거리 계산 중' };
  if (distance <= 300) return { score: 40, label: '초품아 성격이 아주 강한 거리' };
  if (distance <= 500) return { score: 34, label: '도보 통학 체감이 좋은 편' };
  if (distance <= 700) return { score: 24, label: '가까운 초등학교 접근성이 무난한 편' };
  if (distance <= 1000) return { score: 14, label: '통학 거리가 아주 짧지는 않은 편' };
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

  const originIds = [];
  stationTokens.forEach(token => {
    const stationIds = dashboardSubwayGraph.nameToStationIds.get(token) || [];
    stationIds.forEach(stationId => {
      const station = dashboardSubwayGraph.stationMap.get(stationId);
      const lineToken = normalizeLineToken(station?.lineName);
      if (!lineTokens.size || lineTokens.has(lineToken)) originIds.push(stationId);
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

  let bestCandidate = null;
  CORE_BUSINESS_DISTRICTS.forEach(district => {
    const targetIds = district.stationNames.flatMap(name => {
      const token = normalizeStationToken(name);
      return dashboardSubwayGraph.nameToStationIds.get(token) || [];
    });
    if (!targetIds.length) return;

    const path = findShortestGraphMinutes(dashboardSubwayGraph, dedupedOriginIds, targetIds);
    if (!path) return;

    const totalMinutes = path.minutes + (Number.isFinite(walkMinutes) ? walkMinutes : 0);
    if (!bestCandidate || totalMinutes < bestCandidate.totalMinutes) {
      bestCandidate = {
        district,
        path,
        totalMinutes,
      };
    }
  });

  if (!bestCandidate) {
    return {
      available: false,
      score: 0,
      label: '대표역 도착 시간을 계산할 서울 구간 데이터가 아직 부족해요.',
      bestDistrict: null,
      totalMinutes: null,
    };
  }

  const totalMinutes = Math.max(1, Math.round(bestCandidate.totalMinutes));
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
  };
}

function computeDashboardApartmentGrade(entry, insight) {
  const businessDistrictResult = computeBusinessDistrictScore(entry, insight);
  const stationDistance = Number.isFinite(insight?.station?.distance)
    ? Number(insight.station.distance)
    : parseTransitWalkDistance(entry?.subwayDistance);
  const schoolDistance = Number.isFinite(insight?.school?.distance)
    ? Number(insight.school.distance)
    : null;
  const dimensions = [
    {
      key: 'school',
      available: Number.isFinite(insight?.school?.distance),
      weight: 34,
      result: computeSchoolScore(insight?.school?.distance),
    },
    {
      key: 'station',
      available: Number.isFinite(insight?.station?.distance),
      weight: 22,
      result: computeStationScore(insight?.station?.distance),
    },
    {
      key: 'businessDistrict',
      available: businessDistrictResult.available,
      weight: 34,
      result: businessDistrictResult,
    },
    {
      key: 'household',
      available: Number.isFinite(entry.householdCount) && entry.householdCount > 0,
      weight: 8,
      result: computeHouseholdScore(entry.householdCount),
    },
    {
      key: 'newBuild',
      available: Number.isFinite(entry.buildYear),
      weight: 12,
      result: computeNewBuildScore(entry.buildYear),
    },
  ];

  const availableDimensions = dimensions.filter(item => item.available);
  const possibleScore = availableDimensions.reduce((sum, item) => sum + item.weight, 0);
  const earnedScore = availableDimensions.reduce((sum, item) => {
    const maxScore = item.key === 'school' ? 40
      : item.key === 'station' ? 25
      : item.key === 'household' ? 8
      : item.key === 'newBuild' ? 12
      : 25;
    return sum + ((item.result.score / maxScore) * item.weight);
  }, 0);

  const normalizedScore = possibleScore > 0
    ? Math.round((earnedScore / possibleScore) * 100)
    : null;

  const sBonusConditions = [
    Number.isFinite(schoolDistance) && schoolDistance <= 400,
    Number.isFinite(entry.householdCount) && entry.householdCount >= 300,
    Number.isFinite(entry.buildYear) && (new Date().getFullYear() - entry.buildYear) <= 15,
  ].filter(Boolean).length;

  const isSGrade = Number.isFinite(businessDistrictResult?.totalMinutes)
    && businessDistrictResult.totalMinutes <= 20
    && Number.isFinite(stationDistance)
    && stationDistance <= 400
    && sBonusConditions >= 2;

  const isCorePremium = Number.isFinite(businessDistrictResult?.totalMinutes)
    && businessDistrictResult.totalMinutes <= 24
    && Number.isFinite(stationDistance)
    && stationDistance <= 550;

  const isLuxuryCorePremium = isLuxuryPriceTier(entry)
    && Number.isFinite(businessDistrictResult?.totalMinutes)
    && businessDistrictResult.totalMinutes <= 30
    && Number.isFinite(stationDistance)
    && stationDistance <= 700;
  const isLuxurySGrade = isLuxuryPriceTier(entry);

  const grade = normalizedScore === null
    ? null
    : isLuxurySGrade ? 'S'
      : isSGrade ? 'S'
      : isLuxuryCorePremium ? 'A'
        : isCorePremium ? 'A'
        : normalizedScore >= 75 ? 'A'
        : normalizedScore >= 55 ? 'B'
          : 'C';

  const missingLabels = dimensions
    .filter(item => !item.available)
    .map(item => item.key === 'school'
      ? '초등학교 거리'
      : item.key === 'station'
        ? '역 거리'
        : item.key === 'household'
          ? '세대수'
          : item.key === 'newBuild'
            ? '준공 정보'
            : '업무지구 접근성');

  return {
    ready: grade !== null,
    grade,
    reasons: [
      ...(isLuxurySGrade ? ['20억 이상 초고가 아파트로 분류되는 최상위 자산가치 단지'] : []),
      ...(isSGrade ? ['핵심 업무지구 20분 안팎으로 닿고 생활 조건도 함께 강한 최상위 입지'] : []),
      ...(!isSGrade && isLuxuryCorePremium ? ['평균 거래가가 높은 핵심 입지로 상급지 해석이 자연스러운 단지'] : []),
      ...availableDimensions.map(item => item.result.label),
      ...(missingLabels.length ? [`아직 ${missingLabels.join(', ')} 데이터는 순차 보강 중이에요.`] : []),
    ].slice(0, 3),
  };
}

function buildDashboardSearchIndex({ codeMap, households, trades }) {
  const householdByCode = new Map();
  const householdByKey = new Map();
  (households?.entries || []).forEach(entry => {
    if (entry?.kaptCode) householdByCode.set(entry.kaptCode, entry);
    const key = buildDashboardAptCompositeKey(entry.sigunguName, entry.umdName, entry.aptName);
    if (key) householdByKey.set(key, entry);
  });

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
      subwayLine: household?.subwayLine || '',
      subwayStation: household?.subwayStation || '',
      subwayDistance: household?.subwayDistance || '',
      busDistance: household?.busDistance || '',
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

  const [codeMapRes, householdsRes, trades] = await Promise.all([
    fetch(DASHBOARD_APT_CODE_MAP_URL, { cache: 'no-store' }),
    fetch(DASHBOARD_APT_HOUSEHOLDS_URL, { cache: 'no-store' }),
    preloadAptTrades(),
  ]);

  if (!codeMapRes.ok) throw new Error('단지 목록을 불러오지 못했어요.');
  if (!householdsRes.ok) throw new Error('단지 기본정보를 불러오지 못했어요.');

  const [codeMap, households] = await Promise.all([
    codeMapRes.json(),
    householdsRes.json(),
  ]);
  const entries = buildDashboardSearchIndex({ codeMap, households, trades });
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

  const entry = getDashboardSelectedEntry();
  const summary = entry
    ? `${entry.aptName} · ${entry.regionLabel} ${entry.displayLocation}`
    : '서울·경기 아파트 검색';

  mount.innerHTML = `
    <button class="db-apt-search-trigger" type="button" onclick="showAptSearchScreen()">
      <div class="db-apt-search-trigger-icon">⌕</div>
      <div class="db-apt-search-trigger-copy">
        <strong>${escapeHtml(summary)}</strong>
        <span>초품아, 가까운 역, 세대수, 업무지구 접근성 보기</span>
      </div>
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
          <button class="db-apt-search-btn" type="button" onclick="submitDashboardAptSearch()">검색</button>
        </div>
      </div>
      <div class="db-apt-page-body">
        <div class="db-apt-finder-copy">단지명과 지역명을 함께 입력하면 초품아 거리, 가까운 역, 세대수, 신축 여부와 핵심 업무지구 접근성을 함께 보여드려요.</div>
        <div class="db-apt-search-hint" id="dbAptSearchHint"></div>
        <div class="db-apt-search-results" id="dbAptSearchResults"></div>
        <div class="db-apt-search-selected" id="dbAptSearchSelected"></div>
      </div>
    </div>
  `;
}

function renderDashboardAptSearchHint() {
  const hint = document.getElementById('dbAptSearchHint');
  if (!hint) return;

  if (dashboardAptSearchState.error) {
    hint.textContent = dashboardAptSearchState.error;
    return;
  }

  if (dashboardAptSearchState.loading && !dashboardAptSearchState.ready) {
    hint.textContent = '검색 인덱스를 준비하는 중이에요.';
    return;
  }

  const scopeLabel = getDashboardAptRegionLabel();
  if (!dashboardAptSearchState.query.trim()) {
    hint.textContent = `${scopeLabel} 단지 기준으로 자동완성을 보여드려요. 예: 마포, 위례, 광교, 경희궁자이`;
    return;
  }

  if (!dashboardAptSearchState.results.length) {
    hint.textContent = `입력한 조건과 가까운 ${scopeLabel} 단지를 아직 찾지 못했어요. 지역명과 단지명을 함께 넣어보세요.`;
    return;
  }

  hint.textContent = `${scopeLabel} 범위에서 ${dashboardAptSearchState.results.length}개 후보를 찾았어요.`;
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
        <em>${escapeHtml(formatLatestTradeSummary(entry))}</em>
      </div>
    </button>
  `).join('');
}

function renderDashboardSelectedApartment() {
  const target = document.getElementById('dbAptSearchSelected');
  if (!target) return;

  const entry = getDashboardSelectedEntry();
  if (!entry) {
    target.innerHTML = '';
    return;
  }

  const insight = dashboardAptSearchState.selectedInsight;
  const gradeData = insight?.ready ? computeDashboardApartmentGrade(entry, insight) : null;
  const businessDistrictData = insight?.ready ? computeBusinessDistrictScore(entry, insight) : null;
  const isGradeReady = gradeData?.ready && gradeData?.grade;
  const gradeClass = isGradeReady ? `grade-${gradeData.grade.toLowerCase()}` : 'grade-pending';
  const stationText = insight?.station?.placeName
    ? `${insight.station.placeName} · 직선 ${formatDistance(insight.station.distance)}`
    : formatStationFallback(entry);
  const schoolText = insight?.school?.placeName
    ? `${insight.school.placeName} · 직선 ${formatDistance(insight.school.distance)}`
    : (insight?.failed ? '초등학교 거리 확인 중' : '초등학교 거리 계산 중');
  const areaText = entry.avgTradeArea ? `${formatAreaToPyeong(entry.avgTradeArea)} 중심 거래` : '대표 평형 확인 중';
  const statusText = insight?.failed
    ? '지도 검색이 일부 느려서, 확보된 데이터 기준으로 먼저 보여드리고 있어요.'
    : insight?.ready
      ? '선택한 단지 기준으로 입지 요소를 묶어서 정리했어요.'
      : '카카오맵 기준으로 초등학교와 역 거리를 계산하고 있어요.';

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
          <strong>${isGradeReady ? gradeData.grade : '…'}</strong>
        </div>
      </div>
      <p class="db-apt-grade-status">${escapeHtml(statusText)}</p>
      <div class="db-apt-grade-grid">
        <div class="db-apt-grade-chip">
          <span>초품아</span>
          <strong>${escapeHtml(schoolText)}</strong>
        </div>
        <div class="db-apt-grade-chip">
          <span>가까운 역</span>
          <strong>${escapeHtml(stationText)}</strong>
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
          <strong>${escapeHtml(formatBusinessDistrictSummary(businessDistrictData))}</strong>
        </div>
        <div class="db-apt-grade-chip">
          <span>최근 실거래</span>
          <strong>${escapeHtml(formatLatestTradeSummary(entry))}</strong>
        </div>
        <div class="db-apt-grade-chip">
          <span>가격 레벨</span>
          <strong>${escapeHtml(formatPriceLevelSummary(entry))}</strong>
        </div>
        <div class="db-apt-grade-chip">
          <span>거래 평형</span>
          <strong>${escapeHtml(areaText)}</strong>
        </div>
      </div>
      <div class="db-apt-grade-summary">
        <div class="db-apt-grade-reasons">
          ${(gradeData?.reasons || ['초품아 거리와 가까운 역 거리를 우선 정리하는 중이에요.']).map(reason => `<p>${escapeHtml(reason)}</p>`).join('')}
        </div>
      </div>
    </article>
  `;
}

function syncDashboardAptSearchUi() {
  renderDashboardAptSearchBar();
  renderAptSearchScreenLayout();
  renderDashboardAptSearchHint();
  renderDashboardAptSearchResults();
  renderDashboardSelectedApartment();
}

function renderDashboardAptSearchSection() {
  syncDashboardAptSearchUi();
  loadDashboardAptSearchIndex().catch(() => {});
  loadDashboardSubwayGraph().catch(() => {});
}

function handleDashboardAptSearchInput(event) {
  dashboardAptSearchState.query = event?.target?.value || '';
  dashboardAptSearchState.selectedInsight = null;
  updateDashboardAptSearchResults();
  renderDashboardAptSearchHint();
  renderDashboardAptSearchResults();
}

function handleDashboardAptSearchFocus() {
  updateDashboardAptSearchResults();
  renderDashboardAptSearchHint();
  renderDashboardAptSearchResults();
}

function handleDashboardAptSearchKeydown(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  submitDashboardAptSearch();
}

function submitDashboardAptSearch() {
  updateDashboardAptSearchResults();
  const first = dashboardAptSearchState.results[0];
  if (first) pickDashboardApartment(first.id);
  else {
    renderDashboardAptSearchHint();
    renderDashboardAptSearchResults();
  }
}

function hydrateDashboardApartmentInsight(entry) {
  const cacheKey = `dashboard_apt_insight_${entry.id}`;
  const memoryCached = dashboardAptSearchInsightCache.get(cacheKey);
  if (memoryCached) {
    dashboardAptSearchState.selectedInsight = memoryCached;
    renderDashboardSelectedApartment();
    return;
  }

  const requestId = ++dashboardAptSearchHydrateSeq;
  dashboardAptSearchState.selectedInsight = { ready: false, failed: false };
  renderDashboardSelectedApartment();

  const locationSeed = {
    aptName: entry.aptName,
    sigunguName: entry.sigunguName,
    umdName: entry.umdName,
  };

  Promise.resolve()
    .then(() => searchComplexLocation(locationSeed))
    .then(location => Promise.all([
      Promise.resolve(location),
      location ? searchNearestStation(location) : Promise.resolve(null),
      location ? searchNearestElementarySchool(location) : Promise.resolve(null),
    ]))
    .then(([location, station, school]) => {
      if (requestId !== dashboardAptSearchHydrateSeq) return;
      const insight = {
        ready: true,
        failed: false,
        location,
        station,
        school,
      };
      dashboardAptSearchInsightCache.set(cacheKey, insight);
      dashboardAptSearchState.selectedInsight = insight;
      renderDashboardSelectedApartment();
    })
    .catch(() => {
      if (requestId !== dashboardAptSearchHydrateSeq) return;
      dashboardAptSearchState.selectedInsight = { ready: true, failed: true, station: null, school: null };
      renderDashboardSelectedApartment();
    });
}

function pickDashboardApartment(id) {
  const entry = dashboardAptSearchState.entriesById.get(id);
  if (!entry) return;

  dashboardAptSearchState.selectedId = id;
  dashboardAptSearchState.query = `${entry.aptName} ${entry.displayLocation}`.trim();
  dashboardAptSearchState.results = [];
  syncDashboardAptSearchUi();

  const input = document.getElementById('dbAptSearchInput');
  if (input) input.value = dashboardAptSearchState.query;
  hydrateDashboardApartmentInsight(entry);
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
window.submitDashboardAptSearch = submitDashboardAptSearch;
window.pickDashboardApartment = pickDashboardApartment;
