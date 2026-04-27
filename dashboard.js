// ── 대시보드 ──────────────────────────────────────────

// CLS_ID 매핑 (시/도)
const REGION_MAP = [
  { id: 500001, name: '전국' },
  { id: 500004, name: '서울' },
  { id: 500012, name: '경기' },
  { id: 500007, name: '인천' },
  { id: 500005, name: '부산' },
  { id: 500006, name: '대구' },
  { id: 500008, name: '광주' },
  { id: 500009, name: '대전' },
  { id: 500010, name: '울산' },
  { id: 500011, name: '세종' },
  { id: 500013, name: '강원' },
  { id: 500014, name: '충북' },
  { id: 500015, name: '충남' },
  { id: 500016, name: '전북' },
  { id: 500017, name: '전남' },
  { id: 500018, name: '경북' },
  { id: 500019, name: '경남' },
  { id: 500020, name: '제주' },
];

const TRADE_REGION_ID_MAP = {
  500001: 500001,
  500004: 500002,
  500005: 500003,
  500006: 500004,
  500007: 500005,
  500008: 500006,
  500009: 500007,
  500010: 500008,
  500011: 500009,
  500012: 500010,
  500013: 500011,
  500014: 500012,
  500015: 500013,
  500016: 500014,
  500017: 500015,
  500018: 500016,
  500019: 500017,
  500020: 500019,
};

const JEONSE_SUPPLY_REGION_ID_MAP = {
  500001: 500001,
  500004: 500008,
  500012: 500009,
  500007: 500010,
  500005: 500011,
  500006: 500012,
  500008: 500013,
  500009: 500014,
  500010: 500015,
  500011: 500016,
  500013: 500017,
  500014: 500018,
  500015: 500019,
  500016: 500020,
  500017: 500021,
  500018: 500022,
  500019: 500023,
  500020: 500024,
};

const MARKET_DATA_URL = '/data/market-dashboard.json';
const APT_TRADES_DATA_URL = '/data/apt-trades-summary.json';
const APT_TRADES_DATA_VERSION = '20260424c';
const MARKET_CACHE_ENDPOINT = '/.netlify/functions/market-cache';

let chart = null;
let selectedClsId     = 500001; // 기본값: 전국
let selectedName      = '전국';
let chartMode         = 'buy';  // 'buy' | 'jeonse'
let chartPeriod       = 6;      // 개월 (기본: 6개월)
let allPriceData      = null;   // 캐시된 전체 데이터
let allJeonseData     = null;
let allJeonseSupplyData = null;
let allIndexData      = null;
let allTradeData      = null;
let aptTradeSummary   = null;
let marketBundlePromise = null;
let aptTradesPromise = null;
let selectedDealCityByRegion = {};

// ── 캐시 ─────────────────────────────────────────────
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const APT_TRADE_CACHE_TTL = 24 * 60 * 60 * 1000;
const APT_TRADE_CACHE_KEY = 'apt_trades_summary_v4';

