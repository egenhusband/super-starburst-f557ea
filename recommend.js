/* ── 예산 기반 단지 추천 (오버레이 화면) ──
 * calculator.js 결과화면 CTA → openRecommendScreen({targetPrice, region})
 * 카드 탭 → 기존 단지 상세(pickDashboardApartment) 재사용
 */
(function () {
  'use strict';

  const INDEX_URL = 'data/apt-recommend-index.json?v=20260616a';
  const MAX_CARDS = 30;

  const RecoState = {
    items: [],
    loaded: false,
    loading: null,
    priority: 'all',         // 'all' | 'school' | 'new' | 'big'
    region: 'all',
    // 가격 슬라이더 (단위: 억)
    sliderPrice: 0,          // 현재 슬라이더 값
    floor: 1,                // 슬라이더 하한
    ceiling: 0,              // 슬라이더 천장 = 계산기에 입력한 주택가격
    safeBudget: 0,           // 하위호환 payload 필드
    maxBudget: 0,            // 하위호환 payload 필드
    asset: 0,                // 보유 자산(시드)
    maxLoan: 0,              // 최대 대출 가능액
    eligiblePriceCap: 0,     // 자격되는 상품의 집값 상한
    targetPrice: 0,          // 사용자가 입력한 집값
    clampNote: '',           // 입력가가 천장 초과 시 안내
  };

  const eok = man => man / 10000;
  const pyeong = m2 => Math.round(parseFloat(m2) / 3.305);
  const distanceLabel = m => {
    const n = Number(m);
    if (!Number.isFinite(n) || n <= 0) return '';
    return n >= 1000 ? (n / 1000).toFixed(n >= 2000 ? 0 : 1) + 'km' : Math.round(n) + 'm';
  };
  function buildTrafficTag(x) {
    const parts = [];
    const station = distanceLabel(x.stationDistance);
    const stationName = String(x.stationName || '').trim();
    if (station) parts.push((stationName || '가까운 역') + ' ' + station);
    const minutes = Number(x.businessDistrict?.totalMinutes);
    if (Number.isFinite(minutes) && minutes > 0) parts.push('업무지구 ' + Math.round(minutes) + '분');
    return parts.length ? '<span class="traffic">' + escapeReco(parts.join(' · ')) + '</span>' : '';
  }

  function recommendationSignalScore(x) {
    let score = 0;
    if ((x.clampedScore || 0) >= 6) score += 2;
    if (Number.isFinite(Number(x.stationDistance))) score += 2;
    if (Number.isFinite(Number(x.businessDistrict?.totalMinutes))) score += 2;
    if (Number.isFinite(Number(x.schoolDistance)) && Number(x.schoolDistance) <= 700) score += 1;
    if (Number.isFinite(Number(x.householdCount)) && Number(x.householdCount) >= 1000) score += 1;
    if (Number.isFinite(Number(x.buildYear)) && Number(x.buildYear) >= 2015) score += 1;
    return score;
  }

  // 추천에서 단지 상세(apt-search)까지 진입했는지 — 닫을 때 계산기 결과로 복귀할지 판단
  let recoDetailActive = false;

  function loadIndex() {
    if (RecoState.loaded) return Promise.resolve();
    if (RecoState.loading) return RecoState.loading;
    RecoState.loading = fetch(INDEX_URL)
      .then(r => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
      .then(json => { RecoState.items = json.items || []; RecoState.loaded = true; })
      .catch(err => { RecoState.loading = null; throw err; });
    return RecoState.loading;
  }

  // ── 화면 골격 ──
  function ensureScreen() {
    let screen = document.getElementById('recommendScreen');
    if (screen) return screen;
    screen = document.createElement('div');
    screen.id = 'recommendScreen';
    document.querySelector('.app').appendChild(screen);
    return screen;
  }

  function renderLayout() {
    const screen = ensureScreen();
    screen.innerHTML = `
      <div class="reco-topbar">
        <button class="reco-back" type="button" onclick="closeRecommendScreen()" aria-label="닫기">‹</button>
        <div><div class="reco-tt">이 가격대 단지</div><div class="reco-ts" id="recoSub">수도권 우선 제공</div></div>
      </div>
      <div class="reco-scroll">
        <div class="reco-filterbar">
          <div class="reco-note">입력한 주택가격 기준으로 볼 수 있는 단지예요.</div>
          <div class="reco-price-filter">
            <span class="reco-price-caption">가격</span>
            <strong class="reco-slider-val" id="recoVal">—</strong>
            <input type="range" class="reco-range" id="recoRange" oninput="recoSetPrice(this.value)" min="1" max="6" step="0.1" value="5">
          </div>
          <div class="reco-row reco-filter-row" id="recoPriRow">
            <select class="reco-region" id="recoRegion" onchange="recoRender()"></select>
            <div class="reco-chip on" data-k="all" onclick="recoSetPriority('all',this)">종합순</div>
            <div class="reco-chip pri" data-k="school" onclick="recoSetPriority('school',this)">🎒 초등 도보권</div>
            <div class="reco-chip pri" data-k="new" onclick="recoSetPriority('new',this)">🏗️ 신축</div>
            <div class="reco-chip pri" data-k="big" onclick="recoSetPriority('big',this)">🏢 대단지</div>
          </div>
        </div>
        <div class="reco-body">
          <div class="reco-summary"><span class="reco-count" id="recoCount">…</span><span id="recoSummary"></span></div>
          <div id="recoList"></div>
          <div class="reco-foot">
            · 표시 가격은 <b>국토부 실거래가</b> 기준이며 층·향·시점에 따라 달라질 수 있어요. 현재 매물 호가가 아니에요.<br>
            · 입력가보다 높은 단지는 대출 조건이 달라질 수 있어 별도 재계산이 필요해요.<br>
            · 입지 등급은 수도권 기준 보조 참고용이에요.
          </div>
        </div>
      </div>
    `;
    syncSlider();
    buildRegionOptions();
  }

  // 슬라이더 UI 동기화 (값·존 태그·눈금·안내)
  function syncSlider() {
    const range = document.getElementById('recoRange');
    const val = document.getElementById('recoVal');
    const tag = document.getElementById('recoTag');
    const f = RecoState.floor, c = RecoState.ceiling, p = RecoState.sliderPrice;
    if (range) {
      range.min = f; range.max = c; range.step = 0.1; range.value = p;
    }
    if (val) val.textContent = `${p.toFixed(1)}억`;
    // 추천은 계산기에 입력한 주택가격 이하로만 제한한다.
    if (tag) {
      tag.textContent = '입력가 기준';
      tag.className = 'reco-slider-tag safe';
    }
    const minEl = document.getElementById('recoMin');
    const maxEl = document.getElementById('recoMax');
    const safeEl = document.getElementById('recoSafeMark');
    if (minEl) minEl.textContent = `${f.toFixed(1)}억`;
    if (maxEl) maxEl.textContent = `${c.toFixed(1)}억`;
    if (safeEl) safeEl.textContent = '';
    const noteEl = document.getElementById('recoNote');
    if (noteEl) noteEl.textContent = RecoState.clampNote || '';

    // 추천 기준 안내: 계산 결과의 입력 주택가격을 상한으로 사용한다.
    const srcEl = document.getElementById('recoBudgetSrc');
    if (srcEl) {
      srcEl.innerHTML = `입력한 주택가격 <b>${RecoState.targetPrice.toFixed(1)}억 이하</b> · 평균 실거래가 기준`;
    }
  }

  function buildRegionOptions() {
    const sel = document.getElementById('recoRegion');
    if (!sel) return;
    const cnt = {};
    RecoState.items.forEach(x => { cnt[x.sigunguName] = (cnt[x.sigunguName] || 0) + 1; });
    const seoul = Object.keys(cnt).filter(s => RecoState.items.some(x => x.sigunguName === s && x.regionKey === 'seoul')).sort((a, b) => a.localeCompare(b, 'ko'));
    const gyeonggi = Object.keys(cnt).filter(s => RecoState.items.some(x => x.sigunguName === s && x.regionKey === 'gyeonggi')).sort((a, b) => a.localeCompare(b, 'ko'));
    const options = names => names.map(s => `<option value="sgg:${escapeReco(s)}">${escapeReco(s)}</option>`).join('');
    sel.innerHTML =
      `<option value="all">수도권 전체</option>` +
      `<option value="__seoul">서울 전체</option>` +
      `<option value="__gyeonggi">경기 전체</option>` +
      `<optgroup label="서울">${options(seoul)}</optgroup>` +
      `<optgroup label="경기">${options(gyeonggi)}</optgroup>`;
    sel.value = RecoState.region || 'all';
  }

  // ── 정렬 ──
  function sortKey(x) {
    if (RecoState.priority === 'school') return x.schoolDistance == null ? Infinity : x.schoolDistance;
    if (RecoState.priority === 'new') return x.buildYear == null ? -Infinity : x.buildYear;
    if (RecoState.priority === 'big') return x.householdCount == null ? -Infinity : x.householdCount;
    return x.clampedScore == null ? -Infinity : x.clampedScore;
  }
  function sortCmp(a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    if (RecoState.priority === 'all') {
      const signalDiff = recommendationSignalScore(b) - recommendationSignalScore(a);
      if (signalDiff) return signalDiff;
    }
    return RecoState.priority === 'school' ? ka - kb : kb - ka;
  }

  function inRegion(x) {
    const r = RecoState.region;
    if (r === 'all') return true;
    if (r === '__seoul') return x.regionKey === 'seoul';
    if (r === '__gyeonggi') return x.regionKey === 'gyeonggi';
    if (r && r.indexOf('sgg:') === 0) return x.sigunguName === r.slice(4);
    return true;
  }

  function render() {
    if (!RecoState.loaded) return;
    const cap = RecoState.sliderPrice;
    const capMan = cap * 10000;

    let list = RecoState.items.filter(x => x.minAvgPrice <= capMan && inRegion(x));
    list.sort(sortCmp);
    const total = list.length;
    const featured = list.slice(0, MAX_CARDS);
    const rest = list.slice(MAX_CARDS);
    list = featured;

    const r = RecoState.region;
    const rgnLabel = r === 'all' ? '수도권 전체' : r === '__seoul' ? '서울 전체' : r === '__gyeonggi' ? '경기 전체' : r.slice(4);
    const priLabel = RecoState.priority !== 'all'
      ? `<b>${({ school: '초등 도보권', new: '신축', big: '대단지' })[RecoState.priority]}</b> 위주로, ` : '';

    const countEl = document.getElementById('recoCount');
    const sumEl = document.getElementById('recoSummary');
    const subEl = document.getElementById('recoSub');
    if (countEl) countEl.textContent = featured.length.toLocaleString() + '/' + total.toLocaleString() + '곳';
    if (sumEl) sumEl.innerHTML = `${priLabel}<b>${rgnLabel}</b> · 입력가 <b>${cap.toFixed(1)}억 이하</b>`;
    if (subEl) subEl.textContent = `${rgnLabel} · ${cap.toFixed(1)}억 이하`;
    document.querySelectorAll('#recoPriRow .reco-chip').forEach(chip => {
      chip.classList.toggle('on', chip.dataset.k === RecoState.priority);
    });

    const wrap = document.getElementById('recoList');
    if (!wrap) return;
    if (!total) {
      wrap.innerHTML = `<div class="reco-empty"><div class="e">🔍</div>
        <p>이 조건에 맞는 단지를 못 찾았어요.<br>지역을 넓히거나 조건을 다시 확인해보세요.</p>
        <button type="button" onclick="recoSetPrice(${RecoState.ceiling})">입력가 ${RecoState.ceiling.toFixed(1)}억 기준으로 보기</button></div>`;
      return;
    }

    wrap.innerHTML = list.map((x, i) => {
      const within = x.areas.filter(a => a.avgPrice <= capMan);
      const top = within[within.length - 1];
      const gap = eok(capMan - top.avgPrice);
      const tight = gap < 0.4;
      const fitTag = `<span class="fit${tight ? ' tight' : ''}">${top.area} · 입력가 대비 ${gap.toFixed(1)}억 낮음</span>`;
      const latestTag = top.latestPrice
        ? `<span>최근 ${eok(top.latestPrice).toFixed(1)}억${top.latestDate ? '·' + top.latestDate.slice(0, 7) : ''}</span>` : '';
      const highTag = top.recentHigh?.within3M
        ? `<span class="record">${escapeReco(top.recentHigh.label || '최근 최고가')}</span>` : '';
      const rank = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : '';
      const g = x.grade || '';
      const gc = g.charAt(0) === 'S' ? 'reco-g-s' : g.charAt(0) === 'A' ? 'reco-g-a' : 'reco-g-b';

      const tags = [];
      const trafficTag = buildTrafficTag(x);
      if (trafficTag) tags.push(trafficTag);
      if (RecoState.priority === 'school') tags.push(x.schoolDistance != null ? `<span class="hi">초등학교 ${x.schoolDistance}m</span>` : `<span class="na">초등학교 거리 준비 중</span>`);
      if (RecoState.priority === 'new') tags.push(x.buildYear != null ? `<span class="hi">${x.buildYear}년 준공</span>` : `<span class="na">준공정보 준비 중</span>`);
      if (RecoState.priority === 'big') tags.push(x.householdCount != null ? `<span class="hi">${x.householdCount.toLocaleString()}세대</span>` : `<span class="na">세대수 준비 중</span>`);
      if (x.householdCount != null) tags.push(`<span>${x.householdCount.toLocaleString()}세대</span>`);
      if (x.buildYear != null) tags.push(`<span>${x.buildYear}년</span>`);
      if (x.schoolDistance != null) tags.push(`<span>초등 도보권 ${x.schoolDistance}m</span>`);

      return `<div class="reco-card" onclick="recoOpenDetail('${x.kaptCode}')">
        <div class="reco-card-top">
          <div class="reco-grade ${gc}">${g}</div>
          <div style="flex:1;min-width:0">
            <div class="reco-nm">${rank}${escapeReco(x.aptName)}</div>
            <div class="reco-loc">${x.regionKey === 'seoul' ? '서울' : '경기'} ${escapeReco(x.sigunguName)} ${escapeReco(x.umdName || '')}</div>
          </div>
          <div style="flex-shrink:0;text-align:right">
            <div class="reco-price">${eok(top.avgPrice).toFixed(1)}억</div>
            <div class="reco-loc">${top.area}·${pyeong(top.area)}평</div>
          </div>
        </div>
        <div class="reco-meta">${fitTag}${latestTag}${highTag}${tags.slice(0, 3).join('')}</div>
        <div class="reco-detail">입지 분석 자세히 보기 ›</div>
      </div>`;
    }).join('') + (rest.length
      ? `<div class="reco-list-divider"><span>추천 단지 전체</span><em>상위 ${featured.length.toLocaleString()}곳 다음 · ${rest.length.toLocaleString()}곳</em></div>`
        + rest.map((x, i) => {
          const within = x.areas.filter(a => a.avgPrice <= capMan);
          const top = within[within.length - 1];
          const gap = eok(capMan - top.avgPrice);
          const tight = gap < 0.4;
          const fitTag = `<span class="fit${tight ? ' tight' : ''}">${top.area} · 입력가 대비 ${gap.toFixed(1)}억 낮음</span>`;
          const latestTag = top.latestPrice
            ? `<span>최근 ${eok(top.latestPrice).toFixed(1)}억${top.latestDate ? '·' + top.latestDate.slice(0, 7) : ''}</span>` : '';
          const highTag = top.recentHigh?.within3M
            ? `<span class="record">${escapeReco(top.recentHigh.label || '최근 최고가')}</span>` : '';
          const g = x.grade || '';
          const gc = g.charAt(0) === 'S' ? 'reco-g-s' : g.charAt(0) === 'A' ? 'reco-g-a' : 'reco-g-b';
          const tags = [];
          const trafficTag = buildTrafficTag(x);
          if (trafficTag) tags.push(trafficTag);
          if (x.householdCount != null) tags.push(`<span>${x.householdCount.toLocaleString()}세대</span>`);
          if (x.buildYear != null) tags.push(`<span>${x.buildYear}년</span>`);
          if (x.schoolDistance != null) tags.push(`<span>초등 도보권 ${x.schoolDistance}m</span>`);
          return `<div class="reco-card" onclick="recoOpenDetail('${x.kaptCode}')">
            <div class="reco-card-top">
              <div class="reco-grade ${gc}">${g}</div>
              <div style="flex:1;min-width:0">
                <div class="reco-nm">${escapeReco(x.aptName)}</div>
                <div class="reco-loc">${x.regionKey === 'seoul' ? '서울' : '경기'} ${escapeReco(x.sigunguName)} ${escapeReco(x.umdName || '')}</div>
              </div>
              <div style="flex-shrink:0;text-align:right">
                <div class="reco-price">${eok(top.avgPrice).toFixed(1)}억</div>
                <div class="reco-loc">${top.area}·${pyeong(top.area)}평</div>
              </div>
            </div>
            <div class="reco-meta">${fitTag}${latestTag}${highTag}${tags.slice(0, 3).join('')}</div>
            <div class="reco-detail">입지 분석 자세히 보기 ›</div>
          </div>`;
        }).join('')
      : '');
  }

  function escapeReco(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── 공개 API ──
  function openRecommendScreen(ctx) {
    ctx = ctx || {};
    document.getElementById('resultFloatingSummary')?.remove();
    recoDetailActive = false; // 새 세션 시작(계산기 결과 위에서 열림)
    RecoState.safeBudget = Number(ctx.safeBudget) || 0;
    RecoState.maxBudget = Number(ctx.maxBudget) || RecoState.safeBudget;
    RecoState.asset = Number(ctx.asset) || 0;
    RecoState.maxLoan = Number(ctx.maxLoan) || 0;
    RecoState.eligiblePriceCap = Number(ctx.eligiblePriceCap) || 0;
    RecoState.targetPrice = Number(ctx.targetPrice) || 0;
    RecoState.region = ctx.region || 'all';
    RecoState.priority = 'all';

    // 천장 = 계산기에 입력한 주택가격. 다른 가격대는 별도 재계산이 필요하므로 MVP에서는 넘기지 않는다.
    let ceiling = RecoState.targetPrice || RecoState.maxBudget || RecoState.eligiblePriceCap || 6;
    const floor = ceiling > 2 ? 1.0 : Math.max(0.5, Math.round(ceiling * 0.5 * 10) / 10);
    RecoState.ceiling = Math.round(ceiling * 10) / 10;
    RecoState.floor = Math.min(floor, RecoState.ceiling - 0.1);

    // 기본 위치 = 입력 집값(천장 넘으면 천장으로 클램프 + 안내)
    const target = RecoState.targetPrice || RecoState.ceiling;
    RecoState.sliderPrice = Math.max(RecoState.floor, Math.min(target, RecoState.ceiling));
    if (target > RecoState.ceiling + 1e-9) {
      const byCap = RecoState.eligiblePriceCap && RecoState.eligiblePriceCap <= RecoState.maxBudget;
      RecoState.clampNote = byCap
        ? `입력하신 ${target.toFixed(1)}억은 대출 자격상한을 넘어, ${RecoState.ceiling.toFixed(1)}억 이하를 보여드려요.`
        : `입력한 주택가격 ${RecoState.ceiling.toFixed(1)}억 이하 단지를 보여드려요.`;
    } else {
      RecoState.clampNote = '';
    }

    renderLayout();
    const screen = document.getElementById('recommendScreen');
    void screen.offsetWidth; // reflow → enter 트랜지션 보장
    setTimeout(() => screen.classList.add('is-open'), 20);

    const listEl = document.getElementById('recoList');
    if (listEl) listEl.innerHTML = `<div class="reco-empty"><div class="e">⏳</div><p>단지를 불러오는 중…</p></div>`;
    loadIndex()
      .then(() => { buildRegionOptions(); render(); })
      .catch(() => {
        if (listEl) listEl.innerHTML = `<div class="reco-empty"><div class="e">⚠️</div><p>목록을 불러오지 못했어요.<br>잠시 후 다시 시도해주세요.</p></div>`;
      });
  }

  function closeRecommendScreen() {
    const screen = document.getElementById('recommendScreen');
    if (screen) screen.classList.remove('is-open');
    // 단지 상세(apt-search)까지 들어갔다 닫는 경우엔 계산기 결과로 정리하며 복귀
    // (그렇지 않으면 빈 대시보드/엉킨 화면이 남아 블랭크가 됨)
    if (recoDetailActive) {
      recoDetailActive = false;
      if (window.setAptSearchBackOverride) window.setAptSearchBackOverride(null);
      if (typeof showCalculator === 'function') showCalculator();
      requestAnimationFrame(() => window.restoreResultFloatingSummaryIfResult?.());
    } else {
      requestAnimationFrame(() => window.restoreResultFloatingSummaryIfResult?.());
    }
  }

  function recoSetPrice(v) {
    RecoState.sliderPrice = Math.max(RecoState.floor, Math.min(Number(v), RecoState.ceiling));
    syncSlider();
    render();
  }
  function recoSetPriority(k, el) {
    RecoState.priority = k;
    document.querySelectorAll('#recoPriRow .reco-chip').forEach(c => c.classList.remove('on'));
    if (el) el.classList.add('on');
    const caps = {
      all: '기본 종합순(입지 등급) · 칩을 눌러 정렬 기준을 바꿔보세요',
      school: '가까운 초등학교까지 거리가 짧은 순',
      new: '준공 연식이 최근인 순',
      big: '세대수가 많은 대단지 순',
    };
    const capEl = document.getElementById('recoCap');
    if (capEl) capEl.textContent = caps[k];
    render();
  }
  function recoRender() {
    const sel = document.getElementById('recoRegion');
    if (sel) RecoState.region = sel.value; // 선택한 지역을 상태에 반영(버그 수정)
    render();
  }

  // 카드 탭 → 기존 단지 상세(dashboard-apt-search) 재사용.
  // 단지 상세 UI는 한 곳(dashboard-apt-search)에서만 관리하고,
  // 추천에서 진입했을 때만 "뒤로"를 추천 목록으로 분기한다.
  function recoOpenDetail(kaptCode) {
    recoDetailActive = true;
    if (window.setAptSearchBackOverride) {
      window.setAptSearchBackOverride({
        label: '← 추천 목록으로',
        handler: () => {
          recoDetailActive = false;
          if (typeof showCalculator === 'function') showCalculator();
          requestAnimationFrame(() => {
            document.getElementById('resultFloatingSummary')?.remove();
            const s = document.getElementById('recommendScreen');
            if (s) s.classList.add('is-open');
          });
        },
      });
    }
    // 오버레이만 숨김(상태/스크롤 유지) — closeRecommendScreen은 계산기 복귀 정리를 하므로 여기선 직접 숨김
    const overlay = document.getElementById('recommendScreen');
    if (overlay) overlay.classList.remove('is-open');
    const go = () => {
      if (typeof showAptSearchScreen === 'function') showAptSearchScreen({ skipFocus: true });
      if (typeof pickDashboardApartment === 'function') pickDashboardApartment(kaptCode);
    };
    if (typeof loadDashboardAptSearchIndex === 'function') {
      loadDashboardAptSearchIndex().then(go).catch(go);
    } else {
      setTimeout(go, 0);
    }
  }

  // ── 결과화면 CTA HTML 빌더 (calculator.js가 호출) ──
  function buildRecommendCtaHtml(ctx) {
    const target = Number(ctx.targetPrice) || 0;
    const asset = Number(ctx.asset) || 0;
    const maxLoan = Number(ctx.maxLoan) || 0;
    if (target <= 0) return '';
    const payload = encodeURIComponent(JSON.stringify({
      safeBudget: target, maxBudget: target, eligiblePriceCap: target, targetPrice: target, asset, maxLoan, region: ctx.region || 'all',
    }));
    return `<div class="reco-cta" onclick="openRecommendScreenFromPayload('${payload}')">
      <div class="reco-cta-ico">🏘️</div>
      <div class="reco-cta-copy"><div class="reco-cta-t">이 가격대 단지 둘러보기</div>
      <div class="reco-cta-s">입력한 주택가격 ${target.toFixed(1)}억 이하 · 평균 실거래가 기준</div></div>
      <div class="reco-cta-go">→</div>
    </div>`;
  }
  function openRecommendScreenFromPayload(payload) {
    try { openRecommendScreen(JSON.parse(decodeURIComponent(payload))); }
    catch (e) { openRecommendScreen({}); }
  }

  // 전역 노출
  window.openRecommendScreen = openRecommendScreen;
  window.openRecommendScreenFromPayload = openRecommendScreenFromPayload;
  window.closeRecommendScreen = closeRecommendScreen;
  window.recoSetPrice = recoSetPrice;
  window.recoSetPriority = recoSetPriority;
  window.recoRender = recoRender;
  window.recoOpenDetail = recoOpenDetail;
  window.buildRecommendCtaHtml = buildRecommendCtaHtml;
})();
