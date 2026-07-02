const DASHBOARD_APT_AREA_PRICES_BASE_URL = '/data/apt-area-prices';
const DASHBOARD_APT_CODE_MAP_URL = '/data/apt-code-map.json?v=20260506b';
const DASHBOARD_APT_HOUSEHOLDS_URL = '/data/apt-households.json?v=20260506b';
const DASHBOARD_APT_SCHOOL_META_URL = '/data/apt-school-meta.json?v=20260507a';
const DASHBOARD_APT_STATION_META_URL = '/data/apt-station-meta.json?v=20260518a';
const DASHBOARD_APT_OFFICIAL_PRICE_META_URL = '/data/apt-official-price-meta.json?v=20260517a';
const DASHBOARD_APT_CONVENIENCE_META_URL = '/data/apt-convenience-meta.json?v=20260518a';
const DASHBOARD_APT_ANALYZE_URL = '/api/analyze-apt';
const DASHBOARD_APT_SEARCH_CACHE_KEY = 'dashboard_apt_search_index_v11';
const DASHBOARD_APT_SEARCH_CACHE_TTL = 14 * 24 * 60 * 60 * 1000;

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
const dashboardAptSearchInsightCache = new Map();
const dashboardAptAreaPricesCache = new Map();
const dashboardAptGradeCache = new Map();
const dashboardAptTaxBasisSelection = new Map();

function getAptGradeKey(entry) {
  return entry?.kaptCode || entry?.id || '';
}

function getCachedAptGrade(entry) {
  const key = getAptGradeKey(entry);
  if (!key || !dashboardAptGradeCache.has(key)) return undefined;
  return dashboardAptGradeCache.get(key);
}

async function fetchAptAreaPrices(kaptCode) {
  if (!kaptCode) return null;
  if (dashboardAptAreaPricesCache.has(kaptCode)) return dashboardAptAreaPricesCache.get(kaptCode);

  try {
    const res = await fetch(`${DASHBOARD_APT_AREA_PRICES_BASE_URL}/${kaptCode}.json`, { cache: 'no-store' });
    if (!res.ok) {
      dashboardAptAreaPricesCache.set(kaptCode, null);
      return null;
    }
    const data = await res.json();
    dashboardAptAreaPricesCache.set(kaptCode, data);
    return data;
  } catch {
    dashboardAptAreaPricesCache.set(kaptCode, null);
    return null;
  }
}

function buildAptAnalysisPayload(entry, insight) {
  return {
    entry: {
      id: entry.id || '',
      kaptCode: entry.kaptCode || '',
      aptName: entry.aptName || '',
      sigunguName: entry.sigunguName || '',
      umdName: entry.umdName || '',
      regionKey: entry.regionKey || '',
      householdCount: Number(entry.householdCount || 0) || null,
      buildYear: Number(entry.buildYear || 0) || null,
      latestTradePrice: Number(entry.latestTradePrice || 0) || null,
      avgPrice: Number(entry.avgPrice || 0) || null,
      medianOfficialPrice: Number(entry.medianOfficialPrice || 0) || null,
      avgOfficialPrice: Number(entry.avgOfficialPrice || 0) || null,
      subwayLine: entry.subwayLine || '',
      subwayStation: entry.subwayStation || '',
      subwayDistance: entry.subwayDistance || '',
      stationMetaName: entry.stationMetaName || '',
      stationMetaDistance: Number(entry.stationMetaDistance || 0) || null,
      schoolName: entry.schoolName || '',
      schoolDistance: Number(entry.schoolDistance || 0) || null,
      convenienceHospital: entry.convenienceHospital || null,
      convenienceMart: entry.convenienceMart || null,
      convenienceDept: entry.convenienceDept || null,
      conveniencePark: entry.conveniencePark || null,
    },
    insight: {
      ready: true,
      station: insight?.station || null,
      school: insight?.school || null,
    },
  };
}

