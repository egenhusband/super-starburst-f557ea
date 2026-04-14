// ── 대시보드 ──────────────────────────────────────────

const REGIONS = {
  '서울특별시': ['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구'],
  '부산광역시': ['강서구','금정구','기장군','남구','동구','동래구','부산진구','북구','사상구','사하구','서구','수영구','연제구','영도구','중구','해운대구'],
  '대구광역시': ['군위군','남구','달서구','달성군','동구','북구','서구','수성구','중구'],
  '인천광역시': ['강화군','계양구','남동구','동구','미추홀구','부평구','서구','연수구','옹진군','중구'],
  '광주광역시': ['광산구','남구','동구','북구','서구'],
  '대전광역시': ['대덕구','동구','서구','유성구','중구'],
  '울산광역시': ['남구','동구','북구','울주군','중구'],
  '세종특별자치시': ['세종시'],
  '경기도': ['가평군','고양시','과천시','광명시','광주시','구리시','군포시','김포시','남양주시','동두천시','부천시','성남시','수원시','시흥시','안산시','안성시','안양시','양주시','양평군','여주시','연천군','오산시','용인시','의왕시','의정부시','이천시','파주시','평택시','포천시','하남시','화성시'],
  '강원특별자치도': ['강릉시','고성군','동해시','삼척시','속초시','양구군','양양군','영월군','원주시','인제군','정선군','철원군','춘천시','태백시','평창군','홍천군','화천군','횡성군'],
  '충청북도': ['괴산군','단양군','보은군','영동군','옥천군','음성군','제천시','증평군','진천군','청주시','충주시'],
  '충청남도': ['계룡시','공주시','금산군','논산시','당진시','보령시','부여군','서산시','서천군','아산시','예산군','천안시','청양군','태안군','홍성군'],
  '전북특별자치도': ['고창군','군산시','김제시','남원시','무주군','부안군','순창군','완주군','익산시','임실군','장수군','전주시','정읍시','진안군'],
  '전라남도': ['강진군','고흥군','곡성군','광양시','구례군','나주시','담양군','목포시','무안군','보성군','순천시','신안군','여수시','영광군','영암군','완도군','장성군','장흥군','진도군','함평군','해남군','화순군'],
  '경상북도': ['경산시','경주시','고령군','구미시','군위군','김천시','문경시','봉화군','상주시','성주군','안동시','영덕군','영양군','영주시','영천시','예천군','울릉군','울진군','의성군','청도군','청송군','칠곡군','포항시'],
  '경상남도': ['거제시','거창군','고성군','김해시','남해군','밀양시','사천시','산청군','양산시','의령군','진주시','창녕군','창원시','통영시','하동군','함안군','함양군','합천군'],
  '제주특별자치도': ['서귀포시','제주시'],
};

const PROXY_BASE = '/.netlify/functions/reb-proxy';

const STAT = {
  priceIndex:  'A_2024_00178',
  buyDemand:   'A_2024_00076',
  jenseDemand: 'A_2024_00077',
  avgPrice:    'A_2024_00188',
  avgJeonse:   'A_2024_00192',
};

let chart = null;
let selectedSido = '';
let selectedGu = '';

