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
const NINE_LINE_944_BENEFIT_CODES = new Set(['A10026523', 'A10028065']);

let subwayGraphCache = null;

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
  if (distance <= 400) return { score: 25, label: '역세권 체감이 강한 거리' };
  if (distance <= 700) return { score: 20, label: '도보 접근성이 괜찮은 편' };
  if (distance <= 1000) return { score: 12, label: '걸어서 접근 가능하지만 체감은 갈릴 수 있음' };
  return { score: 5, label: '역 접근은 다소 거리가 있는 편' };
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

function computeAptGrade(entry, insight, graph) {
  const businessDistrictResult = computeBusinessDistrictScore(entry, insight, graph);
  const stationDistance = Number.isFinite(insight?.station?.distance)
    ? Number(insight.station.distance)
    : parseTransitWalkDistance(entry?.subwayDistance);
  const schoolDistance = Number.isFinite(insight?.school?.distance)
    ? Number(insight.school.distance)
    : (Number.isFinite(Number(entry?.schoolDistance)) && Number(entry.schoolDistance) > 0 ? Number(entry.schoolDistance) : null);
  const priceLevelSource = getPriceLevelSource(entry);
  const priceLevelResult = computePriceLevelScore(entry);
  const hasOfficialFallback = priceLevelSource === 'official-fallback';
  const locationTier = getLocationTier(entry);
  const tierScore = LOCATION_TIER_SCORES[locationTier.tier] || LOCATION_TIER_SCORES.T5;
  const transportAdjustment = computeTransportAdjustment(entry, stationDistance, businessDistrictResult, locationTier.tier);
  const infraAdjustment = computeInfraAdjustment(entry, schoolDistance);
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
  const rawScore = tierScore.base + transportAdjustment.score + infraAdjustment.score;
  const clampedScore = clampNumber(rawScore, tierScore.min, tierScore.max);
  const grade = gradeFromLocationScore(clampedScore);
  const reasons = [
    `${locationTier.label} 기준으로 기본 등급 범위를 먼저 잡았어요.`,
    ...(transportAdjustment.items.length ? [transportAdjustment.items.slice().sort((a, b) => b.points - a.points)[0].label] : []),
    ...(infraAdjustment.items.length ? [infraAdjustment.items.slice().sort((a, b) => b.points - a.points)[0].label] : []),
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
    return jsonResponse(200, { ok: true, ...computeAptGrade(entry, insight, graph) });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message || 'Apartment analysis failed.' });
  }
};

exports._private = {
  buildDashboardSubwayGraph,
  computeAptGrade,
};
