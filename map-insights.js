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
    products: '정책대출 대상 아님 — 시중은행 주담대만 가능' },
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
    blocks.push(`<div class="db-map-sheet-commute">${mapInsightsEscape(dest.label)}까지 지하철 약 <b>${commute}분</b> <small>(도보 포함 추정)</small></div>`);
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
  return { stationMap, nameToIds, adjacency, stationNames };
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
      // 그래프가 아직 없으면 불러온 뒤 다시 그린다 (그 사이엔 통과)
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

function mapInsightsIsFiltered(filters) {
  return Number(filters?.policyMax) > 0 || (Boolean(filters?.commuteDest) && Number(filters?.commuteMax) > 0);
}

function mapInsightsSummaryParts(filters) {
  const parts = [];
  const policy = MAP_POLICY_FILTER_OPTIONS.find(option => option.value && option.value === Number(filters?.policyMax));
  if (policy) parts.push(policy.label);
  const dest = getMapCommuteDestination(filters?.commuteDest);
  if (dest && Number(filters?.commuteMax) > 0) parts.push(`${dest.label} ${filters.commuteMax}분 내`);
  return parts;
}

function setDashboardMapPolicyMax(value) {
  const draft = getMapInsightsDraft();
  if (!draft) return;
  draft.policyMax = Number(value) || null;
  if (typeof updateDashboardMapFilterUi === 'function') updateDashboardMapFilterUi();
}

function setDashboardMapCommuteDest(destKey) {
  const draft = getMapInsightsDraft();
  if (!draft) return;
  draft.commuteDest = destKey || null;
  if (draft.commuteDest && !Number(draft.commuteMax)) draft.commuteMax = 45;
  if (!draft.commuteDest) draft.commuteMax = null;
  saveMapCommuteDest(draft.commuteDest);
  if (draft.commuteDest) loadMapCommuteGraph().catch(() => {});
  if (typeof updateDashboardMapFilterUi === 'function') updateDashboardMapFilterUi();
}

function setDashboardMapCommuteMax(minutes) {
  const draft = getMapInsightsDraft();
  if (!draft) return;
  draft.commuteMax = Number(minutes) || null;
  if (typeof updateDashboardMapFilterUi === 'function') updateDashboardMapFilterUi();
}

// 검색바 옆 "출퇴근" 버튼 — 필터 패널을 열고 출퇴근 영역으로 스크롤
function openDashboardMapCommuteFilter() {
  if (typeof openDashboardMapFilterPanel === 'function') openDashboardMapFilterPanel();
  loadMapCommuteGraph().then(populateMapCommuteStationOptions).catch(() => {});
  window.setTimeout(() => {
    document.getElementById('dbMapCommuteGroup')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 60);
}

function buildMapInsightsFilterGroupsHtml() {
  return `
    <div class="db-map-filter-group">
      <span>정책대출 가격선 <small>(가장 싼 평형 최근 실거래가)</small></span>
      <div class="db-map-filter-chips">
        ${MAP_POLICY_FILTER_OPTIONS.map(option => `<button type="button" data-map-policy-max="${option.value}" class="db-map-filter-chip${option.value ? '' : ' is-selected'}" onclick="setDashboardMapPolicyMax(${option.value})">${option.label}</button>`).join('')}
      </div>
    </div>
    <div class="db-map-filter-group db-map-commute-group" id="dbMapCommuteGroup">
      <span>직주근접 <small>(지하철 + 도보 추정)</small></span>
      <select id="dbMapCommuteDest" class="db-map-commute-select" onfocus="loadMapCommuteGraph().then(populateMapCommuteStationOptions).catch(() => {})" onchange="setDashboardMapCommuteDest(this.value)" aria-label="출근지 선택">
        <option value="">출근지 선택 안 함</option>
        <optgroup label="주요 업무지구">
          ${MAP_COMMUTE_PRESETS.map(preset => `<option value="${preset.key}">${preset.label}</option>`).join('')}
        </optgroup>
        <optgroup id="dbMapCommuteStationGroup" label="역으로 직접 선택"></optgroup>
      </select>
      <div class="db-map-filter-chips" id="dbMapCommuteMaxChips">
        ${MAP_COMMUTE_MAX_OPTIONS.map(min => `<button type="button" data-map-commute-max="${min}" class="db-map-filter-chip" onclick="setDashboardMapCommuteMax(${min})">${min}분 이내</button>`).join('')}
      </div>
      <p class="db-map-commute-note">서울 지하철·신분당·수인분당·경강선 기준 추정이에요. 1·3·4·7호선 경기 구간, 서해선, GTX 등 아직 노선 데이터가 없는 역 주변 단지는 시간 필터를 켜면 제외돼요.</p>
    </div>`;
}

function populateMapCommuteStationOptions() {
  const group = document.getElementById('dbMapCommuteStationGroup');
  if (!group || !mapCommuteGraph || group.dataset.filled === '1') return;
  group.innerHTML = mapCommuteGraph.stationNames
    .map(name => `<option value="station:${mapInsightsEscape(name)}">${mapInsightsEscape(name)}역</option>`)
    .join('');
  group.dataset.filled = '1';
  const select = document.getElementById('dbMapCommuteDest');
  const draft = typeof dashboardApartmentMapState !== 'undefined'
    ? (dashboardApartmentMapState.filterDraft || dashboardApartmentMapState.filters) : null;
  if (select && draft?.commuteDest) select.value = draft.commuteDest;
}

function mapInsightsUpdateFilterUi(filters) {
  const panel = document.getElementById('dbMapFilterPanel');
  if (!panel) return;
  panel.querySelectorAll('[data-map-policy-max]').forEach(button => {
    const selected = (Number(filters?.policyMax) || 0) === Number(button.dataset.mapPolicyMax);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const select = document.getElementById('dbMapCommuteDest');
  if (select) {
    const dest = filters?.commuteDest || '';
    if (dest.startsWith('station:') && ![...select.options].some(option => option.value === dest)) {
      loadMapCommuteGraph().then(populateMapCommuteStationOptions).catch(() => {});
    }
    select.value = dest;
  }
  const chips = document.getElementById('dbMapCommuteMaxChips');
  chips?.classList.toggle('is-disabled', !filters?.commuteDest);
  panel.querySelectorAll('[data-map-commute-max]').forEach(button => {
    const selected = Boolean(filters?.commuteDest) && (Number(filters?.commuteMax) || 0) === Number(button.dataset.mapCommuteMax);
    button.classList.toggle('is-selected', selected);
    button.disabled = !filters?.commuteDest;
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
