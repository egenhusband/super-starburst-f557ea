/*
 * 단지 지도 확장 — ① 정책대출 가격선 레이어 ② 직주근접(출퇴근 시간) 필터
 *
 * dashboard.js의 지도 상태(dashboardApartmentMapState)에 얹혀 동작한다.
 * dashboard.js 쪽에는 typeof 가드가 걸린 훅만 있고, 로직은 전부 이 파일에 있다.
 *
 * 가격 기준: 단지 내 평형별 "최근 실거래가" 중 가장 낮은 값.
 *  → "이 단지에 정책대출로 살 수 있는 평형이 있는가"를 보여주기 위함.
 * 정책 기준(2026-11): 디딤돌 일반 5억 / 보금자리·디딤돌(신혼·2자녀) 6억 / 신생아 특례 9억 /
 *  수도권·규제지역 시중 주담대 한도 15억↓ 6억 · 25억↓ 4억 · 25억↑ 2억 (10·15 대책)
 */

const MAP_POLICY_TIERS = [
  { key: 'didimdol', maxManwon: 50000, label: '디딤돌 가능', short: '5억↓', color: '#22c55e',
    products: '디딤돌(일반 5억) · 보금자리론 · 신생아 특례 모두 검토 가능' },
  { key: 'bogeum', maxManwon: 60000, label: '보금자리 가능', short: '6억↓', color: '#2dd4bf',
    products: '보금자리론 · 디딤돌(신혼·2자녀 6억) · 신생아 특례 검토 가능' },
  { key: 'newborn', maxManwon: 90000, label: '신생아 특례만', short: '9억↓', color: '#f472b6',
    products: '정책대출은 신생아 특례(2년 내 출산 가구, 9억 이하)만 가능' },
  { key: 'bank', maxManwon: Infinity, label: '시중은행만', short: '9억↑', color: '#94a3b8',
    products: '정책대출은 어렵고 시중은행 주담대만 가능해요' },
];
const MAP_POLICY_FILTER_OPTIONS = [
  { value: 0, label: '전체' },
  { value: 90000, label: '신생아 9억↓' },
  { value: 60000, label: '보금자리 6억↓' },
  { value: 50000, label: '디딤돌 5억↓' },
];

const MAP_COMMUTE_GRAPH_URL = '/data/subway-seoul-times.json?v=20260517';
const MAP_COMMUTE_STORAGE_KEY = 'map_commute_dest_v1';
const MAP_COMMUTE_WALK_M_PER_MIN = 80;
const MAP_COMMUTE_MAX_WALK_MIN = 25; // 역까지 2km(25분) 넘으면 지하철 출퇴근 단지로 보지 않는다
const MAP_COMMUTE_MAX_OPTIONS = [30, 45, 60];
const MAP_COMMUTE_PRESETS = [
  { key: 'gbd', label: '강남', stations: ['강남', '역삼', '선릉', '삼성'] },
  { key: 'cbd', label: '광화문·시청', stations: ['광화문', '종각', '시청', '을지로입구'] },
  { key: 'ybd', label: '여의도', stations: ['여의도', '여의나루'] },
  { key: 'pangyo', label: '판교', stations: ['판교'] },
  { key: 'seongsu', label: '성수', stations: ['성수', '뚝섬'] },
  { key: 'mbd', label: '마곡', stations: ['마곡나루', '발산'] },
  { key: 'yongsan', label: '용산', stations: ['용산', '신용산'] },
  { key: 'gasan', label: '가산디지털단지', stations: ['가산디지털단지'] },
  { key: 'jamsil', label: '잠실', stations: ['잠실'] },
];

let mapPolicyLayerEnabled = true;
let mapCommuteGraph = null;
let mapCommuteGraphPromise = null;
const mapCommuteDistanceCache = new Map(); // destKey → Map(stationId → minutes)
const mapCommuteOriginCache = new Map();   // kaptCode → { ids, walk }

// ── 공통 ────────────────────────────────────────────
function mapInsightsEscape(text) {
  return typeof escapeHtml === 'function' ? escapeHtml(text) : String(text ?? '');
}

function mapInsightsFormatEok(manwon) {
  const value = Number(manwon);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return `${(value / 10000).toFixed(1).replace('.0', '')}억`;
}