function getCache(key, ttl = CACHE_TTL) {
  try {
    const raw = localStorage.getItem('db_' + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem('db_' + key); return null; }
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try { localStorage.setItem('db_' + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function getMarketBundleCache() {
  return getCache('market_bundle_static_v1');
}

function setMarketBundleCache(data) {
  setCache('market_bundle_static_v1', data);
}

function getAptTradesCache() {
  return getCache(APT_TRADE_CACHE_KEY, APT_TRADE_CACHE_TTL);
}

function setAptTradesCache(data) {
  setCache(APT_TRADE_CACHE_KEY, data);
}

function hydrateMarketBundle(bundle) {
  if (!bundle?.detail) return;
  hydrateDashboardData(bundle.detail);
}

function buildNationalMarqueeItems(summary) {
  if (!summary) return ['전국 시장 데이터 준비 중'];
  const items = [];
  const formatTrendHtml = (value, digits = 0) => {
    if (!Number.isFinite(value)) return '';
    const dirClass = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
    const symbol = value > 0 ? '▲' : value < 0 ? '▼' : '±';
    return `<strong class="calc-marquee-trend ${dirClass}">${symbol}${Math.abs(value).toFixed(digits)}%</strong>`;
  };
  if (summary.latestMonth) items.push(`전국 · <strong>${summary.latestMonth}</strong>`);
  if (Number.isFinite(summary.tradeVolume)) items.push(`거래량 <strong>${summary.tradeVolume.toLocaleString()}건</strong>`);
  if (Number.isFinite(summary.tradeChange)) items.push(`거래량 ${formatTrendHtml(summary.tradeChange, 0)} 지난달보다`);
  if (Number.isFinite(summary.priceChange)) items.push(`최근 가격 변화 ${formatTrendHtml(summary.priceChange, 2)} 지난달보다`);
  if (Number.isFinite(summary.avgBuyPrice)) items.push(`지역 평균 가격 <strong>${formatPrice(summary.avgBuyPrice)}</strong>`);
  return items.length ? items : ['전국 시장 데이터 준비 중'];
}

function renderCalculatorMarquee(bundle) {
  const track = document.getElementById('calcMarketTrack');
  if (!track) return;
  const items = buildNationalMarqueeItems(bundle?.summary?.national);
  const pills = items.map(item => `<span class="calc-marquee-pill">${item}</span>`).join('');
  if (!bundle?.summary?.national) {
    track.classList.add('is-placeholder');
    track.innerHTML = `<div class="calc-marquee-group">${pills}</div>`;
    return;
  }

  track.classList.remove('is-placeholder');
  track.innerHTML = `
    <div class="calc-marquee-group">${pills}</div>
    <div class="calc-marquee-group" aria-hidden="true">${pills}</div>
  `;
}

async function fetchMarketBundle() {
  const cached = getMarketBundleCache();
  if (cached) {
    renderCalculatorMarquee(cached);
    return cached;
  }

  let bundle = null;
  try {
    const staticRes = await fetch(MARKET_DATA_URL);
    if (!staticRes.ok) throw new Error('정적 시장 데이터를 불러오지 못했어요.');
    bundle = await staticRes.json();
  } catch (staticError) {
    console.warn('[market] static data fallback:', staticError);
    const res = await fetch(MARKET_CACHE_ENDPOINT);
    if (!res.ok) throw new Error('시장 캐시를 불러오지 못했어요.');
    bundle = await res.json();
  }

  setMarketBundleCache(bundle);
  renderCalculatorMarquee(bundle);
  return bundle;
}

async function fetchAptTradesSummary() {
  const cached = getAptTradesCache();
  if (cached) return cached;

  const res = await fetch(`${APT_TRADES_DATA_URL}?v=${APT_TRADES_DATA_VERSION}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('실거래 데이터를 불러오지 못했어요.');
  const data = await res.json();
  setAptTradesCache(data);
  return data;
}

function preloadMarketBundle() {
  if (!marketBundlePromise) {
    marketBundlePromise = fetchMarketBundle().catch(err => {
      marketBundlePromise = null;
      throw err;
    });
  }
  return marketBundlePromise;
}

function preloadAptTrades() {
  if (!aptTradesPromise) {
    aptTradesPromise = fetchAptTradesSummary().catch(err => {
      aptTradesPromise = null;
      throw err;
    });
  }
  return aptTradesPromise;
}

function hasDashboardData() {
  return Array.isArray(allPriceData) && allPriceData.length > 0;
}

function updateQueryUi() {
  const queryWrap = document.getElementById('dbQueryWrap');
  const placeholder = document.getElementById('dbPlaceholder');
  if (!queryWrap || !placeholder) return;

  const loaded = hasDashboardData();
  queryWrap.style.display = loaded ? 'none' : 'block';
  placeholder.style.display = loaded ? 'none' : 'flex';
}

function animateDashboardContent() {
  const animatedEls = [
    document.getElementById('dbFacts'),
    document.querySelector('.db-chart-wrap')
  ].filter(Boolean);

  animatedEls.forEach((el, index) => {
    el.classList.remove('db-rise-in');
    el.style.setProperty('--rise-delay', `${index * 80}ms`);
    void el.offsetWidth;
    el.classList.add('db-rise-in');
  });
}

function renderLoadingSkeleton() {
  const loading = document.getElementById('dbLoading');
  if (!loading) return;
  loading.innerHTML = `
    <div class="db-skeleton-wrap">
      <div class="db-skeleton-label db-skeleton-shimmer"></div>
      <div class="db-skeleton-grid">
        <div class="db-skeleton-card db-skeleton-shimmer db-skeleton-card--wide"></div>
        <div class="db-skeleton-card db-skeleton-shimmer db-skeleton-card--wide"></div>
        <div class="db-skeleton-card db-skeleton-shimmer"></div>
        <div class="db-skeleton-card db-skeleton-shimmer"></div>
      </div>
      <div class="db-skeleton-chart db-skeleton-shimmer"></div>
    </div>
  `;
}

function hydrateDashboardData(data) {
  allPriceData  = data.priceData;
  allJeonseData = data.jeonseData;
  allJeonseSupplyData = data.jeonseSupplyData || [];
  allIndexData  = data.indexData;
  allTradeData  = data.tradeData;
}

function showDashboardData() {
  const loading = document.getElementById('dbLoading');
  const content = document.getElementById('dbContent');
  const placeholder = document.getElementById('dbPlaceholder');
  if (loading) loading.style.display = 'none';
  if (placeholder) placeholder.style.display = 'none';
  if (content) content.style.display = 'block';
  updateQueryUi();
  renderFacts();
  renderChart();
  animateDashboardContent();
}

// ── 대시보드 초기화 ──────────────────────────────────
function initDashboard() {
  const screen = document.getElementById('dashboardScreen');

  const regionBtns = REGION_MAP.map(r => `
    <button class="db-region-btn${r.id === 500001 ? ' active' : ''}"
      data-id="${r.id}" data-name="${r.name}"
      onclick="selectRegion(${r.id}, '${r.name}')">
      ${r.name}
    </button>`).join('');

  screen.innerHTML = `
    <div class="db-wrap">
      <div class="db-topbar">
        <button class="db-back-btn" type="button" onclick="showCalculator()">← 계산기로 돌아가기</button>
        <div class="db-topbar-copy">
          <strong>시장 상세 보기</strong>
          <span>계산 흐름은 그대로 유지돼요</span>
        </div>
      </div>
      <div class="db-region-grid">${regionBtns}</div>
      <div class="db-region-status" id="dbRegionStatus" style="display:none"></div>

      <div class="db-query-wrap" id="dbQueryWrap">
        <button class="db-query-btn" id="dbQueryBtn" onclick="handleQuery()">시장 데이터 불러오기</button>
      </div>

      <div class="db-placeholder" id="dbPlaceholder">
        지역을 선택한 뒤 시장 데이터를 불러와 주세요
      </div>

      <div class="db-loading" id="dbLoading" style="display:none">
        <div class="db-loading-dot"></div>
      </div>

      <div class="db-content" id="dbContent" style="display:none">
        <div class="db-facts" id="dbFacts"></div>
      </div>

      <div class="db-cta-wrap">
        <button class="db-cta" onclick="startCalculatorFlow()">내 조건으로 대출 알아보기 →</button>
      </div>
    </div>
  `;

  if (!window.Chart) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    document.head.appendChild(s);
  }

  const cached = getMarketBundleCache();
  if (cached) {
    hydrateMarketBundle(cached);
    aptTradeSummary = getAptTradesCache();
    showDashboardData();
    preloadAptTrades().then(data => {
      aptTradeSummary = data;
      if (hasDashboardData()) showDashboardData();
    }).catch(() => {});
  } else {
    updateQueryUi();
  }
}

// ── 지역 선택 ─────────────────────────────────────────
function selectRegion(clsId, name) {
  selectedClsId = clsId;
  selectedName  = name;

  document.querySelectorAll('.db-region-btn').forEach(btn => {
    const isActive = parseInt(btn.dataset.id) === clsId;
    btn.classList.toggle('active', isActive);
  });

  if (hasDashboardData()) {
    showDashboardData();
  }
}

// ── 조회 버튼 ─────────────────────────────────────────
function handleQuery() {
  if (hasDashboardData()) {
    showDashboardData();
    return;
  }
  loadDashboardData();
}

// ── 데이터 로드 ───────────────────────────────────────
async function loadDashboardData() {
  const loading     = document.getElementById('dbLoading');
  const content     = document.getElementById('dbContent');
  const placeholder = document.getElementById('dbPlaceholder');
  placeholder.style.display = 'none';
  renderLoadingSkeleton();
  loading.style.display = 'flex';
  content.style.display = 'none';

  const cached = getMarketBundleCache();
  if (cached) {
    hydrateMarketBundle(cached);
    showDashboardData();
    return;
  }

  try {
    const [bundle, aptTrades] = await Promise.all([
      preloadMarketBundle(),
      preloadAptTrades().catch(() => null),
    ]);
    hydrateMarketBundle(bundle);
    aptTradeSummary = aptTrades;

    showDashboardData();
  } catch (e) {
    loading.style.display = 'none';
    content.innerHTML = `<div class="db-error">데이터를 불러오지 못했어요.<br>${e.message}</div>`;
    content.style.display = 'block';
    updateQueryUi();
  }
}

// ── 지역 필터 ─────────────────────────────────────────
function filterByRegion(rows, clsId) {
  const clsIdStr = String(clsId);
  return rows
    .filter(r => String(r.CLS_ID) === clsIdStr)
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function parseNumericValue(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function getRecentValidRows(rows, minValue = null) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => {
    const value = parseNumericValue(row?.DTA_VAL);
    if (value === null) return false;
    return minValue === null ? true : value > minValue;
  });
}

// ── 전월 대비 등락률 계산 ────────────────────────────
function prevMonthStr(yyyymm) {
  const y = parseInt(yyyymm.slice(0, 4));
  const m = parseInt(yyyymm.slice(4, 6));
  return m === 1
    ? `${y - 1}12`
    : `${y}${String(m - 1).padStart(2, '0')}`;
}

function calcPriceChange(rows) {
  const validRows = getRecentValidRows(rows);
  if (validRows.length < 2) return null;
  const currRow = validRows[validRows.length - 1];
  const prevRow = validRows[validRows.length - 2];
  if (prevRow.WRTTIME_IDTFR_ID !== prevMonthStr(currRow.WRTTIME_IDTFR_ID)) return null;
  const prev = parseNumericValue(prevRow.DTA_VAL);
  const curr = parseNumericValue(currRow.DTA_VAL);
  if (prev === null || curr === null || prev === 0) return null;
  return (curr - prev) / prev * 100;
}

function filterTradeByRegion(rows, clsId) {
  const tradeClsId = String(TRADE_REGION_ID_MAP[clsId] || clsId);
  return rows
    .filter(r => String(r.CLS_ID) === tradeClsId && String(r.ITM_ID) === '100001')
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function filterJeonseSupplyByRegion(rows, clsId) {
  const supplyClsId = String(JEONSE_SUPPLY_REGION_ID_MAP[clsId] || clsId);
  return rows
    .filter(r => String(r.CLS_ID) === supplyClsId && String(r.ITM_ID) === '100001')
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function getLatestCommonMonthId(rowGroups) {
  const monthSets = rowGroups
    .map(rows => new Set(getRecentValidRows(rows).map(row => row.WRTTIME_IDTFR_ID)))
    .filter(set => set.size > 0);

  if (monthSets.length !== rowGroups.length) return null;

  const [firstSet, ...restSets] = monthSets;
  const commonMonths = [...firstSet]
    .filter(monthId => restSets.every(set => set.has(monthId)))
    .sort();

  return commonMonths[commonMonths.length - 1] || null;
}

function clampRowsToMonth(rows, monthId) {
  if (!monthId) return rows;
  return rows.filter(row => row.WRTTIME_IDTFR_ID <= monthId);
}

function calcTradeChange(rows) {
  if (rows.length < 2) return null;
  const currRow = rows[rows.length - 1];
  const prevRow = rows[rows.length - 2];
  if (prevRow.WRTTIME_IDTFR_ID !== prevMonthStr(currRow.WRTTIME_IDTFR_ID)) return null;
  const curr = parseNumericValue(currRow.DTA_VAL);
  const prev = parseNumericValue(prevRow.DTA_VAL);
  if (curr === null || prev === null || prev === 0) return null;
  return (curr - prev) / prev * 100;
}

function renderChangeTag(pct) {
  if (pct === null) return '';
  const abs = Math.abs(pct).toFixed(2);
  if (pct > 0)  return `<div class="db-change up">▲ ${abs}% 전월 대비</div>`;
  if (pct < 0)  return `<div class="db-change down">▼ ${abs}% 전월 대비</div>`;
  return `<div class="db-change flat">— 전월 동일</div>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderStreamingWords(text, className, startDelay = 0) {
  const tokens = String(text).split(/(\s+)/).filter(token => token.length > 0);
  let delay = startDelay;

  return `
    <span class="${className}" aria-label="${escapeHtml(text)}">
      ${tokens.map(token => {
        if (/^\s+$/.test(token)) {
          return `<span class="db-stream-space">${token.replace(/ /g, '&nbsp;')}</span>`;
        }

        const html = `<span class="db-stream-word" style="--stream-delay:${delay}ms">${escapeHtml(token)}</span>`;
        delay += 38;
        return html;
      }).join('')}
    </span>
  `;
}

function buildSummaryReport({ selectedName, indexChange, aptTrade, priceChange, ratio }) {
  const medianChange = aptTrade?.signals?.medianChangePct;
  const countChange = aptTrade?.signals?.countChangePct;

  if (!aptTrade) {
    return `${selectedName}은 아직 실제 거래 데이터가 충분하지 않아 방향을 단정하기 어려운 구간입니다. 지금은 지역 평균 가격 흐름을 먼저 보고, 실제 거래 데이터가 쌓이면 체감 가격과 최근 거래 수를 함께 보는 편이 좋습니다.`;
  }

  if (Number.isFinite(medianChange) && Number.isFinite(countChange) && medianChange >= 1 && countChange >= 8) {
    return `${selectedName}은 실제 거래가 조금씩 살아나는 구간에 가깝습니다. 지역 평균 가격보다 실제 거래 체감 가격과 최근 거래 수가 같이 오르면 일부 호가가 아니라 매수 움직임이 붙는 신호로 볼 수 있습니다. 다만 단기 급등으로 보긴 이르니 거래가 많았던 단지 TOP5 흐름을 같이 확인하는 편이 안전합니다.`;
  }

  if (Number.isFinite(priceChange) && Number.isFinite(medianChange) && priceChange >= 0.2 && medianChange <= 0) {
    return `${selectedName}은 지역 분위기 가격은 버티지만 실제 거래 체감은 아직 강하지 않은 구간입니다. 이런 때는 시장 전체가 회복했다기보다 일부 높은 호가나 특정 거래 영향이 섞였을 가능성을 같이 봐야 합니다. 지금은 평균 가격보다 최근 실제 거래가 꾸준히 이어지는지 확인하는 편이 더 중요합니다.`;
  }

  if (Number.isFinite(countChange) && countChange <= -8 && Number.isFinite(indexChange) && indexChange >= 0) {
    return `${selectedName}은 가격은 크게 밀리지 않지만 거래가 줄어든 잠김 장세에 가깝습니다. 규제나 매물 부족 영향으로 거래가 적으면 한두 건 가격이 더 크게 보일 수 있습니다. 이런 구간에서는 가격 숫자보다 최근 거래 수와 거래가 많았던 단지 흐름을 함께 보는 게 더 현실적입니다.`;
  }

  if (Number.isFinite(indexChange) && indexChange <= -0.12 && (!Number.isFinite(countChange) || countChange <= 0)) {
    return `${selectedName}은 아직 적극적으로 매수세가 붙는 장이라기보다 관망 구간에 가깝습니다. 지역 평균 가격과 실제 거래 체감 가격이 함께 약하면 시장 체감도 완전히 살아났다고 보기 어렵습니다. 초보자라면 지금은 급하게 판단하기보다 최근 거래가 줄어드는지부터 보는 편이 좋습니다.`;
  }

  if (Number.isFinite(ratio) && ratio >= 60) {
    return `${selectedName}은 실거주 수요가 어느 정도 버티는 흐름으로 볼 수 있습니다. 매매 대비 전세 비율이 높으면 시장이 급하게 흔들릴 가능성이 상대적으로 낮아질 수 있습니다. 다만 이것만으로 상승장이라고 보긴 어렵기 때문에 지역 평균 가격과 실제 거래 체감 가격을 같이 보는 편이 맞습니다.`;
  }

  return `${selectedName}은 지금 한쪽으로 강하게 움직인다기보다 방향을 확인하는 구간입니다. 지역 평균 가격은 시장 분위기를, 실제 거래 체감 가격은 최근 거래 감각을 보여주기 때문에 두 값이 같은 방향인지 같이 봐야 해석이 쉬워집니다. 초보자라면 지금은 거래가 많았던 단지 TOP5에서 실제 가격 흐름이 이어지는지 보는 편이 좋습니다.`;
}

function buildNationalPositionLine({ selectedName, selectedClsId, nationalIndexChange, regionalGap, nationalPriceGap }) {
  if (selectedClsId === 500001) {
    return `전국 시장 흐름 기준 · 최근 가격 변화 ${Number.isFinite(nationalIndexChange) ? formatSignedPct(nationalIndexChange, 2) : '확인 중'}`;
  }

  if (!Number.isFinite(regionalGap)) {
    return `${selectedName} · 전국과 비교할 데이터 준비 중`;
  }

  let position = '전국과 비슷한 흐름';
  if (regionalGap >= 0.08) position = '전국보다 강한 흐름';
  else if (regionalGap <= -0.08) position = '전국보다 약한 흐름';

  const gapText = `최근 가격 변화 ${regionalGap > 0 ? '+' : regionalGap < 0 ? '' : '±'}${Math.abs(regionalGap).toFixed(2)}%p`;
  const priceText = Number.isFinite(nationalPriceGap)
    ? `전국 평균 가격 대비 ${nationalPriceGap > 0 ? '+' : nationalPriceGap < 0 ? '' : '±'}${Math.abs(nationalPriceGap).toFixed(1)}%`
    : '전국 평균 가격 비교 중';

  return `${selectedName} · ${position} · ${gapText} · ${priceText}`;
}

function formatTradePrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '—';
  const eok = Math.floor(price / 10000);
  const man = price % 10000;
  if (eok > 0 && man > 0) return `${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${eok}억원`;
  return `${price.toLocaleString()}만원`;
}

function formatTradeMonth(month) {
  if (!month || String(month).length !== 6) return '';
  return `${String(month).slice(0, 4)}.${String(month).slice(4, 6)}`;
}

function formatSignedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value).toFixed(digits);
  if (value > 0) return `▲${abs}%`;
  if (value < 0) return `▼${abs}%`;
  return '±0%';
}

function signalClass(value) {
  if (!Number.isFinite(value)) return 'flat';
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

function getSelectedDealCity(regionId, aptTrade) {
  const scopes = Array.isArray(aptTrade?.cityScopes) ? aptTrade.cityScopes : [];
  const current = selectedDealCityByRegion[regionId] || 'all';
  if (current === 'all') return 'all';
  return scopes.some(scope => scope.name === current) ? current : 'all';
}

function centerActiveDealScopeTab(behavior = 'auto') {
  const tabRow = document.querySelector('#dbTopDealsCard .db-deal-scope-tabs');
  const activeTab = tabRow?.querySelector('.db-deal-scope-tab.active');
  if (!tabRow || !activeTab) return;

  const targetLeft = activeTab.offsetLeft - ((tabRow.clientWidth - activeTab.offsetWidth) / 2);
  const maxScrollLeft = Math.max(0, tabRow.scrollWidth - tabRow.clientWidth);
  const nextScrollLeft = Math.min(Math.max(0, targetLeft), maxScrollLeft);
  tabRow.scrollTo({ left: nextScrollLeft, behavior });
}

function syncActiveDealScopeTab({ previousScrollLeft = 0, smooth = false } = {}) {
  const tabRow = document.querySelector('#dbTopDealsCard .db-deal-scope-tabs');
  const activeTab = tabRow?.querySelector('.db-deal-scope-tab.active');
  if (!tabRow || !activeTab) return;

  tabRow.scrollLeft = previousScrollLeft;
  const viewportLeft = tabRow.scrollLeft;
  const viewportRight = viewportLeft + tabRow.clientWidth;
  const tabLeft = activeTab.offsetLeft;
  const tabRight = tabLeft + activeTab.offsetWidth;
  const edgePadding = 20;
  const minVisibleLeft = viewportLeft + edgePadding;
  const maxVisibleRight = viewportRight - edgePadding;
  let nextScrollLeft = null;

  if (tabLeft < minVisibleLeft) {
    nextScrollLeft = Math.max(0, tabLeft - edgePadding);
  } else if (tabRight > maxVisibleRight) {
    nextScrollLeft = Math.max(0, tabRight - tabRow.clientWidth + edgePadding);
  }

  if (nextScrollLeft !== null) {
    const maxScrollLeft = Math.max(0, tabRow.scrollWidth - tabRow.clientWidth);
    requestAnimationFrame(() => {
      tabRow.scrollTo({
        left: Math.min(nextScrollLeft, maxScrollLeft),
        behavior: smooth ? 'smooth' : 'auto',
      });
    });
  }
}

function setDealCity(regionId, cityName) {
  selectedDealCityByRegion[regionId] = cityName;
  const aptTrade = aptTradeSummary?.sido?.[String(regionId)] || null;
  const target = document.getElementById('dbTopDealsCard');
  const previousScrollLeft = target?.querySelector('.db-deal-scope-tabs')?.scrollLeft || 0;
  if (!target) {
    renderFacts();
    return;
  }
  target.outerHTML = renderTopDealsCard({ regionId, aptTrade });
  syncActiveDealScopeTab({ previousScrollLeft, smooth: true });
}

function renderTopDealsCard({ regionId, aptTrade }) {
  if (!aptTrade) {
    return `
      <div class="db-actual-card db-actual-card--empty" id="dbTopDealsCard">
        <div class="db-fact-label">거래 많은 단지 TOP5</div>
        <div class="db-actual-empty">거래 많은 단지 데이터가 아직 없어요.</div>
      </div>
    `;
  }

  const selectedDealCity = getSelectedDealCity(regionId, aptTrade);
  const cityScopes = Array.isArray(aptTrade.cityScopes) ? aptTrade.cityScopes : [];
  const activeScope = selectedDealCity === 'all'
    ? null
    : cityScopes.find(scope => scope.name === selectedDealCity) || null;
  const popularComplexes = Array.isArray(activeScope?.popularComplexes)
    ? activeScope.popularComplexes.slice(0, 5)
    : Array.isArray(aptTrade.popularComplexes)
      ? aptTrade.popularComplexes.slice(0, 5)
      : [];
  const scopeTabs = [
    { name: 'all', label: '전체' },
    ...cityScopes.map(scope => ({ name: scope.name, label: scope.name })),
  ];
  const showCityTabs = regionId !== 500001 && scopeTabs.length > 1;

  return `
    <div class="db-actual-card" id="dbTopDealsCard">
      <div class="db-fact-label">거래 많은 단지 TOP5 · ${formatTradeMonth(aptTrade.latestDealMonth)}</div>
      ${showCityTabs ? `
      <div class="db-deal-scope-tabs">
        ${scopeTabs.map(tab => `
          <button
            class="db-deal-scope-tab${(tab.name === 'all' ? selectedDealCity === 'all' : selectedDealCity === tab.name) ? ' active' : ''}"
            type="button"
            onclick="setDealCity(${regionId}, '${tab.name}')"
          >${tab.label}</button>
        `).join('')}
      </div>` : ''}
      <div class="db-deal-list">
        ${popularComplexes.length ? popularComplexes.map((complex, index) => `
          <div class="db-deal-item">
            <div class="db-deal-head">
              <strong><span class="db-deal-rank">TOP ${index + 1}</span>${escapeHtml(complex.aptName || '단지명 없음')}</strong>
              <span>${Number(complex.tradeCount || 0).toLocaleString()}건</span>
            </div>
            <div class="db-deal-meta">
              ${escapeHtml([complex.sigunguName, complex.umdName].filter(Boolean).join(' '))}
              ${complex.latestTradePrice ? ` · 최근 실거래가 ${formatTradePrice(complex.latestTradePrice)}` : ''}
              ${complex.latestTradeArea ? ` · ${Number(complex.latestTradeArea).toFixed(2)}㎡` : ''}
              ${complex.latestDealDate ? ` · 최근 ${complex.latestDealDate}` : ''}
            </div>
          </div>
        `).join('') : '<div class="db-actual-empty">거래 많은 단지 데이터가 아직 없어요.</div>'}
      </div>
    </div>
  `;
}

function renderAptTradeCards({
  regionId,
  aptTrade,
  latestPrice,
  latestJeonse,
  priceChange,
  jeonseChange,
  ratio,
  ratioChange,
  latestJeonseSupply,
  jeonseSupplyChange,
}) {
  if (!aptTrade) {
    return `
      <div class="db-actual-card db-actual-card--empty">
        <div class="db-fact-label">국토부 실거래</div>
        <div class="db-actual-empty">실거래 요약 데이터 준비 중</div>
      </div>
    `;
  }

  const countChange = aptTrade.signals?.countChangePct;
  const medianChange = aptTrade.signals?.medianChangePct;

  return `
    <div class="db-actual-grid">
      <div class="db-actual-card">
        <div class="db-fact-label">최근 실제 거래 흐름 · ${formatTradeMonth(aptTrade.latestDealMonth)}</div>
        <div class="db-actual-main">
          <div>
            <span class="db-actual-k">지역 평균 가격</span>
            <strong>${formatPrice(latestPrice)}</strong>
            <em class="${signalClass(priceChange)}">${formatSignedPct(priceChange, 2)} 지난달보다</em>
          </div>
          <div>
            <span class="db-actual-k">실거래 체감 가격</span>
            <strong>${formatTradePrice(aptTrade.medianPrice)}</strong>
            <em class="${signalClass(medianChange)}">${formatSignedPct(medianChange)} 지난달보다</em>
          </div>
          <div>
            <span class="db-actual-k">지역 평균 전세 가격</span>
            <strong>${formatPrice(latestJeonse)}</strong>
            <em class="${signalClass(jeonseChange)}">${formatSignedPct(jeonseChange, 2)} 지난달보다</em>
          </div>
          <div>
            <span class="db-actual-k">최근 거래 수</span>
            <strong>${Number(aptTrade.tradeCount || 0).toLocaleString()}건</strong>
            <em class="${signalClass(countChange)}">${formatSignedPct(countChange)} 지난달보다</em>
          </div>
          <div>
            <span class="db-actual-inline-label">매매 대비 전세 비율</span>
            <strong>${ratio !== null ? `${ratio.toFixed(1)}%` : '—'}</strong>
            ${ratioChange !== null ? `<em class="${signalClass(ratioChange)}">${ratioChange > 0 ? '▲' : ratioChange < 0 ? '▼' : '—'} ${Math.abs(ratioChange).toFixed(1)}%p</em>` : ''}
          </div>
          <div>
            <span class="db-actual-inline-label">전세 수요 분위기</span>
            <strong>${latestJeonseSupply !== null ? latestJeonseSupply.toFixed(1) : '—'}</strong>
            ${jeonseSupplyChange !== null ? `<em class="${signalClass(jeonseSupplyChange)}">${formatSignedPct(jeonseSupplyChange, 2)}</em>` : ''}
          </div>
        </div>
        <div class="db-actual-sub">
          가장 최근 거래일 ${aptTrade.latestDealDate || '—'} · 최근 ${aptTrade.totalTradeCount?.toLocaleString?.() || 0}건 기준
        </div>
      </div>
      ${renderTopDealsCard({ regionId, aptTrade })}
    </div>
  `;
}

// ── 팩트 카드 렌더 ───────────────────────────────────
function renderFacts() {
  const facts = document.getElementById('dbFacts');
  if (!facts || !allPriceData) return;

  const priceRows       = filterByRegion(allPriceData,  selectedClsId);
  const jeonseRows      = filterByRegion(allJeonseData, selectedClsId);
  const indexRows       = filterByRegion(allIndexData,  selectedClsId);
  const tradeRows       = filterTradeByRegion(allTradeData, selectedClsId);
  const jeonseSupplyRows = filterJeonseSupplyByRegion(allJeonseSupplyData, selectedClsId);
  const latestCommonMonthId = getLatestCommonMonthId([
    priceRows,
    jeonseRows,
    indexRows,
    tradeRows,
    jeonseSupplyRows,
  ]);
  const priceRowsForDisplay = clampRowsToMonth(priceRows, latestCommonMonthId);
  const jeonseRowsForDisplay = clampRowsToMonth(jeonseRows, latestCommonMonthId);
  const indexRowsForDisplay = clampRowsToMonth(indexRows, latestCommonMonthId);
  const tradeRowsForDisplay = clampRowsToMonth(tradeRows, latestCommonMonthId);
  const jeonseSupplyRowsForDisplay = clampRowsToMonth(jeonseSupplyRows, latestCommonMonthId);
  const validPriceRows  = getRecentValidRows(priceRowsForDisplay, 0);
  const validJeonseRows = getRecentValidRows(jeonseRowsForDisplay, 0);

  const latestPrice  = validPriceRows.length  ? validPriceRows[validPriceRows.length - 1].DTA_VAL   : null;
  const latestJeonse = validJeonseRows.length ? validJeonseRows[validJeonseRows.length - 1].DTA_VAL : null;
  const latestJeonseSupply = jeonseSupplyRowsForDisplay.length
    ? parseNumericValue(jeonseSupplyRowsForDisplay[jeonseSupplyRowsForDisplay.length - 1].DTA_VAL)
    : null;

  const priceChange  = calcPriceChange(priceRowsForDisplay);
  const jeonseChange = calcPriceChange(jeonseRowsForDisplay);
  const indexChange  = calcPriceChange(indexRowsForDisplay);
  const jeonseSupplyChange = calcPriceChange(jeonseSupplyRowsForDisplay);

  // 전국 가격변동률 (선택 지역이 전국이 아닐 때 비교용)
  const nationalIndexRows   = filterByRegion(allIndexData, 500001);
  const nationalIndexChange = calcPriceChange(nationalIndexRows);
  const nationalPriceRows   = filterByRegion(allPriceData, 500001);
  const validNationalPriceRows = getRecentValidRows(nationalPriceRows, 0);

  // 전세가율
  const currP    = parseNumericValue(latestPrice);
  const currJ    = parseNumericValue(latestJeonse);
  const ratio    = (currP && currJ) ? currJ / currP * 100 : null;
  const prevP    = validPriceRows.length  >= 2 ? parseNumericValue(validPriceRows[validPriceRows.length - 2].DTA_VAL)   : null;
  const prevJ    = validJeonseRows.length >= 2 ? parseNumericValue(validJeonseRows[validJeonseRows.length - 2].DTA_VAL) : null;
  const prevRatio   = (prevP && prevJ) ? prevJ / prevP * 100 : null;
  const ratioChange = (ratio !== null && prevRatio !== null) ? ratio - prevRatio : null;

  const latestMonth = validPriceRows.length
    ? validPriceRows[validPriceRows.length - 1].WRTTIME_DESC
    : '';
  const regionalGap = (indexChange !== null && nationalIndexChange !== null)
    ? indexChange - nationalIndexChange
    : null;
  const latestNationalPrice = validNationalPriceRows.length
    ? parseNumericValue(validNationalPriceRows[validNationalPriceRows.length - 1].DTA_VAL)
    : null;
  const nationalPriceGap = (currP !== null && latestNationalPrice !== null && latestNationalPrice !== 0)
    ? ((currP - latestNationalPrice) / latestNationalPrice) * 100
    : null;
  const regionStatus = document.getElementById('dbRegionStatus');
  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v).toFixed(digits);
    if (v > 0)  return `▲${abs}%`;
    if (v < 0)  return `▼${abs}%`;
    return `±0%`;
  };

  const aptTrade = aptTradeSummary?.sido?.[String(selectedClsId)] || null;
  const aptTradeHtml = renderAptTradeCards({
    regionId: selectedClsId,
    aptTrade,
    latestPrice,
    latestJeonse,
    priceChange,
    jeonseChange,
    ratio,
    ratioChange,
    latestJeonseSupply,
    jeonseSupplyChange,
  });
  const summaryReport = buildSummaryReport({
    selectedName,
    indexChange,
    aptTrade,
    priceChange,
    ratio,
  });
  const marketTone = indexChange === null
    ? '흐름 확인 중'
    : indexChange > 0.12
      ? '가격 상승 흐름'
      : indexChange < -0.12
        ? '가격 하락 흐름'
        : '보합 흐름';

  if (regionStatus) {
    regionStatus.textContent = buildNationalPositionLine({
      selectedName,
      selectedClsId,
      nationalIndexChange,
      regionalGap,
      nationalPriceGap,
    });
    regionStatus.style.display = 'block';
  }

  facts.innerHTML = `
    <div class="db-facts-grid">
      <div class="db-facts-meta">${selectedName} · 아파트 기준${latestMonth ? ` · ${latestMonth}` : ''}</div>

      <div class="db-fact-card db-fact-card--therm">
        <div class="db-fact-label">지금 시장 분위기</div>
        <div class="db-therm-summary">
          <strong>${marketTone}</strong>
          <span>${selectedName} 선택 지역 기준</span>
        </div>
        <div class="db-therm-chip-row">
          <span class="db-therm-chip ${signalClass(indexChange)}">최근 가격 변화 ${fmtPct(indexChange)}</span>
          ${aptTrade ? `<span class="db-therm-chip ${signalClass(aptTrade.signals?.medianChangePct)}">실거래 체감 ${fmtPct(aptTrade.signals?.medianChangePct, 1)}</span>` : ''}
        </div>
        <div class="db-summary-report">
          <div class="db-fact-label">쉽게 보는 해석</div>
          <p class="db-summary-report-conclusion">${renderStreamingWords(summaryReport, 'db-summary-report-stream', 40)}</p>
        </div>
      </div>

      ${aptTradeHtml}

      <div class="db-chart-wrap db-chart-wrap--embedded">
        <div class="db-chart-copy">
          <div class="db-chart-title">평균 가격 흐름</div>
          <p class="db-chart-desc">지역 평균 가격의 최근 방향을 보여줍니다. 실거래 흐름과 같이 보면 판단이 쉬워집니다.</p>
        </div>
        <div class="db-chart-top">
          <div class="db-chart-tabs">
            <button class="db-chart-tab active" onclick="switchChartMode('buy', this)">매매</button>
            <button class="db-chart-tab" onclick="switchChartMode('jeonse', this)">전세</button>
          </div>
          <div class="db-period-tabs">
            <button class="db-period-tab" onclick="switchPeriod(3, this)">3개월</button>
            <button class="db-period-tab active" onclick="switchPeriod(6, this)">6개월</button>
            <button class="db-period-tab" onclick="switchPeriod(12, this)">1년</button>
          </div>
        </div>
        <canvas id="dbChart"></canvas>
        <div class="db-chart-unit">평균 가격 흐름 · 한국부동산원</div>
      </div>

    </div>
  `;
  syncActiveDealScopeTab();
}

// ── 차트 모드/기간 전환 ──────────────────────────────
function switchChartMode(mode, btn) {
  chartMode = mode;
  document.querySelectorAll('.db-chart-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderChart();
}

function switchPeriod(months, btn) {
  chartPeriod = months;
  document.querySelectorAll('.db-period-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderChart();
}

// ── 차트 렌더 ────────────────────────────────────────
function renderChart() {
  const ctx = document.getElementById('dbChart');
  if (!ctx || !window.Chart) { setTimeout(renderChart, 300); return; }

  const sourceRows = chartMode === 'buy' ? allPriceData : allJeonseData;
  if (!sourceRows) return;

  const filtered = filterByRegion(sourceRows, selectedClsId)
    .filter(r => r.DTA_VAL !== null)
    .slice(-chartPeriod);

  const labels = filtered.map(r => r.WRTTIME_DESC.replace('년 ', '.').replace('월', ''));
  const values = filtered.map(r => {
    // 만원/㎡ → 만원/평 (×3.3058), 25평 기준 총액
    const perPyeong = r.DTA_VAL * 3.3058;
    return Math.round(perPyeong);
  });

  const color   = chartMode === 'buy' ? '#0a84ff' : '#30d158';
  const bgColor = chartMode === 'buy' ? 'rgba(10,132,255,0.08)' : 'rgba(48,209,88,0.08)';

  if (chart) { chart.destroy(); chart = null; }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: bgColor,
        borderWidth: 2,
        pointRadius: chartPeriod <= 6 ? 4 : 2,
        pointBackgroundColor: color,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.parsed.y.toLocaleString()}만원/평`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: 'rgba(255,255,255,0.35)',
            font: { size: 10 },
            maxTicksLimit: 6,
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          ticks: {
            color: 'rgba(255,255,255,0.35)',
            font: { size: 10 },
            callback: v => v.toLocaleString() + '만',
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        }
      }
    }
  });
}

// ── 유틸 ─────────────────────────────────────────────
function formatPrice(val) {
  if (!val || isNaN(val)) return '—';
  // 만원/㎡ × 25평(=82.6㎡) → 총액 만원
  const total = Math.round(val * 82.6 / 10000); // 억 단위
  const 억 = Math.floor(total);
  const 천 = Math.round((total - 억) * 10) / 10;
  if (억 > 0 && 천 > 0) return `약 ${억}억 ${Math.round(천 * 1000).toLocaleString()}만원`;
  if (억 > 0) return `약 ${억}억원`;
  return `약 ${Math.round(val * 82.6).toLocaleString()}만원`;
}

// ── 진입점 ───────────────────────────────────────────
(function() {
  const cachedBundle = getMarketBundleCache();
  if (cachedBundle) renderCalculatorMarquee(cachedBundle);

  if (localStorage.getItem('authVerified') === '1') {
    document.getElementById('pwScreen').style.display = 'none';
    showCalculator();
    preloadMarketBundle().catch(() => {});
  }
})();
