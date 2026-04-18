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

const MARKET_CACHE_ENDPOINT = '/.netlify/functions/market-cache';

let chart = null;
let selectedClsId     = 500001; // 기본값: 전국
let selectedName      = '전국';
let chartMode         = 'buy';  // 'buy' | 'jeonse'
let chartPeriod       = 6;      // 개월 (기본: 6개월)
let allPriceData      = null;   // 캐시된 전체 데이터
let allJeonseData     = null;
let allIndexData      = null;
let allTradeData      = null;
let marketBundlePromise = null;

// ── 캐시 ─────────────────────────────────────────────
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function getCache(key) {
  try {
    const raw = localStorage.getItem('db_' + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem('db_' + key); return null; }
    return data;
  } catch { return null; }
}

function setCache(key, data) {
  try { localStorage.setItem('db_' + key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

function getMarketBundleCache() {
  return getCache('market_bundle_v1');
}

function setMarketBundleCache(data) {
  setCache('market_bundle_v1', data);
}

function hydrateMarketBundle(bundle) {
  if (!bundle?.detail) return;
  hydrateDashboardData(bundle.detail);
}

function buildNationalMarqueeItems(summary) {
  if (!summary) return ['전국 시장 데이터 준비 중'];
  const items = [];
  if (summary.latestMonth) items.push(`전국 · <strong>${summary.latestMonth}</strong>`);
  if (Number.isFinite(summary.tradeVolume)) items.push(`거래량 <strong>${summary.tradeVolume.toLocaleString()}건</strong>`);
  if (Number.isFinite(summary.tradeChange)) items.push(`거래량 <strong>${summary.tradeChange > 0 ? '▲' : summary.tradeChange < 0 ? '▼' : '±'}${Math.abs(summary.tradeChange).toFixed(0)}%</strong> 전월比`);
  if (Number.isFinite(summary.priceChange)) items.push(`가격변동률 <strong>${summary.priceChange > 0 ? '▲' : summary.priceChange < 0 ? '▼' : '±'}${Math.abs(summary.priceChange).toFixed(2)}%</strong> 전월比`);
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

  const res = await fetch(MARKET_CACHE_ENDPOINT);
  if (!res.ok) throw new Error('시장 캐시를 불러오지 못했어요.');
  const bundle = await res.json();
  setMarketBundleCache(bundle);
  renderCalculatorMarquee(bundle);
  return bundle;
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
      <div class="db-header">
        <div class="db-title">내 동네 부동산</div>
        <div class="db-sub">지역을 선택하고 조회하면 최근 시장 현황을 보여드려요</div>
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
    showDashboardData();
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
    const bundle = await preloadMarketBundle();
    hydrateMarketBundle(bundle);

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
  if (pct > 0)  return `<div class="db-change up">▲ ${abs}% 전월比</div>`;
  if (pct < 0)  return `<div class="db-change down">▼ ${abs}% 전월比</div>`;
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
        delay += 42;
        return html;
      }).join('')}
    </span>
  `;
}

function buildMarketGuide({ selectedName, tradeVal, tradeChange, indexChange, latestPrice, nationalPrice }) {
  if (tradeVal === null || indexChange === null || latestPrice === null) {
    return {
      title: '시장 읽는 법',
      summary: '최근 수치가 충분하지 않아 지금은 방향을 단정하기보다 추이를 조금 더 지켜보는 편이 안전해요.',
      detail: '거래량과 가격변동률이 2~3개월 연속 같은 방향인지 함께 확인해 보세요.',
      caution: '이 안내는 참고용 요약이며, 투자 수익이나 가격 상승을 보장하지 않아요.'
    };
  }

  let title = '시장 읽는 법';
  let summary = '';

  if (indexChange >= 0.12 && tradeChange !== null && tradeChange >= 5) {
    title = '매수 관심이 붙는 흐름';
    summary = `${selectedName}은 지난달보다 가격 흐름과 거래 움직임이 함께 강해진 편이에요. 관심 지역으로 볼 수 있지만, 단기 과열인지도 같이 확인해야 해요.`;
  } else if (indexChange >= 0.12) {
    title = '가격이 먼저 움직이는 흐름';
    summary = `${selectedName}은 지난달보다 가격 흐름이 강해졌지만 거래가 같이 받쳐주는지는 더 확인이 필요해요. 소수 단지 움직임이 반영됐을 가능성도 있어요.`;
  } else if (indexChange <= -0.12 && tradeChange !== null && tradeChange <= -5) {
    title = '관망세가 짙은 흐름';
    summary = `${selectedName}은 지난달보다 가격 흐름과 거래 움직임이 함께 약해진 편이에요. 서두르기보다 매물과 실거래를 더 비교해보는 쪽이 안전해요.`;
  } else if (indexChange <= -0.12) {
    title = '가격 조정 신호가 보이는 흐름';
    summary = `${selectedName}은 지난달보다 가격 흐름이 다소 약해졌어요. 다만 한 달 수치만으로 추세 전환이라고 단정하기는 어려워요.`;
  } else if (tradeChange !== null && tradeChange >= 10) {
    title = '거래가 먼저 살아나는 흐름';
    summary = `${selectedName}은 거래량이 지난달보다 늘었지만 가격 흐름은 아직 큰 폭으로 움직이지 않았어요. 분위기 회복 초입인지 관찰할 구간에 가까워요.`;
  } else if (tradeChange !== null && tradeChange <= -10) {
    title = '거래가 줄며 숨 고르는 흐름';
    summary = `${selectedName}은 가격 흐름보다 거래가 먼저 줄어든 모습이에요. 실제 매수세가 약해지는 구간인지 추가 확인이 필요해요.`;
  } else {
    title = '뚜렷한 한 방향은 아닌 흐름';
    summary = `${selectedName}은 최근 한 달 기준으로 급한 상승장이나 급한 하락장으로 보긴 어려워요. 한 달 수치보다 몇 달 흐름을 함께 보는 편이 좋아요.`;
  }

  let detail = `현재 평균 매매가(25평)는 ${formatPrice(latestPrice)} 수준으로 보이고, 거래량은 ${tradeVal.toLocaleString()}건이에요.`;
  if (nationalPrice !== null) {
    if (latestPrice >= nationalPrice * 1.4) {
      detail += ' 전국 평균보다 높은 가격대라 자금 계획과 대출 가능 금액을 더 보수적으로 보는 편이 좋아요.';
    } else if (latestPrice <= nationalPrice * 0.8) {
      detail += ' 전국 평균보다 낮은 가격대라 접근성은 있을 수 있지만, 개별 입지 차이는 꼭 따로 봐야 해요.';
    } else {
      detail += ' 전국 평균과 비교해 크게 벗어나지 않는 가격대예요.';
    }
  }

  return {
    title,
    summary,
    detail,
    caution: '이 문구는 거래량·가격변동률·평균 매매가를 단순 해석한 참고용 안내예요. 투자 판단이나 미래 가격 상승을 보장하지 않으며, 실제 매수 전에는 단지별 실거래가와 대출 조건을 꼭 함께 확인해 주세요.'
  };
}

// ── 팩트 카드 렌더 ───────────────────────────────────
function renderFacts() {
  const facts = document.getElementById('dbFacts');
  if (!facts || !allPriceData) return;

  const priceRows       = filterByRegion(allPriceData,  selectedClsId);
  const jeonseRows      = filterByRegion(allJeonseData, selectedClsId);
  const indexRows       = filterByRegion(allIndexData,  selectedClsId);
  const tradeRows       = filterTradeByRegion(allTradeData, selectedClsId);
  const validPriceRows  = getRecentValidRows(priceRows, 0);
  const validJeonseRows = getRecentValidRows(jeonseRows, 0);

  const latestPrice  = validPriceRows.length  ? validPriceRows[validPriceRows.length - 1].DTA_VAL   : null;
  const latestJeonse = validJeonseRows.length ? validJeonseRows[validJeonseRows.length - 1].DTA_VAL : null;
  const latestTrade  = tradeRows.length ? parseNumericValue(tradeRows[tradeRows.length - 1].DTA_VAL) : null;

  const priceChange  = calcPriceChange(priceRows);
  const jeonseChange = calcPriceChange(jeonseRows);
  const tradeChange  = calcTradeChange(tradeRows);
  const indexChange  = calcPriceChange(indexRows);

  // 전국 가격변동률 (선택 지역이 전국이 아닐 때 비교용)
  const nationalIndexRows   = filterByRegion(allIndexData, 500001);
  const nationalIndexChange = calcPriceChange(nationalIndexRows);
  const nationalPriceRows   = filterByRegion(allPriceData, 500001);
  const validNationalPriceRows = getRecentValidRows(nationalPriceRows, 0);

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
  const latestNationalPrice = validNationalPriceRows.length
    ? parseNumericValue(validNationalPriceRows[validNationalPriceRows.length - 1].DTA_VAL)
    : null;

  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v).toFixed(digits);
    if (v > 0)  return `▲${abs}%`;
    if (v < 0)  return `▼${abs}%`;
    return `±0%`;
  };

  const tradeVal = latestTrade !== null ? parseInt(latestTrade, 10) : null;
  const marketGuide = buildMarketGuide({
    selectedName,
    tradeVal,
    tradeChange,
    indexChange,
    latestPrice: currP,
    nationalPrice: latestNationalPrice,
  });

  facts.innerHTML = `
    <div class="db-facts-title">${selectedName} · 아파트 기준${latestMonth ? ` · ${latestMonth}` : ''}</div>
    <div class="db-facts-grid">

      <div class="db-fact-card db-fact-card--regional">
        <div class="db-fact-label">지역 시장 요약</div>
        <div class="db-fact-card db-fact-card--therm">
          <div class="db-fact-label">시장 온도계</div>
          <div class="db-therm-row">
            <span class="db-therm-key">거래량</span>
            <span class="db-therm-val">${tradeVal !== null ? tradeVal.toLocaleString() + '건' : '—'}</span>
            <span class="db-therm-tag${tradeChange !== null && tradeChange > 0 ? ' up' : tradeChange !== null && tradeChange < 0 ? ' down' : ' flat'}">${fmtPct(tradeChange, 0)} 전월比</span>
            <span class="db-therm-sub">선택 지역 기준</span>
          </div>
          <div class="db-therm-row">
            <span class="db-therm-key">가격변동률</span>
            <span class="db-therm-val${indexChange !== null && indexChange > 0 ? ' up' : indexChange !== null && indexChange < 0 ? ' down' : ''}">${fmtPct(indexChange)}</span>
            <span class="db-therm-tag${indexChange !== null && indexChange > 0 ? ' up' : indexChange !== null && indexChange < 0 ? ' down' : ' flat'}">전월比</span>
            <span class="db-therm-sub">선택 지역 기준</span>
          </div>
        </div>

        <div class="db-regional-grid">
          <div class="db-fact-card">
            <div class="db-fact-label">전세가율</div>
            <div class="db-fact-val">${ratio !== null ? ratio.toFixed(1) + '%' : '—'}</div>
            ${ratioChange !== null ? `<div class="db-change ${ratioChange > 0 ? 'up' : ratioChange < 0 ? 'down' : 'flat'}">${ratioChange > 0 ? '▲' : ratioChange < 0 ? '▼' : '—'} ${Math.abs(ratioChange).toFixed(1)}%p 전월比</div>` : ''}
          </div>

          <div class="db-fact-card">
            <div class="db-fact-label">평균 매매가 (25평)</div>
            <div class="db-fact-val">${formatPrice(latestPrice)}</div>
            ${renderChangeTag(priceChange)}
          </div>

          <div class="db-fact-card">
            <div class="db-fact-label">평균 전세가 (25평)</div>
            <div class="db-fact-val">${formatPrice(latestJeonse)}</div>
            ${renderChangeTag(jeonseChange)}
          </div>
        </div>

        <div class="db-market-guide">
          <div class="db-market-guide-title">${marketGuide.title}</div>
          <div class="db-market-guide-summary">${renderStreamingWords(marketGuide.summary, 'db-market-guide-stream', 40)}</div>
          <div class="db-market-guide-detail">${renderStreamingWords(marketGuide.detail, 'db-market-guide-stream', 220)}</div>
          <div class="db-market-guide-caution">${marketGuide.caution}</div>
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