function getMapInsightsDefaultFilters() {
  return { policyMax: null, commuteDest: getSavedMapCommuteDest(), commuteMax: null };
}

function copyMapInsightsFilters(target, source) {
  target.policyMax = Number(source?.policyMax) || null;
  target.commuteDest = source?.commuteDest || null;
  target.commuteMax = Number(source?.commuteMax) || null;
  return target;
}

// ── ① 정책대출 가격선 ───────────────────────────────
// 단지 내 평형 중 최근 실거래가가 가장 낮은 평형 (정책대출 기준 가격)
function getMapPolicyBasis(item) {
  const areas = Array.isArray(item?.areas) ? item.areas : [];
  let best = null;
  areas.forEach(area => {
    const price = Number(area?.latestPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    if (!best || price < best.price) best = { price, area: area.area || '', date: area.latestDate || '' };
  });
  if (best) return best;
  const fallback = Number(item?.latestTradePrice);
  return Number.isFinite(fallback) && fallback > 0
    ? { price: fallback, area: item?.avgTradeArea ? `${Math.round(item.avgTradeArea)}㎡` : '', date: item?.latestDealDate || '' }
    : null;
}

function getMapPolicyTier(item) {
  const basis = getMapPolicyBasis(item);
  if (!basis) return null;
  return MAP_POLICY_TIERS.find(tier => basis.price <= tier.maxManwon) || null;
}

// 수도권(서울·경기) 시중 주담대 최대 한도 — 10·15 대책
function getMapBankLoanCapText(priceManwon) {
  const eok = Number(priceManwon) / 10000;
  if (!Number.isFinite(eok) || eok <= 0) return '';
  if (eok <= 15) return '시중 주담대 최대 6억';
  if (eok <= 25) return '시중 주담대 최대 4억';
  return '시중 주담대 최대 2억';
}

function toggleDashboardPolicyLayer() {
  mapPolicyLayerEnabled = !mapPolicyLayerEnabled;
  syncMapPolicyToggleUi();
  if (typeof applyDashboardMapFilters === 'function' && dashboardApartmentMapState?.map) applyDashboardMapFilters();
}

function syncMapPolicyToggleUi() {
  const toggle = document.getElementById('dbMapPolicyToggle');
  toggle?.classList.toggle('is-off', !mapPolicyLayerEnabled);
  toggle?.setAttribute('aria-pressed', String(mapPolicyLayerEnabled));
  const state = toggle?.querySelector('span');
  if (state) state.textContent = mapPolicyLayerEnabled ? 'ON' : 'OFF';
  const legend = document.getElementById('dbMapPolicyLegend');
  legend?.classList.toggle('is-visible', mapPolicyLayerEnabled);
  legend?.setAttribute('aria-hidden', mapPolicyLayerEnabled ? 'false' : 'true');
}

function buildMapPolicyControlsHtml() {
  return `
    <button id="dbMapPolicyToggle" class="db-map-policy-toggle" type="button" aria-pressed="true" onclick="toggleDashboardPolicyLayer()">정책대출 가격선 <span>ON</span></button>
    <div id="dbMapPolicyLegend" class="db-map-policy-legend is-visible" aria-hidden="false">
      <div class="db-map-policy-legend-items">
        ${MAP_POLICY_TIERS.map(tier => `<span><i style="background:${tier.color}"></i>${tier.short} ${tier.label}</span>`).join('')}
      </div>
      <small>단지 내 가장 싼 평형의 최근 실거래가 기준</small>
    </div>`;
}

// 단지 오버레이에 붙일 클래스/스타일
function decorateMapApartmentOverlay(element, item) {
  if (!element) return;
  if (mapPolicyLayerEnabled) {
    const tier = getMapPolicyTier(item);
    if (tier) {
      element.classList.add('has-policy-tier');
      element.style.setProperty('--policy-tier-color', tier.color);
      element.dataset.policyTier = tier.key;
    }
  }
  const commute = getMapCommuteMinutesForItem(item);
  if (Number.isFinite(commute)) {
    const top = element.querySelector('.db-map-area-overlay-top');
    if (top) top.textContent = `출근 ${commute}분`;
    element.classList.add('has-commute');
  }
}

// 지역 묶음 오버레이에 붙일 요약 한 줄
function buildMapAreaOverlayExtraHtml(group) {
  if (!mapPolicyLayerEnabled || !Array.isArray(group?.members)) return '';
  const affordable = group.members.filter(member => {
    const basis = getMapPolicyBasis(member);
    return basis && basis.price <= 60000;
  }).length;
  if (!affordable) return '';
  return `<span class="db-map-area-overlay-policy">6억↓ ${affordable.toLocaleString()}개</span>`;
}

// 단지 시트(하단)에 들어갈 정책대출·출퇴근 블록
function buildMapApartmentSheetExtraHtml(item) {
  const blocks = [];
  const basis = getMapPolicyBasis(item);
  const tier = getMapPolicyTier(item);
  if (basis && tier) {
    const bankCap = tier.key === 'bank' ? ` · ${getMapBankLoanCapText(basis.price)}` : '';
    blocks.push(`
      <div class="db-map-sheet-policy" style="--policy-tier-color:${tier.color}">
        <b>${tier.short} ${tier.label}</b>
        <span>${mapInsightsEscape(basis.area || '최저 평형')} 최근 ${mapInsightsFormatEok(basis.price)} 기준 · ${mapInsightsEscape(tier.products)}${bankCap}</span>
      </div>`);
  }
  const commute = getMapCommuteMinutesForItem(item);
  const dest = getMapCommuteDestination(getMapInsightsActiveFilters()?.commuteDest);
  if (dest && Number.isFinite(commute)) {
    blocks.push(`<div class="db-map-sheet-commute">🚇 ${mapInsightsEscape(dest.label)}까지 지하철 약 <b>${commute}분</b> <small>(도보 포함 추정)</small></div>`);
  }
  return blocks.join('');
}

// ── ② 직주근접 필터 ─────────────────────────────────
function normalizeMapStationToken(value) {
  return String(value || '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+(?:\d+호선|신분당선|수인분당선|분당선|경의중앙선|경강선|공항철도공항선|공항철도|우이신설선|서해선|인천1호선|인천2호선|GTX-?[A-Z])$/u, '')
    .replace(/\s+/g, '')
    .replace(/역$/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
}

function normalizeMapLineToken(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, '').replace(/^서울/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '').toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('수인분당') || normalized === '분당선') return '분당선';
  if (normalized.includes('신분당')) return '신분당선';
  if (normalized.includes('경의중앙')) return '경의중앙선';
  if (normalized.includes('경강')) return '경강선';
  if (normalized.includes('공항철도')) return '공항철도';
  const lineNo = normalized.match(/^(\d)(?:호선)?$/);
  if (lineNo) return `${lineNo[1]}호선`;
  return normalized;
}

function buildMapCommuteGraph(payload) {
  const stationMap = new Map();
  const nameToIds = new Map();
  const adjacency = new Map();
  const displayNames = new Map(); // token → 화면 표기용 역 이름(괄호 부기 제거)
  const linesByToken = new Map();  // token → Set(노선명)
  (payload?.stations || []).forEach(station => {
    stationMap.set(station.id, station);
    // "판교(판교테크노밸리)"의 stationNameNormalized는 "판교판교테크노밸리"라서, 괄호를 뗀 이름도 함께 등록한다
    const tokens = new Set([
      normalizeMapStationToken(station.stationName),
      normalizeMapStationToken(station.stationNameNormalized),
    ].filter(Boolean));
    tokens.forEach(token => {
      if (!nameToIds.has(token)) nameToIds.set(token, []);
      nameToIds.get(token).push(station.id);
    });
    const plainName = String(station.stationName || '').replace(/\([^)]*\)/g, '').trim();
    const plainToken = normalizeMapStationToken(plainName);
    if (plainName && !displayNames.has(plainToken)) displayNames.set(plainToken, plainName);
    if (!linesByToken.has(plainToken)) linesByToken.set(plainToken, new Set());
    linesByToken.get(plainToken).add(station.lineName);
  });
  const connect = (from, to, minutes) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, minutes });
  };
  (payload?.edges || []).forEach(edge => {
    const minutes = Number(edge.minutes);
    if (!edge?.from || !edge?.to || !Number.isFinite(minutes)) return;
    connect(edge.from, edge.to, minutes);
    connect(edge.to, edge.from, minutes);
  });
  const stationNames = [...displayNames.values()].sort((a, b) => a.localeCompare(b, 'ko'));
  const stationList = [...displayNames.entries()].map(([token, name]) => ({
    token, name, lines: [...(linesByToken.get(token) || [])],
  })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { stationMap, nameToIds, adjacency, stationNames, stationList };
}

