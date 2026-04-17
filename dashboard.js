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

const PROXY_BASE = '/.netlify/functions/reb-proxy';

const STAT = {
  avgPrice:    'A_2024_00188', // 지역별 매매 평균가격_아파트 (만원/㎡)
  avgJeonse:   'A_2024_00192', // 지역별 전세 평균가격_아파트 (만원/㎡)
  priceIndex:  'A_2024_00178', // 지역별 매매지수_아파트
  jeonseIndex: 'A_2024_00182', // 지역별 전세지수_아파트
  tradeVolume: 'A_2024_00554', // 월별 행정구역별 아파트매매거래현황
};

// 최근 N개월 날짜 범위 계산
function getStartDate(months) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, "0")}`;
}

let chart = null;
let selectedClsId     = 500001; // 기본값: 전국
let selectedName      = '전국';
let chartMode         = 'buy';  // 'buy' | 'jeonse'
let chartPeriod       = 6;      // 개월 (기본: 6개월)
let allPriceData      = null;   // 캐시된 전체 데이터
let allJeonseData     = null;
let allIndexData      = null;
let allTradeData      = null;
let lastQueriedRegion = null;   // 마지막으로 조회한 지역

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
        <div class="db-sub">지역을 선택하고 조회하면 최근 시장 현황을 보여드려요</div>
      </div>

      <div class="db-region-grid">${regionBtns}</div>

      <div class="db-query-wrap">
        <button class="db-query-btn" onclick="handleQuery()">조회</button>
      </div>

      <div class="db-placeholder" id="dbPlaceholder">
        지역을 선택하고 조회를 눌러주세요
      </div>

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
              <button class="db-period-tab" onclick="switchPeriod(3, this)">3개월</button>
              <button class="db-period-tab active" onclick="switchPeriod(6, this)">6개월</button>
              <button class="db-period-tab" onclick="switchPeriod(12, this)">1년</button>
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
}

// ── 지역 선택 ─────────────────────────────────────────
function selectRegion(clsId, name) {
  selectedClsId = clsId;
  selectedName  = name;

  document.querySelectorAll('.db-region-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.id) === clsId);
  });
}

// ── 조회 버튼 ─────────────────────────────────────────
function handleQuery() {
  // 같은 지역이고 데이터가 이미 메모리에 있으면 즉각 렌더
  if (lastQueriedRegion === selectedClsId && allPriceData) {
    document.getElementById('dbPlaceholder').style.display = 'none';
    document.getElementById('dbContent').style.display = 'block';
    renderFacts();
    renderChart();
    return;
  }
  lastQueriedRegion = selectedClsId;
  loadDashboardData();
}

// ── 데이터 로드 ───────────────────────────────────────
async function loadDashboardData() {
  const loading     = document.getElementById('dbLoading');
  const content     = document.getElementById('dbContent');
  const placeholder = document.getElementById('dbPlaceholder');
  placeholder.style.display = 'none';
  loading.style.display = 'flex';
  content.style.display = 'none';

  // 캐시 확인
  const cached = getCache('main_v3');
  if (cached) {
    allPriceData  = cached.priceData;
    allJeonseData = cached.jeonseData;
    allIndexData  = cached.indexData;
    allTradeData  = cached.tradeData;
    loading.style.display = 'none';
    content.style.display = 'block';
    renderFacts();
    renderChart();
    return;
  }

  try {
    const start = getStartDate(14); // 1년 + 여유

    const [priceRes, jeonseRes, indexRes, tradeRes] = await Promise.all([
      fetchStat(STAT.avgPrice,    1500, start),
      fetchStat(STAT.avgJeonse,   1500, start),
      fetchStat(STAT.priceIndex,  1500, start),
      fetchStat(STAT.tradeVolume, 1500, start),
    ]);

    allPriceData  = extractRows(priceRes);
    allJeonseData = extractRows(jeonseRes);
    allIndexData  = extractRows(indexRes);
    allTradeData  = extractRows(tradeRes);

    setCache('main_v3', {
      priceData:  allPriceData,
      jeonseData: allJeonseData,
      indexData:  allIndexData,
      tradeData:  allTradeData,
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

// ── API 호출 (페이지네이션) ──────────────────────────
async function fetchStat(statblId, pSize, start) {
  const fetchPage = async (pIndex) => {
    const params = new URLSearchParams({
      STATBL_ID: statblId,
      DTACYCLE_CD: 'MM',
      pSize: 1000,
      pIndex,
    });
    if (start) params.set('START_WRTTIME', start);
    const res = await fetch(`${PROXY_BASE}?${params}`);
    return await res.json();
  };

  const page1 = await fetchPage(1);
  const rows1 = page1?.SttsApiTblData?.[1]?.row || [];
  const total = page1?.SttsApiTblData?.[0]?.head?.[0]?.list_total_count || 0;

  if (total <= 1000) return page1;

  // 2페이지 이상 필요하면 추가 호출
  const page2 = await fetchPage(2);
  const rows2 = page2?.SttsApiTblData?.[1]?.row || [];

  // 두 페이지 합쳐서 반환
  return {
    SttsApiTblData: [
      page1.SttsApiTblData[0],
      { row: [...rows1, ...rows2] }
    ]
  };
}

function extractRows(data) {
  try {
    const rows = data?.SttsApiTblData?.[1]?.row;
    return Array.isArray(rows) ? rows : [];
  } catch { return []; }
}

// ── 지역 필터 ─────────────────────────────────────────
function filterByRegion(rows, clsId) {
  const clsIdStr = String(clsId);
  return rows
    .filter(r => String(r.CLS_ID) === clsIdStr)
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

// ── 전월 대비 등락률 계산 ────────────────────────────
function calcPriceChange(rows) {
  if (!rows || rows.length < 2) return null;
  const prev = parseFloat(rows[rows.length - 2].DTA_VAL);
  const curr = parseFloat(rows[rows.length - 1].DTA_VAL);
  if (!prev || !curr || isNaN(prev) || isNaN(curr)) return null;
  return (curr - prev) / prev * 100;
}

function renderChangeTag(pct) {
  if (pct === null) return '';
  const abs = Math.abs(pct).toFixed(2);
  if (pct > 0)  return `<div class="db-change up">▲ ${abs}% 전월比</div>`;
  if (pct < 0)  return `<div class="db-change down">▼ ${abs}% 전월比</div>`;
  return `<div class="db-change flat">— 전월 동일</div>`;
}

// ── 팩트 카드 렌더 ───────────────────────────────────
function renderFacts() {
  const facts = document.getElementById('dbFacts');
  if (!facts || !allPriceData) return;

  const priceRows  = filterByRegion(allPriceData,  selectedClsId);
  const jeonseRows = filterByRegion(allJeonseData, selectedClsId);
  const indexRows  = filterByRegion(allIndexData,  selectedClsId);
  const tradeRows  = filterByRegion(allTradeData,  selectedClsId);

  const latestPrice  = priceRows.length  ? priceRows[priceRows.length - 1].DTA_VAL  : null;
  const latestJeonse = jeonseRows.length ? jeonseRows[jeonseRows.length - 1].DTA_VAL : null;
  const latestTrade  = tradeRows.length  ? tradeRows[tradeRows.length - 1].DTA_VAL   : null;

  const priceChange  = calcPriceChange(priceRows);
  const jeonseChange = calcPriceChange(jeonseRows);
  const tradeChange  = calcPriceChange(tradeRows);
  const indexChange  = calcPriceChange(indexRows);

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
  const currP    = latestPrice  ? parseFloat(latestPrice)  : null;
  const currJ    = latestJeonse ? parseFloat(latestJeonse) : null;
  const ratio    = (currP && currJ) ? currJ / currP * 100 : null;
  const prevP    = priceRows.length  >= 2 ? parseFloat(priceRows[priceRows.length - 2].DTA_VAL)  : null;
  const prevJ    = jeonseRows.length >= 2 ? parseFloat(jeonseRows[jeonseRows.length - 2].DTA_VAL) : null;
  const prevRatio   = (prevP && prevJ) ? prevJ / prevP * 100 : null;
  const ratioChange = (ratio !== null && prevRatio !== null) ? ratio - prevRatio : null;

  const latestMonth = priceRows.length
    ? priceRows[priceRows.length - 1].WRTTIME_DESC
    : '';

  const fmtPct = (v, digits = 2) => {
    if (v === null || v === undefined) return '—';
    const abs = Math.abs(v).toFixed(digits);
    if (v > 0)  return `▲${abs}%`;
    if (v < 0)  return `▼${abs}%`;
    return `±0%`;
  };

  const tradeVal = latestTrade !== null ? parseInt(latestTrade, 10) : null;

  facts.innerHTML = `
    <div class="db-facts-title">${selectedName} · 아파트 기준${latestMonth ? ` · ${latestMonth}` : ''}</div>
    <div class="db-facts-grid">

      <div class="db-fact-card db-fact-card--therm">
        <div class="db-fact-label">시장 온도계</div>
        <div class="db-therm-row">
          <span class="db-therm-key">거래량</span>
          <span class="db-therm-val">${tradeVal !== null ? tradeVal.toLocaleString() + '건' : '—'}</span>
          <span class="db-therm-tag${tradeChange !== null && tradeChange > 0 ? ' up' : tradeChange !== null && tradeChange < 0 ? ' down' : ' flat'}">${fmtPct(tradeChange, 0)} 전월比</span>
        </div>
        <div class="db-therm-row">
          <span class="db-therm-key">가격변동률</span>
          <span class="db-therm-val${indexChange !== null && indexChange > 0 ? ' up' : indexChange !== null && indexChange < 0 ? ' down' : ''}">${fmtPct(indexChange)}</span>
          <span class="db-therm-sub">전국 ${fmtPct(nationalIndexChange)}</span>
        </div>
        ${regionChanges.length >= 4 ? `
        <div class="db-therm-row db-therm-regions">
          <span class="db-therm-key">상위</span>
          ${top2.map(r => `<span class="db-therm-region up">${r.name} ${fmtPct(r.change)}</span>`).join('')}
          <span class="db-therm-key" style="margin-left:6px">하위</span>
          ${bottom2.map(r => `<span class="db-therm-region down">${r.name} ${fmtPct(r.change)}</span>`).join('')}
        </div>` : ''}
      </div>

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
  if (localStorage.getItem('authVerified') === '1') {
    document.getElementById('pwScreen').style.display = 'none';
    showDashboard();
  }
})();
