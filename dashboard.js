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

// ── 캐시 ─────────────────────────────────────────────
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const APT_TRADE_CACHE_TTL = 24 * 60 * 60 * 1000;

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
  return getCache('apt_trades_summary_v1', APT_TRADE_CACHE_TTL);
}

function setAptTradesCache(data) {
  setCache('apt_trades_summary_v1', data);
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
  if (Number.isFinite(summary.tradeChange)) items.push(`거래량 ${formatTrendHtml(summary.tradeChange, 0)} 전월 대비`);
  if (Number.isFinite(summary.priceChange)) items.push(`가격변동률 ${formatTrendHtml(summary.priceChange, 2)} 전월 대비`);
  if (Number.isFinite(summary.avgBuyPrice)) items.push(`평균 매매가(25평) <strong>${formatPrice(summary.avgBuyPrice)}</strong>`);
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

  const res = await fetch(APT_TRADES_DATA_URL);
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
  const indexText = formatSignedPct(indexChange, 2);
  const priceText = formatSignedPct(priceChange, 2);
  const medianText = formatSignedPct(aptTrade?.signals?.medianChangePct, 1);
  const tradeCount = Number(aptTrade?.tradeCount || 0);

  if (!aptTrade) {
    return `${selectedName}은 가격 지표 기준 ${indexText} 흐름입니다. 실거래 요약 데이터가 준비되면 중간 거래가와 거래 건수를 함께 비교할 수 있습니다.`;
  }

  return `${selectedName}은 가격 지표 ${indexText}, 평균 매매가 ${priceText}, 실거래 중간값 ${medianText} 흐름입니다. ${formatTradeMonth(aptTrade.latestDealMonth)} 실거래는 ${tradeCount.toLocaleString()}건이며 전세가율은 ${ratio !== null ? `${ratio.toFixed(1)}%` : '확인 중'}입니다.`;
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

function renderAptTradeCards(aptTrade) {
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
  const popularComplexes = Array.isArray(aptTrade.popularComplexes)
    ? aptTrade.popularComplexes.slice(0, 5)
    : [];

  return `
    <div class="db-actual-grid">
      <div class="db-actual-card">
        <div class="db-fact-label">국토부 실거래 체감 · ${formatTradeMonth(aptTrade.latestDealMonth)}</div>
        <div class="db-actual-main">
          <div>
            <span class="db-actual-k">중간 거래가</span>
            <strong>${formatTradePrice(aptTrade.medianPrice)}</strong>
            <em class="${signalClass(medianChange)}">${formatSignedPct(medianChange)} 전월 대비</em>
          </div>
          <div>
            <span class="db-actual-k">거래 건수</span>
            <strong>${Number(aptTrade.tradeCount || 0).toLocaleString()}건</strong>
            <em class="${signalClass(countChange)}">${formatSignedPct(countChange)} 전월 대비</em>
          </div>
        </div>
        <div class="db-actual-sub">
          최근 거래일 ${aptTrade.latestDealDate || '—'} · 최근 ${aptTrade.totalTradeCount?.toLocaleString?.() || 0}건 기준
        </div>
      </div>

      <div class="db-actual-card">
        <div class="db-fact-label">거래 많은 단지 · ${formatTradeMonth(aptTrade.latestDealMonth)}</div>
        <div class="db-deal-list">
          ${popularComplexes.length ? popularComplexes.map(complex => `
            <div class="db-deal-item">
              <div class="db-deal-head">
                <strong>${escapeHtml(complex.aptName || '단지명 없음')}</strong>
                <span>${Number(complex.tradeCount || 0).toLocaleString()}건</span>
              </div>
              <div class="db-deal-meta">
                ${escapeHtml([complex.sigunguName, complex.umdName].filter(Boolean).join(' '))}
                ${complex.medianPrice ? ` · 중간 ${formatTradePrice(complex.medianPrice)}` : ''}
                ${complex.latestDealDate ? ` · 최근 ${complex.latestDealDate}` : ''}
              </div>
            </div>
          `).join('') : '<div class="db-actual-empty">거래 많은 단지 데이터가 아직 없어요.</div>'}
        </div>
      </div>
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

  // 상위/하위 2개 지역 (전국 제외, 지수 기준)
  const regionChanges = REGION_MAP
    .filter(r => r.id !== 500001)
    .map(r => {
      const rows   = filterByRegion(allIndexData, r.id);
      const change = calcPriceChange(rows);
      return { name: r.name, change };
    })
    .filter(r => r.change !== null)
    .sort((a, b) => b.change - a.change);
  const top2    = regionChanges.slice(0, 2);
  const bottom2 = regionChanges.slice(-2).reverse();

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
  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v).toFixed(digits);
    if (v > 0)  return `▲${abs}%`;
    if (v < 0)  return `▼${abs}%`;
    return `±0%`;
  };

  const aptTrade = aptTradeSummary?.sido?.[String(selectedClsId)] || null;
  const aptTradeHtml = renderAptTradeCards(aptTrade);
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

  facts.innerHTML = `
    <div class="db-facts-grid">

      <div class="db-fact-card db-fact-card--regional">
        <div class="db-fact-label">${selectedName} · 아파트 기준${latestMonth ? ` · ${latestMonth}` : ''}</div>
        <div class="db-fact-card db-fact-card--therm">
          <div class="db-fact-label">시장 온도계</div>
          <div class="db-therm-summary">
            <strong>${marketTone}</strong>
            <span>${selectedName} 선택 지역 기준</span>
          </div>
          <div class="db-therm-chip-row">
            <span class="db-therm-chip ${signalClass(indexChange)}">가격 ${fmtPct(indexChange)}</span>
            ${aptTrade ? `<span class="db-therm-chip ${signalClass(aptTrade.signals?.medianChangePct)}">실거래 중간값 ${fmtPct(aptTrade.signals?.medianChangePct, 1)}</span>` : ''}
          </div>
        </div>

        <div class="db-summary-report">
          <div class="db-fact-label">요약 리포트</div>
          <p>${renderStreamingWords(summaryReport, 'db-summary-report-stream', 40)}</p>
        </div>

        ${aptTradeHtml}

        <div class="db-regional-grid">
          <div class="db-fact-card db-fact-card--price-pair">
            <div class="db-price-pair-row">
              <div class="db-price-pair-item">
                <div class="db-fact-label">평균 매매가 (25평)</div>
                <div class="db-fact-val">${formatPrice(latestPrice)}</div>
                ${renderChangeTag(priceChange)}
              </div>
              <div class="db-price-pair-item">
                <div class="db-fact-label">평균 전세가 (25평)</div>
                <div class="db-fact-val">${formatPrice(latestJeonse)}</div>
                ${renderChangeTag(jeonseChange)}
              </div>
            </div>
            <div class="db-ratio-inline">
              <span class="db-ratio-inline-label">전세가율</span>
              <span class="db-ratio-inline-value">${ratio !== null ? ratio.toFixed(1) + '%' : '—'}</span>
              ${ratioChange !== null ? `<span class="db-ratio-inline-change ${ratioChange > 0 ? 'up' : ratioChange < 0 ? 'down' : 'flat'}">${ratioChange > 0 ? '▲' : ratioChange < 0 ? '▼' : '—'} ${Math.abs(ratioChange).toFixed(1)}%p 전월 대비</span>` : ''}
            </div>
            <div class="db-ratio-inline db-ratio-inline--sub">
              <span class="db-ratio-inline-label">전세수급</span>
              <span class="db-ratio-inline-value">${latestJeonseSupply !== null ? latestJeonseSupply.toFixed(1) : '—'}</span>
              ${jeonseSupplyChange !== null ? `<span class="db-ratio-inline-change ${jeonseSupplyChange > 0 ? 'up' : jeonseSupplyChange < 0 ? 'down' : 'flat'}">${jeonseSupplyChange > 0 ? '▲' : jeonseSupplyChange < 0 ? '▼' : '—'} ${Math.abs(jeonseSupplyChange).toFixed(2)}% 전월 대비</span>` : ''}
            </div>
          </div>
        </div>

        <div class="db-chart-wrap db-chart-wrap--embedded">
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
          <div class="db-chart-unit">평균 평당가 (만원/평) · 한국부동산원</div>
        </div>
      </div>

      <div class="db-fact-card db-fact-card--context">
        <div class="db-fact-label">전국 비교</div>
        <div class="db-context-section">
          <div class="db-context-title">전국 기준 요약</div>
          <div class="db-therm-row">
            <span class="db-therm-key">전국 변동률</span>
            <span class="db-therm-val${nationalIndexChange !== null && nationalIndexChange > 0 ? ' up' : nationalIndexChange !== null && nationalIndexChange < 0 ? ' down' : ''}">${fmtPct(nationalIndexChange)}</span>
            <span class="db-therm-sub">${selectedName} ${selectedClsId === 500001 ? '기준' : `대비 ${fmtPct(regionalGap)}`}</span>
          </div>
        </div>
        ${regionChanges.length >= 4 ? `
        <div class="db-context-section db-context-section--rank">
          <div class="db-context-title">전국 시도 흐름</div>
          <div class="db-therm-row db-therm-regions">
            <span class="db-therm-key">상위</span>
            ${top2.map(r => `<span class="db-therm-region up">${r.name} ${fmtPct(r.change)}</span>`).join('')}
          </div>
          <div class="db-therm-row db-therm-regions">
            <span class="db-therm-key">하위</span>
            ${bottom2.map(r => `<span class="db-therm-region down">${r.name} ${fmtPct(r.change)}</span>`).join('')}
          </div>
        </div>` : ''}
      </div>

    </div>
  `;
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