function loadMapCommuteGraph() {
  if (mapCommuteGraph) return Promise.resolve(mapCommuteGraph);
  if (mapCommuteGraphPromise) return mapCommuteGraphPromise;
  mapCommuteGraphPromise = fetch(MAP_COMMUTE_GRAPH_URL)
    .then(response => {
      if (!response.ok) throw new Error('지하철 노선 데이터를 불러오지 못했어요.');
      return response.json();
    })
    .then(payload => {
      mapCommuteGraph = buildMapCommuteGraph(payload);
      return mapCommuteGraph;
    })
    .catch(error => {
      mapCommuteGraphPromise = null;
      throw error;
    });
  return mapCommuteGraphPromise;
}

function getMapCommuteDestination(destKey) {
  if (!destKey) return null;
  const preset = MAP_COMMUTE_PRESETS.find(p => p.key === destKey);
  if (preset) return preset;
  if (destKey.startsWith('station:')) {
    const name = destKey.slice('station:'.length);
    return { key: destKey, label: `${name}역`, stations: [name] };
  }
  return null;
}

// 목적지(여러 역) → 모든 역까지 최단 시간 (다익스트라, 단방향 1회)
function getMapCommuteDistances(destKey) {
  if (!mapCommuteGraph || !destKey) return null;
  if (mapCommuteDistanceCache.has(destKey)) return mapCommuteDistanceCache.get(destKey);
  const dest = getMapCommuteDestination(destKey);
  if (!dest) return null;
  const sources = dest.stations.flatMap(name => mapCommuteGraph.nameToIds.get(normalizeMapStationToken(name)) || []);
  const distances = new Map();
  const queue = [];
  sources.forEach(id => { distances.set(id, 0); queue.push([0, id]); });
  while (queue.length) {
    let minIndex = 0;
    for (let i = 1; i < queue.length; i += 1) if (queue[i][0] < queue[minIndex][0]) minIndex = i;
    const [minutes, id] = queue.splice(minIndex, 1)[0];
    if (minutes !== distances.get(id)) continue;
    (mapCommuteGraph.adjacency.get(id) || []).forEach(edge => {
      const next = minutes + edge.minutes;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next);
        queue.push([next, edge.to]);
      }
    });
  }
  mapCommuteDistanceCache.set(destKey, distances);
  return distances;
}