async function fetchAptGrade(entry, insight) {
  const key = getAptGradeKey(entry);
  if (!key) return null;
  if (dashboardAptGradeCache.has(key)) return dashboardAptGradeCache.get(key);

  try {
    const response = await fetch(DASHBOARD_APT_ANALYZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAptAnalysisPayload(entry, insight)),
    });
    if (!response.ok) throw new Error('단지 분석 결과를 불러오지 못했어요.');
    const data = await response.json();
    const grade = data?.ok === false ? { error: true } : data;
    dashboardAptGradeCache.set(key, grade);
    return grade;
  } catch (error) {
    const failedGrade = { error: true };
    dashboardAptGradeCache.set(key, failedGrade);
    return failedGrade;
  }
}
const dashboardAptSearchState = {
  entries: [],
  entriesById: new Map(),
  query: '',
  lastSearchQuery: '',
  results: [],
  selectedId: '',
  selectedInsight: null,
  isEditing: false,
  gradeLoadingKey: '',
  aptAnalysisPaywallPromptedKey: '',
  loading: false,
  ready: false,
  error: '',
};
const dashboardAptLoanState = {
  entryId: '',
  loanType: 'fund',
  price: '',
  selectedAreaBucket: '',
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

function hasNineLineBenefitCandidate(entry) {
  if (entry?.kaptCode && NINE_LINE_944_BENEFIT_CODES.has(String(entry.kaptCode))) {
    return true;
  }
  const name = normalizePlaceToken(entry?.aptName || '');
  return NINE_LINE_944_BENEFIT_NAMES.some(candidate => name.includes(candidate));
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

function formatAreaPriceManwon(price) {
  if (!Number.isFinite(price) || price <= 0) return '';
  const eok = price / 10000;
  const formatted = Number.isInteger(eok) ? String(eok) : eok.toFixed(1).replace(/\.0$/, '');
  return `${formatted}억`;
}

function formatShortTradeDate(dateText) {
  const raw = String(dateText || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function renderAreaPricesSectionHtml(areaPrices) {
  if (!areaPrices?.byArea) return '';
  const entries = Object.entries(areaPrices.byArea)
    .sort((a, b) => {
      const aSize = parseInt(a[0], 10);
      const bSize = parseInt(b[0], 10);
      return aSize - bSize;
    });
  if (!entries.length) return '';

  const rows = entries.map(([bucket, data]) => {
    const avg = formatAreaPriceManwon(data.avgPrice);
    const latest = formatAreaPriceManwon(data.latestPrice);
    const countLabel = `${data.tradeCount}건`;
    const latestDate = formatShortTradeDate(data.latestDate);
    const latestLabel = latest ? `최근 ${latest}${latestDate ? ` · ${latestDate}` : ''}` : '';
    const highLabel = data.recentHigh?.within3M ? (data.recentHigh.label || '최근 최고가') : '';
    return `
      <div class="db-apt-area-row">
        <span class="db-apt-area-bucket">${escapeHtml(bucket)}</span>
        <span class="db-apt-area-price">
          <span class="db-apt-area-price-main">${escapeHtml(avg)}</span>
          ${latestLabel ? `<span class="db-apt-area-price-sub">${escapeHtml(latestLabel)}${highLabel ? ` <em class="db-apt-area-high">${escapeHtml(highLabel)}</em>` : ''}</span>` : ''}
        </span>
        <span class="db-apt-area-count">${escapeHtml(countLabel)}</span>
      </div>
    `;
  }).join('');

  return `
    <div class="db-apt-area-prices-section">
      <div class="db-apt-convenience-divider">── 평형별 실거래 ──</div>
      <div class="db-apt-area-rows">${rows}</div>
      <div class="db-apt-area-note">최근 12개월 실거래 기준 · 2건 이상 평형만 표시</div>
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

// 단지 상세의 "뒤로" 동작 분기 — 추천 등 다른 진입점에서 재사용할 때 백 목적지를 바꾼다.
// (단지 상세 UI 자체는 그대로 한 곳에서만 관리)
let aptSearchBackOverride = null; // { label, handler }
function setAptSearchBackOverride(o) { aptSearchBackOverride = o || null; }
function handleAptSearchBack() {
  if (aptSearchBackOverride && typeof aptSearchBackOverride.handler === 'function') {
    const h = aptSearchBackOverride.handler;
    aptSearchBackOverride = null;
    h();
    return;
  }
  showDashboard();
}
if (typeof window !== 'undefined') {
  window.setAptSearchBackOverride = setAptSearchBackOverride;
  window.handleAptSearchBack = handleAptSearchBack;
}

function renderAptSearchScreenLayout() {
  const screen = document.getElementById('aptSearchScreen');
  if (!screen) return;

  const backLabel = aptSearchBackOverride ? aptSearchBackOverride.label : '← 대시보드로';
  screen.innerHTML = `
    <div class="db-apt-page">
      <div class="db-apt-page-sticky">
        <div class="db-topbar">
          <button class="db-back-btn" type="button" onclick="handleAptSearchBack()">${backLabel}</button>
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
        <div class="db-apt-finder-copy">단지명과 지역명을 함께 입력하면 초등학교 도보권, 가까운 역, 세대수, 신축 여부와 핵심 업무지구 접근성을 함께 보여드려요.</div>
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

function getAptAnalysisStatus(entry, cachedGrade) {
  const key = getAptGradeKey(entry);
  if (key && dashboardAptSearchState.gradeLoadingKey === key) return 'loading';
  if (cachedGrade?.error) return 'error';
  if (!dashboardAptSearchState.selectedInsight && !cachedGrade) return 'loading';
  if (!cachedGrade) return 'error';
  if (isDashboardAptAnalysisUnlocked()) return 'unlocked';
  return 'paywall';
}

function renderAptGradeSkeletonCard(entry, hasNineLineBenefit) {
  return `
    <article class="db-apt-grade-card">
      <div class="db-apt-grade-head">
        <div>
          <div class="db-fact-label">단지 간단 등급</div>
          <strong>${escapeHtml(entry.aptName)}</strong>
          <span>${escapeHtml(entry.regionLabel)} · ${escapeHtml(entry.displayLocation)}</span>
        </div>
        <div class="db-apt-grade-badge grade-pending db-apt-grade-skeleton-badge">
          <span class="db-apt-skeleton-line short"></span>
          <strong class="db-apt-skeleton-line mark"></strong>
        </div>
      </div>
      <p class="db-apt-grade-status">
        <span class="db-apt-skeleton-line wide"></span>
      </p>
      ${hasNineLineBenefit ? `
        <div class="db-apt-benefit-badges">
          <span class="db-apt-benefit-badge">9호선 연장 수혜 예상</span>
          <span class="db-apt-benefit-badge is-muted">강동하남남양주선 기본계획 기준</span>
        </div>
      ` : ''}
      <div class="db-apt-grade-grid">
        ${Array.from({ length: 6 }).map(() => `
          <div class="db-apt-grade-chip db-apt-grade-chip-skeleton">
            <span class="db-apt-skeleton-line label"></span>
            <strong class="db-apt-skeleton-line body"></strong>
            <em class="db-apt-skeleton-line small"></em>
          </div>
        `).join('')}
      </div>
      <div class="db-apt-grade-summary">
        <div class="db-apt-grade-reasons">
          <p><span class="db-apt-skeleton-line wide"></span></p>
          <p><span class="db-apt-skeleton-line medium"></span></p>
        </div>
      </div>
    </article>
  `;
}

function renderAptGradeErrorCard(entry) {
  const refreshIcon = typeof icon === 'function' ? icon('rotateCcw', 18) : '';
  return `
    <article class="db-apt-grade-card db-apt-grade-card--error">
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
      <p class="db-apt-grade-status">분석 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
      <button class="db-apt-analysis-retry-btn" type="button" onclick="retryDashboardAptGrade()">
        <span>${refreshIcon}</span>
        다시 시도
      </button>
    </article>
  `;
}

function renderAptGradePaywallPlaceholderCard(entry, insight, hasNineLineBenefit) {
  const stationText = formatStationSummary(entry, insight);
  const schoolDistance = getSchoolMetaDistance(entry);
  const schoolText = entry.schoolName && Number.isFinite(schoolDistance)
    ? `${entry.schoolName} · 직선 ${formatDistance(schoolDistance)}`
    : '초등학교 거리 확인 중';
  const schoolParts = splitDistanceLabel(schoolText);
  const stationParts = splitDistanceLabel(stationText);
  return `
    <article class="db-apt-grade-card">
      <div class="db-apt-grade-head">
        <div>
          <div class="db-fact-label">단지 간단 등급</div>
          <strong>${escapeHtml(entry.aptName)}</strong>
          <span>${escapeHtml(entry.regionLabel)} · ${escapeHtml(entry.displayLocation)}</span>
        </div>
        <div class="db-apt-grade-badge grade-pending">
          <span>분석</span>
          <strong>준비</strong>
        </div>
      </div>
      <p class="db-apt-grade-status">단지 분석을 준비했어요. 자세한 등급과 판단 사유는 결제 후 확인할 수 있어요.</p>
      ${hasNineLineBenefit ? `
        <div class="db-apt-benefit-badges">
          <span class="db-apt-benefit-badge">9호선 연장 수혜 예상</span>
          <span class="db-apt-benefit-badge is-muted">강동하남남양주선 기본계획 기준</span>
        </div>
      ` : ''}
      <div class="db-apt-grade-grid">
        <div class="db-apt-grade-chip">
          <span>초등학교</span>
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
          <strong>결제 후 확인</strong>
        </div>
        <div class="db-apt-grade-chip">
          <span>가격 레벨</span>
          <strong>${escapeHtml(formatPriceLevelSummary(entry))}</strong>
        </div>
      </div>
    </article>
  `;
}

function queueAptAnalysisPaywall(entry) {
  const key = getAptGradeKey(entry);
  if (!key || dashboardAptSearchState.aptAnalysisPaywallPromptedKey === key) return;
  dashboardAptSearchState.aptAnalysisPaywallPromptedKey = key;

  const tryOpen = (attempt = 0) => {
    if (dashboardAptSearchState.selectedId !== entry.id) return;
    if (isDashboardAptAnalysisUnlocked()) return;
    if (typeof window.openPaySheet === 'function') {
      openAptAnalysisPaywallSheet();
      return;
    }
    if (attempt < 10) {
      window.setTimeout(() => tryOpen(attempt + 1), 100);
    }
  };

  window.setTimeout(() => tryOpen(), 120);
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
    const cachedGrade = getCachedAptGrade(entry);
    const analysisStatus = getAptAnalysisStatus(entry, cachedGrade);
    const gradeData = analysisStatus === 'unlocked' ? cachedGrade : null;
    const hasNineLineBenefit = hasNineLineBenefitCandidate(entry);
    if (analysisStatus === 'loading') {
      target.innerHTML = renderAptGradeSkeletonCard(entry, hasNineLineBenefit);
      target.dataset.renderedEntryId = entry.id;
      return;
    }
    if (analysisStatus === 'error') {
      target.innerHTML = renderAptGradeErrorCard(entry);
      if (typeof window.renderIcons === 'function') window.renderIcons(target);
      target.dataset.renderedEntryId = entry.id;
      return;
    }
    if (analysisStatus === 'paywall') {
      target.innerHTML = renderAptGradePaywallPlaceholderCard(entry, insight, hasNineLineBenefit);
      target.dataset.renderedEntryId = entry.id;
      queueAptAnalysisPaywall(entry);
      return;
    }
    const businessDistrictData = gradeData?.businessDistrict || null;
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
            <span>초등 도보권</span>
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
        ${renderAreaPricesSectionHtml(insight?.areaPrices)}
        ${renderDashboardAptTaxSummaryHtml(entry, insight?.areaPrices)}
        <div class="db-apt-grade-summary">
          <div class="db-apt-grade-reasons">
            ${(gradeData?.reasons || ['초등학교 도보권과 가까운 역 거리를 우선 정리하는 중이에요.']).map(reason => `<p>${escapeHtml(reason)}</p>`).join('')}
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

function getDashboardAptFallbackBasisPriceManwon(entry) {
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

function getDashboardAptTaxAreaOptions(areaPrices) {
  const byArea = areaPrices?.byArea || null;
  if (!byArea) return [];
  return Object.entries(byArea)
    .map(([bucket, data]) => ({
      bucket,
      avgPrice: Number(data?.avgPrice || 0),
      tradeCount: Number(data?.tradeCount || 0),
    }))
    .filter(item => Number.isFinite(item.avgPrice) && item.avgPrice > 0)
    .sort((a, b) => {
      const aSize = parseInt(a.bucket, 10);
      const bSize = parseInt(b.bucket, 10);
      return aSize - bSize;
    });
}

function getDashboardAptTaxDefaultBucket(options) {
  if (!options.length) return '';
  const preferred84 = options.find(item => parseInt(item.bucket, 10) === 84);
  if (preferred84) return preferred84.bucket;
  return options.slice().sort((a, b) => {
    if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
    return parseInt(a.bucket, 10) - parseInt(b.bucket, 10);
  })[0]?.bucket || '';
}

function getDashboardAptTaxBasisKey(entry) {
  return entry?.kaptCode || entry?.id || '';
}

function getDashboardAptTaxBasis(areaPrices, entry) {
  const options = getDashboardAptTaxAreaOptions(areaPrices);
  const selectionKey = getDashboardAptTaxBasisKey(entry);
  const selectedBucket = selectionKey ? dashboardAptTaxBasisSelection.get(selectionKey) : '';
  if (options.length) {
    const fallbackBucket = getDashboardAptTaxDefaultBucket(options);
    const selected = options.find(item => item.bucket === selectedBucket) || options.find(item => item.bucket === fallbackBucket) || options[0];
    return {
      priceManwon: selected.avgPrice,
      label: selected.bucket + ' ' + formatDashboardAptPriceEok(selected.avgPrice) + '억 기준',
      bucket: selected.bucket,
      options,
      source: 'area',
    };
  }

  const fallbackPrice = getDashboardAptFallbackBasisPriceManwon(entry);
  return fallbackPrice ? {
    priceManwon: fallbackPrice,
    label: formatDashboardAptPriceEok(fallbackPrice) + '억 기준',
    bucket: '',
    options: [],
    source: 'fallback',
  } : null;
}

function selectDashboardAptTaxBasis(entryKey, bucket) {
  if (!entryKey || !bucket) return;
  dashboardAptTaxBasisSelection.set(entryKey, bucket);
  renderDashboardSelectedApartment();
}
window.selectDashboardAptTaxBasis = selectDashboardAptTaxBasis;

function formatDashboardAptPriceEok(priceManwon) {
  if (!Number.isFinite(priceManwon) || priceManwon <= 0) return '';
  const eok = priceManwon / 10000;
  return Number.isInteger(eok) ? String(eok) : eok.toFixed(1).replace(/\.0$/, '');
}
function formatDashboardTaxWon(won) {
  const value = Math.max(0, Math.round(Number(won) || 0));
  if (value >= 100000000) {
    const eok = value / 100000000;
    return (Number.isInteger(eok) ? String(eok) : eok.toFixed(1).replace(/\.0$/, '')) + '억원';
  }
  return Math.round(value / 10000).toLocaleString() + '만원';
}

function getDashboardAptOfficialPriceEok(entry, priceEok, preferEstimate = false) {
  if (preferEstimate) {
    const tax = window.RealEstateTax;
    return { officialPriceEok: tax?.estimateOfficialPriceEok ? tax.estimateOfficialPriceEok(priceEok) : priceEok * 0.65, isEstimated: true };
  }
  const officialManwon = [
    Number(entry?.medianOfficialPrice || 0),
    Number(entry?.avgOfficialPrice || 0),
    Number(entry?.maxOfficialPrice || 0),
  ].find(value => Number.isFinite(value) && value > 0);
  if (officialManwon) return { officialPriceEok: officialManwon / 10000, isEstimated: false };
  const tax = window.RealEstateTax;
  return { officialPriceEok: tax?.estimateOfficialPriceEok ? tax.estimateOfficialPriceEok(priceEok) : priceEok * 0.65, isEstimated: true };
}

function renderDashboardAptTaxSummaryHtml(entry, areaPrices) {
  const tax = window.RealEstateTax;
  if (!tax || !entry) return '';
  const basis = getDashboardAptTaxBasis(areaPrices, entry);
  const priceManwon = Number(basis?.priceManwon || 0);
  const priceEok = priceManwon / 10000;
  if (!(priceEok > 0)) return '';

  const acquisition = tax.calculateAcquisitionTax({
    priceEok,
    homeCount: 1,
    isRegulatedArea: false,
    isOver85: false,
  });
  const official = getDashboardAptOfficialPriceEok(entry, priceEok, basis.source === 'area');
  const property = tax.calculatePropertyTax({
    officialPriceEok: official.officialPriceEok,
    isEstimated: official.isEstimated,
    isOneHouseholdOneHome: true,
  });
  const jongboo = tax.getJongbooPossibility({
    officialPriceEok: official.officialPriceEok,
    isOneHouseholdOneHome: true,
  });
  const officialLabel = official.isEstimated ? '공시가격 추정 기준' : '공시가격 기준';

  const entryKey = getDashboardAptTaxBasisKey(entry);
  const basisSelectHtml = basis.options?.length
    ? '<select class="db-apt-tax-select" aria-label="세금 계산 기준 평형" onchange="selectDashboardAptTaxBasis(' + escapeHtml(JSON.stringify(entryKey)) + ', this.value)">'
      + basis.options.map(option => '<option value="' + escapeHtml(option.bucket) + '"' + (option.bucket === basis.bucket ? ' selected' : '') + '>' + escapeHtml(option.bucket + ' ' + formatDashboardAptPriceEok(option.avgPrice) + '억') + '</option>').join('')
      + '</select>'
    : '<strong>' + escapeHtml(basis.label) + '</strong>';

  return ''
    + '<section class="db-apt-tax-card">'
    + '<div class="db-apt-tax-head"><span>세금 예상</span><div class="db-apt-tax-control">' + basisSelectHtml + '</div></div>'
    + '<div class="db-apt-tax-grid">'
    + '<div class="db-apt-tax-item"><span>예상 취득세 등</span><strong>' + escapeHtml(formatDashboardTaxWon(acquisition.total)) + '</strong><em>1주택·전용 85㎡ 이하</em></div>'
    + '<div class="db-apt-tax-item"><span>예상 재산세 등</span><strong>' + escapeHtml(formatDashboardTaxWon(property.total)) + '</strong><em>' + escapeHtml(officialLabel) + '</em></div>'
    + '</div>'
    + '<div class="db-apt-tax-jongboo ' + (jongboo.status === 'check' ? 'is-check' : '') + '"><strong>' + escapeHtml(jongboo.label) + '</strong><span>' + escapeHtml(jongboo.desc) + '</span></div>'
    + '<p>감면·공제와 보유 주택 합산에 따라 실제 세액은 달라질 수 있어요.</p>'
    + '</section>';
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

function renderAptLoanAreaSelector(areaPrices) {
  if (!areaPrices?.byArea) return '';
  const entries = Object.entries(areaPrices.byArea)
    .sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
  if (!entries.length) return '';

  const options = entries.map(([bucket, data]) => {
    const eok = formatDashboardAptPriceEok(data.avgPrice);
    const label = eok ? `${bucket} · 평균 ${eok}억` : bucket;
    const isSelected = dashboardAptLoanState.selectedAreaBucket === bucket;
    return `<button class="apt-loan-area-btn${isSelected ? ' active' : ''}" type="button"
      data-bucket="${escapeHtml(bucket)}"
      data-price="${data.avgPrice || ''}"
      onclick="selectAptLoanAreaBucket('${escapeHtml(bucket)}', ${data.avgPrice || 0})"
    >${escapeHtml(label)}</button>`;
  }).join('');

  return `<div class="apt-loan-area-selector"><div class="apt-loan-area-label">평형 선택 시 가격 자동 입력</div><div class="apt-loan-area-btns">${options}</div></div>`;
}

function selectAptLoanAreaBucket(bucket, priceManwon) {
  dashboardAptLoanState.selectedAreaBucket = bucket;
  const eok = formatDashboardAptPriceEok(priceManwon);
  if (eok) {
    const input = document.getElementById('aptLoanPriceInput');
    if (input) {
      input.value = eok;
      dashboardAptLoanState.price = eok;
      updateAptLoanSheetState();
    }
  }
  document.querySelectorAll('.apt-loan-area-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bucket === bucket);
  });
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

  const insight = dashboardAptSearchState.selectedInsight;
  const areaPrices = insight?.areaPrices || null;
  const priceManwon = getDashboardAptBasisPriceManwon(entry);
  const basisPrice = formatDashboardAptPriceEok(priceManwon);
  dashboardAptLoanState.entryId = entry.id;
  dashboardAptLoanState.price = basisPrice;
  dashboardAptLoanState.selectedAreaBucket = '';
  input.value = basisPrice;

  const areaSelectorEl = document.getElementById('aptLoanAreaSelector');
  if (areaSelectorEl) areaSelectorEl.innerHTML = renderAptLoanAreaSelector(areaPrices);

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

function requestDashboardAptGrade(entry, insight, { force = false } = {}) {
  const key = getAptGradeKey(entry);
  if (!key) return;
  if (!force && dashboardAptGradeCache.has(key)) return;
  if (dashboardAptSearchState.gradeLoadingKey === key) return;

  dashboardAptSearchState.gradeLoadingKey = key;
  renderDashboardSelectedApartment();

  fetchAptGrade(entry, insight)
    .then(() => {
      const cacheKey = `dashboard_apt_insight_${entry.id}`;
      dashboardAptSearchInsightCache.set(cacheKey, insight);
      if (dashboardAptSearchState.selectedId === entry.id) {
        dashboardAptSearchState.selectedInsight = insight;
      }
    })
    .finally(() => {
      if (dashboardAptSearchState.gradeLoadingKey === key) {
        dashboardAptSearchState.gradeLoadingKey = '';
      }
      if (dashboardAptSearchState.selectedId === entry.id) {
        renderDashboardSelectedApartment();
      }
    });
}

function retryDashboardAptGrade() {
  const entry = getDashboardSelectedEntry();
  if (!entry) return;
  const insight = dashboardAptSearchState.selectedInsight || {
    ready: true,
    failed: false,
    station: null,
    school: null,
  };
  const key = getAptGradeKey(entry);
  if (key) dashboardAptGradeCache.delete(key);
  requestDashboardAptGrade(entry, insight, { force: true });
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
  const cachedGrade = getCachedAptGrade(entry);
  if (memoryCached) {
    dashboardAptSearchState.selectedInsight = memoryCached;
    if (cachedGrade === undefined) {
      requestDashboardAptGrade(entry, memoryCached);
    }
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
  if (cachedGrade === undefined) {
    requestDashboardAptGrade(entry, insight);
  }
  renderDashboardSelectedApartment();

  if (entry.kaptCode) {
    fetchAptAreaPrices(entry.kaptCode)
      .then(areaPrices => {
        if (!areaPrices) return;
        insight.areaPrices = areaPrices;
        dashboardAptSearchInsightCache.set(cacheKey, insight);
        if (dashboardAptSearchState.selectedId === entry.id) {
          dashboardAptSearchState.selectedInsight = insight;
          renderDashboardSelectedApartment();
        }
      })
      .catch(() => {});
  }

  const needsStationBackfill = !entry.stationMetaName && !entry.subwayStation;
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
  const entry = dashboardAptSearchState.entriesById.get(id)
    || dashboardAptSearchState.entries.find(item => item.kaptCode === id);
  if (!entry) return;

  const currentQuery = dashboardAptSearchState.query.trim();
  if (currentQuery) {
    dashboardAptSearchState.lastSearchQuery = currentQuery;
  }
  dashboardAptSearchState.selectedId = id;
  dashboardAptSearchState.isEditing = false;
  dashboardAptSearchState.aptAnalysisPaywallPromptedKey = '';
  dashboardAptSearchState.query = `${entry.aptName} ${entry.displayLocation}`.trim();
  dashboardAptSearchState.results = [];
  syncDashboardAptSearchUi();

  const input = document.getElementById('dbAptSearchInput');
  if (input) input.value = dashboardAptSearchState.query;
  const body = document.querySelector('.db-apt-page-body');
  if (body) body.scrollTo({ top: 0, behavior: 'smooth' });
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

function renderAptSearchScreen(options = {}) {
  syncDashboardAptSearchUi();
  loadDashboardAptSearchIndex().catch(() => {});
  if (options.skipFocus) return;
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
window.retryDashboardAptGrade = retryDashboardAptGrade;
window.setAptLoanType = setAptLoanType;
window.updateAptLoanSheetState = updateAptLoanSheetState;
window.submitAptLoanSheet = submitAptLoanSheet;
window.selectAptLoanAreaBucket = selectAptLoanAreaBucket;