// ── 대시보드 초기화 ──────────────────────────────────
function initDashboard() {
  const screen = document.getElementById('dashboardScreen');
  screen.innerHTML = `
    <div class="db-wrap">
      <div class="db-header">
        <div class="db-title">내 동네 부동산</div>
        <div class="db-sub">지역을 선택하면 최근 시장 현황을 보여드려요</div>
      </div>
      <div class="db-region">
        <select class="db-select" id="dbSido" onchange="onSidoChange()">
          <option value="">시/도 선택</option>
          ${Object.keys(REGIONS).map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
        <select class="db-select" id="dbGu" disabled onchange="onGuChange()">
          <option value="">시/군/구 선택</option>
        </select>
      </div>
      <div class="db-loading" id="dbLoading" style="display:none">
        <div class="db-loading-dot"></div>
      </div>
      <div class="db-content" id="dbContent" style="display:none">
        <div class="db-facts" id="dbFacts"></div>
        <div class="db-chart-wrap">
          <div class="db-chart-label">매매가격지수 추이 (최근 12개월)</div>
          <canvas id="dbChart"></canvas>
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

function onSidoChange() {
  selectedSido = document.getElementById('dbSido').value;
  const guSel = document.getElementById('dbGu');
  guSel.innerHTML = '<option value="">시/군/구 선택</option>';
  document.getElementById('dbContent').style.display = 'none';
  if (!selectedSido) { guSel.disabled = true; return; }
  guSel.disabled = false;
  REGIONS[selectedSido].forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    guSel.appendChild(opt);
  });
}

function onGuChange() {
  selectedGu = document.getElementById('dbGu').value;
  if (!selectedGu) return;
  loadDashboardData();
}

// ── 캐시 ─────────────────────────────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cacheKey(sido, gu) { return `db_cache_${sido}_${gu}`; }

function getCache(sido, gu) {
  try {
    const raw = localStorage.getItem(cacheKey(sido, gu));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(cacheKey(sido, gu)); return null; }
    return data;
  } catch { return null; }
}

function setCache(sido, gu, data) {
  try { localStorage.setItem(cacheKey(sido, gu), JSON.stringify({ ts: Date.now(), data })); } catch {}
}

// ── API 호출 ─────────────────────────────────────────
async function fetchStat(statblId, pSize) {
  const params = new URLSearchParams({
    STATBL_ID: statblId,
    DTACYCLE_CD: 'MM',
    pSize: pSize || 13,
  });
  const res = await fetch(`${PROXY_BASE}?${params}`);
  return await res.json();
}

// ── 데이터 추출 헬퍼 ─────────────────────────────────
function extractRows(data) {
  // 가능한 응답 구조 모두 시도
  try {
    const candidates = [
      data?.SttsApiTblData?.[1]?.row,
      data?.SttsApiTblData?.[0]?.row,
      data?.result?.row,
      data?.row,
    ];
    for (const rows of candidates) {
      if (Array.isArray(rows) && rows.length > 0) return rows;
    }
  } catch {}
  return null;
}

function extractLatestValue(data) {
  try {
    const rows = extractRows(data);
    if (!rows) return null;
    return parseFloat(rows[0].DTA_VAL);
  } catch { return null; }
}

function extractChartRows(data) {
  try {
    const rows = extractRows(data);
    if (!rows) return [];
    return rows.slice(0, 12).map(r => ({
      period: r.WRTTIME_IDTFR_ID,
      value: parseFloat(r.DTA_VAL),
    }));
  } catch { return []; }
}

// ── 데이터 로드 ───────────────────────────────────────
async function loadDashboardData() {
  const content = document.getElementById('dbContent');
  const loading = document.getElementById('dbLoading');
  content.style.display = 'none';

  const cached = getCache(selectedSido, selectedGu);
  if (cached) {
    renderFacts(cached.buyData, cached.jeonseData, cached.avgPriceData, cached.avgJeonseData);
    renderChart(cached.priceData);
    content.style.display = 'block';
    return;
  }

  loading.style.display = 'flex';

  try {
    const [priceData, buyData, jeonseData, avgPriceData, avgJeonseData] = await Promise.all([
      fetchStat(STAT.priceIndex, 13),
      fetchStat(STAT.buyDemand, 3),
      fetchStat(STAT.jenseDemand, 3),
      fetchStat(STAT.avgPrice, 2),
      fetchStat(STAT.avgJeonse, 2),
    ]);

    setCache(selectedSido, selectedGu, { priceData, buyData, jeonseData, avgPriceData, avgJeonseData });

    renderFacts(buyData, jeonseData, avgPriceData, avgJeonseData);
    renderChart(priceData);

    loading.style.display = 'none';
    content.style.display = 'block';
  } catch (e) {
    loading.style.display = 'none';
    document.getElementById('dbFacts').innerHTML = `<div class="db-error">데이터를 불러오지 못했어요.<br>${e.message}</div>`;
    content.style.display = 'block';
  }
}

// ── 팩트 카드 렌더 ───────────────────────────────────
function renderFacts(buyData, jeonseData, avgPriceData, avgJeonseData) {
  const buyVal    = extractLatestValue(buyData);
  const jeonseVal = extractLatestValue(jeonseData);
  const avgPrice  = extractLatestValue(avgPriceData);
  const avgJeonse = extractLatestValue(avgJeonseData);

  document.getElementById('dbFacts').innerHTML = `
    <div class="db-facts-title">${selectedSido} ${selectedGu} · 아파트 기준</div>
    <div class="db-facts-grid">
      <div class="db-fact-card">
        <div class="db-fact-label">매수 수급</div>
        <div class="db-fact-val">${buyVal ? demandLabel(buyVal) : '—'}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">전세 수급</div>
        <div class="db-fact-val">${jeonseVal ? demandLabel(jeonseVal) : '—'}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">평균 매매가</div>
        <div class="db-fact-val">${avgPrice ? formatManwon(avgPrice) : '—'}</div>
      </div>
      <div class="db-fact-card">
        <div class="db-fact-label">평균 전세가</div>
        <div class="db-fact-val">${avgJeonse ? formatManwon(avgJeonse) : '—'}</div>
      </div>
    </div>
  `;
}

// ── 차트 렌더 ────────────────────────────────────────
function renderChart(priceData) {
  const rows = extractChartRows(priceData);
  if (!rows || rows.length === 0) return;

  const labels = rows.map(r => r.period).reverse();
  const values = rows.map(r => r.value).reverse();

  if (chart) { chart.destroy(); chart = null; }

  const ctx = document.getElementById('dbChart');
  if (!ctx || !window.Chart) {
    setTimeout(() => renderChart(priceData), 500);
    return;
  }

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: '#0a84ff',
        backgroundColor: 'rgba(10,132,255,0.08)',
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: '#0a84ff',
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } }
      }
    }
  });
}

// ── 유틸 ─────────────────────────────────────────────
function demandLabel(val) {
  if (val > 100) return '수요 우위 ↑';
  if (val < 100) return '공급 우위 ↓';
  return '균형';
}

function formatManwon(val) {
  if (!val || isNaN(val)) return '—';
  const 억 = Math.floor(val / 10000);
  const 만 = Math.round((val % 10000) / 100) * 100;
  if (억 > 0 && 만 > 0) return `${억}억 ${만.toLocaleString()}만원`;
  if (억 > 0) return `${억}억원`;
  return `${val.toLocaleString()}만원`;
}

// ── 진입점 ───────────────────────────────────────────
(function() {
  if (localStorage.getItem('authVerified') === '1') {
    document.getElementById('pwScreen').style.display = 'none';
    showDashboard();
  }
})();