function parseMapWalkMinutes(item) {
  const distance = Number(item?.stationMetaDistance);
  if (Number.isFinite(distance) && distance > 0) return Math.max(1, Math.round(distance / MAP_COMMUTE_WALK_M_PER_MIN));
  const raw = String(item?.subwayDistance || '');
  if (raw.includes('5분이내')) return 4;
  if (raw.includes('5~10분')) return 8;
  if (raw.includes('10~15분')) return 13;
  if (raw.includes('15~20분')) return 18;
  if (raw.includes('20분초과')) return 24;
  return null;
}

function getMapCommuteOrigin(item) {
  const cacheKey = item?.kaptCode || item?.id;
  if (cacheKey && mapCommuteOriginCache.has(cacheKey)) return mapCommuteOriginCache.get(cacheKey);
  const graph = mapCommuteGraph;
  const result = { ids: [], walk: parseMapWalkMinutes(item) };
  if (graph) {
    // 1순위: 카카오 기준 가장 가까운 역(노선명 포함) → 해당 노선 역만
    const metaName = String(item?.stationMetaName || '');
    const metaMatch = metaName.match(/^(.*?역)\s+(.+)$/u);
    const metaToken = normalizeMapStationToken(metaMatch ? metaMatch[1] : metaName);
    const metaLine = metaMatch ? normalizeMapLineToken(metaMatch[2]) : '';
    const metaIds = graph.nameToIds.get(metaToken) || [];
    const metaLineIds = metaLine ? metaIds.filter(id => normalizeMapLineToken(graph.stationMap.get(id)?.lineName) === metaLine) : [];
    if (metaLineIds.length) result.ids = metaLineIds;
    else if (metaIds.length) result.ids = metaIds;
    // 2순위: 공동주택 단지정보의 인근 역
    if (!result.ids.length) {
      String(item?.subwayStation || '').split(/[,/]/).map(s => s.trim()).filter(Boolean).forEach(name => {
        (graph.nameToIds.get(normalizeMapStationToken(name)) || []).forEach(id => result.ids.push(id));
      });
    }
    if (cacheKey) mapCommuteOriginCache.set(cacheKey, result);
  }
  return result;
}

