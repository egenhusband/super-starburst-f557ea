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

// 수급동향 CLS_ID (A_2024_00076 기준)
const DEMAND_REGION_MAP = [
  { id: 100001, name: '전국' },
  { id: 100004, name: '서울' },
  { id: 100012, name: '경기' },
  { id: 100007, name: '인천' },
  { id: 100005, name: '부산' },
  { id: 100006, name: '대구' },
  { id: 100008, name: '광주' },
  { id: 100009, name: '대전' },
  { id: 100010, name: '울산' },
  { id: 100011, name: '세종' },
  { id: 100013, name: '강원' },
  { id: 100014, name: '충북' },
  { id: 100015, name: '충남' },
  { id: 100016, name: '전북' },
  { id: 100017, name: '전남' },
  { id: 100018, name: '경북' },
  { id: 100019, name: '경남' },
  { id: 100020, name: '제주' },
];

const PROXY_BASE = '/.netlify/functions/reb-proxy';

const STAT = {
  avgPrice:    'A_2024_00188', // 지역별 매매 평균가격_아파트 (만원/㎡)
  avgJeonse:   'A_2024_00192', // 지역별 전세 평균가격_아파트 (만원/㎡)
  buyDemand:   'A_2024_00076', // 매매수급동향_아파트
  jenseDemand: 'A_2024_00077', // 전세수급동향_아파트
  priceIndex:  'A_2024_00178', // 지역별 매매지수_아파트
  jeonseIndex: 'A_2024_00182', // 지역별 전세지수_아파트
};

// 최근 N개월 날짜 범위 계산
function getStartDate(months) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
}

let chart = null;
let selectedClsId = 500001; // 기본값: 전국
let selectedName  = '전국';
let chartMode     = 'buy';  // 'buy' | 'jeonse'
let chartPeriod   = 12;     // 개월
let allPriceData  = null;   // 캐시된 전체 데이터
let allJeonseData = null;