function getMapCommuteMinutesForItem(item, destKey = getMapInsightsActiveFilters()?.commuteDest) {
  if (!destKey || !mapCommuteGraph) return null;
  const distances = getMapCommuteDistances(destKey);
  if (!distances) return null;
  const origin = getMapCommuteOrigin(item);
  if (!origin.ids.length || !Number.isFinite(origin.walk) || origin.walk > MAP_COMMUTE_MAX_WALK_MIN) return null;
  let ride = Infinity;
  origin.ids.forEach(id => { ride = Math.min(ride, distances.get(id) ?? Infinity); });
  if (!Number.isFinite(ride)) return null;
  return Math.max(1, Math.round(ride + origin.walk));
}

function getSavedMapCommuteDest() {
  try { return localStorage.getItem(MAP_COMMUTE_STORAGE_KEY) || null; } catch { return null; }
}

function saveMapCommuteDest(destKey) {
  try {
    if (destKey) localStorage.setItem(MAP_COMMUTE_STORAGE_KEY, destKey);
    else localStorage.removeItem(MAP_COMMUTE_STORAGE_KEY);
  } catch {}
}

function getMapInsightsActiveFilters() {
  return typeof dashboardApartmentMapState !== 'undefined' ? dashboardApartmentMapState.filters : null;
}

function getMapInsightsDraft() {
  if (typeof dashboardApartmentMapState === 'undefined') return null;
  const state = dashboardApartmentMapState;
  if (!state.filterDraft && typeof cloneDashboardMapFilters === 'function') state.filterDraft = cloneDashboardMapFilters(state.filters);
  return state.filterDraft;
}

// ── 필터 연동 (dashboard.js 훅) ─────────────────────
function mapInsightsItemPasses(item, filters) {
  const policyMax = Number(filters?.policyMax);
  if (Number.isFinite(policyMax) && policyMax > 0) {
    const basis = getMapPolicyBasis(item);
    if (!basis || basis.price > policyMax) return false;
  }
  const commuteMax = Number(filters?.commuteMax);
  if (filters?.commuteDest && Number.isFinite(commuteMax) && commuteMax > 0) {
    if (!mapCommuteGraph) {
      // 노선 데이터를 아직 못 받았으면 받은 뒤 다시 그린다 (그 사이엔 통과)
      loadMapCommuteGraph().then(() => {
        if (typeof applyDashboardMapFilters === 'function') applyDashboardMapFilters();
      }).catch(() => {});
      return true;
    }
    const minutes = getMapCommuteMinutesForItem(item, filters.commuteDest);
    if (!Number.isFinite(minutes) || minutes > commuteMax) return false;
  }
  return true;
}

// 필터 버튼의 '적용됨' 표시·요약에는 출퇴근을 넣지 않는다 (출퇴근 버튼이 따로 상태를 보여줌)
function mapInsightsIsFiltered(filters) {
  return Number(filters?.policyMax) > 0;
}
function mapInsightsSummaryParts() { return []; }
function mapInsightsUpdateFilterUi() { syncMapCommuteSheetUi(); }