// ── 캐시 ─────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000;

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
      <div class="db-header">
        <div class="db-title">내 동네 부동산</div>
        <div class="db-sub">지역을 선택하면 최근 시장 현황을 보여드려요</div>
      </div>

      <div class="db-region-grid">${regionBtns}</div>

      <div class="db-loading" id="dbLoading" style="display:none">
        <div class="db-loading-dot"></div>
      </div>

      <div class="db-content" id="dbContent" style="display:none">
        <div class="db-facts" id="dbFacts"></div>

        <div class="db-chart-wrap">
          <div class="db-chart-top">
            <div class="db-chart-tabs">
              <button class="db-chart-tab active" onclick="switchChartMode('buy', this)">매매</button>
              <button class="db-chart-tab" onclick="switchChartMode('jeonse', this)">전세</button>
            </div>
            <div class="db-period-tabs">
              <button class="db-period-tab" onclick="switchPeriod(1, this)">1개월</button>
              <button class="db-period-tab" onclick="switchPeriod(6, this)">6개월</button>
              <button class="db-period-tab active" onclick="switchPeriod(12, this)">1년</button>
              <button class="db-period-tab" onclick="switchPeriod(36, this)">3년</button>
            </div>
          </div>
          <canvas id="dbChart"></canvas>
          <div class="db-chart-unit">평균 평당가 (만원/평) · 한국부동산원</div>
        </div>
      </div>

      <div class="db-cta-wrap">
        <button class="db-cta" onclick="showCalculator()">내 조건으로 대출 알아보기 →</button>
      </div>
    </div>
  `;

  if (!window.Chart) {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    document.head.appendChild(s);
  }

  loadDashboardData();
}

// ── 지역 선택 ─────────────────────────────────────────
function selectRegion(clsId, name) {
  selectedClsId = clsId;
  selectedName  = name;

  document.querySelectorAll('.db-region-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.id) === clsId);
  });

  renderFacts();
  renderChart();
}

// ── 데이터 로드 ───────────────────────────────────────
async function loadDashboardData() {
  const loading = document.getElementById('dbLoading');
  const content = document.getElementById('dbContent');
  loading.style.display = 'flex';
  content.style.display = 'none';

  // 캐시 확인
  const cached = getCache('main');
  if (cached) {
    allPriceData  = cached.priceData;
    allJeonseData = cached.jeonseData;
    allBuyDemand  = cached.buyDemand;
    allJenseDemand = cached.jenseDemand;
    loading.style.display = 'none';
    content.style.display = 'block';
    renderFacts();
    renderChart();
    return;
  }

  try {
    const start = getStartDate(40); // 3년 + 여유

    const [priceRes, jeonseRes, buyRes, jeonseReq] = await Promise.all([
      fetchStat(STAT.avgPrice,    1500, start),
      fetchStat(STAT.avgJeonse,   1500, start),
      fetchStat(STAT.buyDemand,   1500, start),
      fetchStat(STAT.jenseDemand, 1500, start),
    ]);

    allPriceData   = extractRows(priceRes);
    allJeonseData  = extractRows(jeonseRes);
    allBuyDemand   = extractRows(buyRes);
    allJenseDemand = extractRows(jeonseReq);

    setCache('main', {
      priceData:  allPriceData,
      jeonseData: allJeonseData,
      buyDemand:  allBuyDemand,
      jenseDemand: allJenseDemand,
    });

    loading.style.display = 'none';
    content.style.display = 'block';
    renderFacts();
    renderChart();
  } catch (e) {
    loading.style.display = 'none';
    content.innerHTML = `<div class="db-error">데이터를 불러오지 못했어요.<br>${e.message}</div>`;
    content.style.display = 'block';
  }
}

let allBuyDemand   = null;
let allJenseDemand = null;

// ── API 호출 ─────────────────────────────────────────
async function fetchStat(statblId, pSize, start) {
  const params = new URLSearchParams({
    STATBL_ID: statblId,
    DTACYCLE_CD: 'MM',
    pSize: pSize || 1500,
  });
  if (start) params.set('START_WRTTIME', start);
  const res = await fetch(`${PROXY_BASE}?${params}`);
  return await res.json();
}

function extractRows(data) {
  try {
    const rows = data?.SttsApiTblData?.[1]?.row;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

// ── 지역 필터 ─────────────────────────────────────────
function filterByRegion(rows, clsId) {
  return rows
    .filter(r => r.CLS_ID === clsId)
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

// ── 팩트 카드 렌더 ───────────────────────────────────
function renderFacts() {
  const facts = document.getElementById('dbFacts');
  if (!facts || !allPriceData) return;

  // 최신 데이터 1개
  const priceRows  = filterByRegion(allPriceData,   selectedClsId);
  const jeonseRows = filterByRegion(allJeonseData,  selectedClsId);
  const buyRows    = filterByRegion(allBuyDemand,   selectedClsId);
  const jeonseReqRows = filterByRegion(allJenseDemand, selectedClsId);

  const latestPrice  = priceRows.length  ? priceRows[priceRows.length - 1].DTA_VAL  : null;
  const latestJeonse = jeonseRows.length ? jeonseRows[jeonseRows.length - 1].DTA_VAL : null;
  const latestBuy    = buyRows.length    ? buyRows[buyRows.length - 1].DTA_VAL       : null;
  const latestJReq   = jeonseReqRows.length ? jeonseReqRows[jeonseReqRows.length - 1].DTA_VAL : null;

  facts.innerHTML = `
    <div class="db-facts-title">${selectedName} · 아파트 기준</div>
    <div class="db-facts-grid">
      <div class="db-fact-card">
        <div class="db-fact-label">매매 시장</div>
        <div class="db-fact-val">${demandLabel(latestBuy)}</div>
        <div class="db-fact-desc">${demandDesc(latestBuy, '매매')}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">전세 시장</div>
        <div class="db-fact-val">${demandLabel(latestJReq)}</div>
        <div class="db-fact-desc">${demandDesc(latestJReq, '전세')}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">평균 매매가 (25평)</div>
        <div class="db-fact-val">${formatPrice(latestPrice)}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">평균 전세가 (25평)</div>
        <div class="db-fact-val">${formatPrice(latestJeonse)}</div>
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

  const color = chartMode === 'buy' ? '#0a84ff' : '#30d158';
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
function demandLabel(val) {
  if (val === null || val === undefined) return '—';
  if (val > 100) return '사려는 사람↑';
  if (val < 100) return '팔려는 사람↑';
  return '균형';
}

function demandDesc(val, type) {
  if (val === null || val === undefined) return '';
  if (val > 100) return `${type}하려는 수요가 더 많아요`;
  if (val < 100) return `${type} 매물이 더 많아요`;
  return '수요와 공급이 비슷해요';
}

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
  if (localStorage.getItem('authVerified') === '1') {
    document.getElementById('pwScreen').style.display = 'none';
    showDashboard();
  }
})();