// ── 출퇴근 시트 (필터와 따로 열림, 누르면 바로 적용) ──
function buildMapCommuteSheetHtml() {
  return `
    <div id="dbMapCommuteSheet" class="db-map-filter-panel db-map-commute-sheet" aria-label="출퇴근 조건">
      <div class="db-map-filter-header">
        <div><strong>출퇴근</strong><span id="dbMapCommuteSummary">회사까지 지하철로 몇 분인지 보여줘요</span></div>
        <button type="button" class="db-map-filter-close" onclick="closeDashboardMapCommuteSheet()" aria-label="출퇴근 닫기">×</button>
      </div>
      <div class="db-map-filter-group">
        <span>어디로 출근하세요?</span>
        <div class="db-map-filter-chips">
          ${MAP_COMMUTE_PRESETS.map(preset => `<button type="button" data-map-commute-dest="${preset.key}" class="db-map-filter-chip" onclick="toggleDashboardMapCommuteDest('${preset.key}')">${preset.label}</button>`).join('')}
        </div>
        <div class="db-map-commute-search">
          <input id="dbMapCommuteSearch" type="search" autocomplete="off" placeholder="다른 역 검색 (예: 홍대입구)" aria-label="출근하는 역 검색"
            onfocus="loadMapCommuteGraph().catch(() => {})" oninput="renderMapCommuteSuggestions(this.value)">
          <div id="dbMapCommuteSuggest" class="db-map-commute-suggest" role="listbox"></div>
        </div>
        <div id="dbMapCommuteCustom" class="db-map-commute-custom" hidden></div>
      </div>
      <div class="db-map-filter-group" id="dbMapCommuteTimeGroup">
        <span>몇 분 안에?</span>
        <div class="db-map-filter-chips">
          <button type="button" data-map-commute-max="0" class="db-map-filter-chip" onclick="setDashboardMapCommuteMax(0)">시간만 표시</button>
          ${MAP_COMMUTE_MAX_OPTIONS.map(min => `<button type="button" data-map-commute-max="${min}" class="db-map-filter-chip" onclick="setDashboardMapCommuteMax(${min})">${min}분 이내</button>`).join('')}
        </div>
      </div>
      <p class="db-map-commute-note">지하철 + 걷는 시간 추정이에요. 1·3·4·7호선 경기 구간, 서해선, GTX 근처 단지는 아직 계산이 안 돼서 시간으로 거르면 빠져요.</p>
      <div class="db-map-filter-actions"><button type="button" class="db-map-filter-apply" onclick="closeDashboardMapCommuteSheet()">지도 보기</button><button type="button" class="db-map-filter-reset" onclick="clearDashboardMapCommute()">해제</button></div>
    </div>`;
}

function openDashboardMapCommuteFilter() {
  const sheet = document.getElementById('dbMapCommuteSheet');
  if (!sheet) return;
  if (sheet.classList.contains('is-visible')) { closeDashboardMapCommuteSheet(); return; }
  if (typeof closeDashboardMapFilterPanel === 'function') closeDashboardMapFilterPanel();
  if (typeof closeDashboardMapApartment === 'function') closeDashboardMapApartment();
  loadMapCommuteGraph().catch(() => {});
  sheet.classList.add('is-visible');
  syncMapCommuteSheetUi();
}

function closeDashboardMapCommuteSheet() {
  document.getElementById('dbMapCommuteSheet')?.classList.remove('is-visible');
}

function applyMapCommuteChange() {
  const filters = getMapInsightsActiveFilters();
  if (!filters) return;
  saveMapCommuteDest(filters.commuteDest);
  syncMapCommuteSheetUi();
  const redraw = () => { if (typeof applyDashboardMapFilters === 'function' && dashboardApartmentMapState?.map) applyDashboardMapFilters(); };
  if (filters.commuteDest) loadMapCommuteGraph().then(redraw).catch(redraw);
  else redraw();
}

function setMapCommuteDest(destKey) {
  const filters = getMapInsightsActiveFilters();
  if (!filters) return;
  filters.commuteDest = destKey || null;
  if (!filters.commuteDest) filters.commuteMax = null;
  else if (filters.commuteMax == null) filters.commuteMax = 45;
  applyMapCommuteChange();
}

// 업무지구 칩: 다시 누르면 해제
function toggleDashboardMapCommuteDest(destKey) {
  const filters = getMapInsightsActiveFilters();
  setMapCommuteDest(filters?.commuteDest === destKey ? null : destKey);
}

function setDashboardMapCommuteMax(minutes) {
  const filters = getMapInsightsActiveFilters();
  if (!filters?.commuteDest) return;
  filters.commuteMax = Number(minutes) || 0;
  applyMapCommuteChange();
}

function clearDashboardMapCommute() {
  setMapCommuteDest(null);
  closeDashboardMapCommuteSheet();
}

function getMapCommuteStationMatches(query, limit = 6) {
  if (!mapCommuteGraph) return [];
  const token = normalizeMapStationToken(query);
  if (!token) return [];
  const prefix = [];
  const partial = [];
  mapCommuteGraph.stationList.forEach(station => {
    if (station.token.startsWith(token)) prefix.push(station);
    else if (station.token.includes(token)) partial.push(station);
  });
  return [...prefix, ...partial].slice(0, limit);
}

function renderMapCommuteSuggestions(query) {
  const box = document.getElementById('dbMapCommuteSuggest');
  if (!box) return;
  if (!String(query || '').trim()) { box.innerHTML = ''; return; }
  if (!mapCommuteGraph) {
    box.innerHTML = '<p class="db-map-commute-suggest-empty">역 목록을 불러오는 중이에요</p>';
    loadMapCommuteGraph().then(() => renderMapCommuteSuggestions(document.getElementById('dbMapCommuteSearch')?.value)).catch(() => {});
    return;
  }
  const matches = getMapCommuteStationMatches(query);
  box.innerHTML = matches.length
    ? matches.map(station => `<button type="button" role="option" onclick="pickMapCommuteStation('${mapInsightsEscape(station.name)}')"><strong>${mapInsightsEscape(station.name)}역</strong><span>${mapInsightsEscape(station.lines.join(' · '))}</span></button>`).join('')
    : '<p class="db-map-commute-suggest-empty">노선 데이터에 없는 역이에요. 가까운 다른 역으로 검색해 주세요.</p>';
}

function pickMapCommuteStation(name) {
  const input = document.getElementById('dbMapCommuteSearch');
  if (input) input.value = '';
  renderMapCommuteSuggestions('');
  setMapCommuteDest(`station:${name}`);
}

function getMapCommuteLabel(filters) {
  const dest = getMapCommuteDestination(filters?.commuteDest);
  if (!dest) return '';
  return Number(filters?.commuteMax) > 0 ? `${dest.label} ${filters.commuteMax}분` : dest.label;
}

function syncMapCommuteSheetUi() {
  const filters = getMapInsightsActiveFilters();
  const dest = filters?.commuteDest || '';
  const label = getMapCommuteLabel(filters);
  const trigger = document.getElementById('dbMapCommuteButton');
  if (trigger) {
    trigger.textContent = label || '출퇴근';
    trigger.classList.toggle('is-filtered', Boolean(dest));
  }
  const sheet = document.getElementById('dbMapCommuteSheet');
  if (!sheet) return;
  const summary = document.getElementById('dbMapCommuteSummary');
  if (summary) {
    summary.textContent = !dest ? '회사까지 지하철로 몇 분인지 보여줘요'
      : Number(filters.commuteMax) > 0 ? `${label} 이내 단지만 보여주는 중` : `${label}까지 걸리는 시간을 단지에 표시 중`;
  }
  sheet.querySelectorAll('[data-map-commute-dest]').forEach(button => {
    const selected = button.dataset.mapCommuteDest === dest;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const custom = document.getElementById('dbMapCommuteCustom');
  if (custom) {
    const isStation = dest.startsWith('station:');
    custom.hidden = !isStation;
    custom.innerHTML = isStation
      ? `<span>출근역</span><strong>${mapInsightsEscape(dest.slice('station:'.length))}역</strong><button type="button" onclick="setMapCommuteDest(null)" aria-label="출근역 선택 해제">해제</button>`
      : '';
  }
  document.getElementById('dbMapCommuteTimeGroup')?.classList.toggle('is-disabled', !dest);
  sheet.querySelectorAll('[data-map-commute-max]').forEach(button => {
    const selected = Boolean(dest) && (Number(filters?.commuteMax) || 0) === Number(button.dataset.mapCommuteMax);
    button.classList.toggle('is-selected', selected);
    button.disabled = !dest;
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

if (typeof module === 'object' && module.exports) {
  module.exports = {
    MAP_POLICY_TIERS,
    getMapPolicyBasis,
    getMapPolicyTier,
    getMapBankLoanCapText,
    buildMapCommuteGraph,
    normalizeMapStationToken,
    normalizeMapLineToken,
    _setGraph(graph) { mapCommuteGraph = graph; mapCommuteDistanceCache.clear(); mapCommuteOriginCache.clear(); },
    getMapCommuteMinutesForItem,
    mapInsightsItemPasses,
  };
}
