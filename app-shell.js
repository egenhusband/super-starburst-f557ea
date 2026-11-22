/*
 * 하단 탭(계산 · 지도 · 내 저장) + 내 저장 화면 + 관심 단지/결과 저장 버튼
 *
 * 화면 전환은 index.html의 showCalculator / showDashboard / showAptSearchScreen을 그대로 쓰고,
 * 탭은 그 위에서 '지금 어느 화면인가'만 읽어 표시한다.
 * 탭이 보이는 곳: 계산기 첫 화면·결과, 지도, 내 저장. 질문 진행 중과 단지 상세에서는 숨긴다.
 */
(function () {
  const TABS = [
    { key: 'calc', label: '계산', emoji: '🧮' },
    { key: 'map', label: '지도', emoji: '🗺️' },
    { key: 'saved', label: '내 저장', emoji: '💾' },
  ];
  let savedOpen = false;

  function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function store() { return window.SavedStore; }
  // dashboard.js의 지도 상태는 최상위 let이라 window에 없다
  function mapState() {
    return typeof dashboardApartmentMapState !== 'undefined' ? dashboardApartmentMapState : null;
  }

  function toast(message) {
    let el = document.getElementById('appShellToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'appShellToast';
      el.className = 'app-shell-toast';
      (document.querySelector('.app') || document.body).appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('is-visible'), 2200);
  }

  // ── 지금 화면 판단 ──
  function currentScreen() {
    const app = document.querySelector('.app');
    if (savedOpen) return 'saved';
    if (app?.classList.contains('screen-apt-search-active')) return 'apt';
    if (app?.classList.contains('screen-dashboard-active') || app?.classList.contains('screen-to-dashboard')) return 'map';
    return 'calc';
  }

  function isCalculatorTopLevel() {
    const slide = document.querySelector('.slide.active');
    if (!slide) return true;
    return slide.dataset.slide === 'intro' || Boolean(slide.querySelector('#resultContent'));
  }

  function shouldShowTabbar() {
    if (document.getElementById('rvbOverlay')) return false;
    const screen = currentScreen();
    if (screen === 'apt') return false;
    if (screen === 'calc') return isCalculatorTopLevel();
    return true;
  }

  function syncTabbar() {
    const app = document.querySelector('.app');
    const bar = document.getElementById('appTabbar');
    if (!app || !bar) return;
    const visible = shouldShowTabbar();
    const wasVisible = app.classList.contains('has-tabbar');
    app.classList.toggle('has-tabbar', visible);
    const active = currentScreen() === 'apt' ? 'map' : currentScreen();
    bar.querySelectorAll('[data-tab]').forEach(button => {
      const on = button.dataset.tab === active;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-current', on ? 'page' : 'false');
    });
    const count = (store()?.list('apartment').length || 0) + (store()?.list('calculation').length || 0);
    const badge = bar.querySelector('[data-tab="saved"] .app-tab-count');
    if (badge) { badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !count; }
    // 지도 크기가 바뀌면 카카오맵에 알려야 타일이 맞게 그려진다
    if (wasVisible !== visible) {
      setTimeout(() => { try { mapState()?.map?.relayout?.(); } catch (_) {} }, 60);
    }
  }

  function goTab(key) {
    if (key === 'saved') { openSaved(); return; }
    closeSaved();
    if (key === 'map') {
      if (typeof showDashboard === 'function') showDashboard();
    } else if (typeof showCalculator === 'function') {
      showCalculator();
    }
    setTimeout(syncTabbar, 30);
  }

  function buildTabbar() {
    if (document.getElementById('appTabbar')) return;
    const bar = document.createElement('nav');
    bar.id = 'appTabbar';
    bar.className = 'app-tabbar';
    bar.setAttribute('aria-label', '주요 메뉴');
    bar.innerHTML = TABS.map(tab => `
      <button type="button" data-tab="${tab.key}" onclick="goAppTab('${tab.key}')">
        <span class="app-tab-emoji" aria-hidden="true">${tab.emoji}</span>
        <span>${tab.label}</span>
        ${tab.key === 'saved' ? '<b class="app-tab-count" hidden></b>' : ''}
      </button>`).join('');
    (document.querySelector('.app') || document.body).appendChild(bar);
  }

  // ── 관심 단지 ──
  function favoritePayload(item) {
    const location = item.displayLocation || [item.sigunguName, item.umdName].filter(Boolean).join(' ');
    return {
      kaptCode: item.kaptCode || item.id,
      aptName: item.aptName || '',
      location,
      region: item.regionLabel || '',
      grade: item.gradeWithheld ? '' : (item.grade || ''),
      households: Number(item.householdCount) || null,
      lat: Number(item.lat) || null,
      lng: Number(item.lng) || null,
    };
  }

  function buildFavoriteButtonHtml(item, variant = '') {
    const key = item?.kaptCode || item?.id;
    if (!key || !store()) return '';
    const on = store().has('apartment', key);
    const payload = esc(JSON.stringify(favoritePayload(item)));
    return `<button type="button" class="fav-btn ${variant}${on ? ' is-on' : ''}" data-fav-key="${esc(key)}" data-fav-payload="${payload}"
      onclick="event.stopPropagation(); toggleFavoriteApartment(this)" aria-pressed="${on}" aria-label="관심 단지${on ? ' 해제' : '로 저장'}">
      <span aria-hidden="true">${on ? '❤️' : '🤍'}</span><em>${on ? '관심 단지' : '관심'}</em></button>`;
  }

  function toggleFavoriteApartment(button) {
    const key = button?.dataset.favKey;
    if (!key) return;
    let payload = {};
    try { payload = JSON.parse(button.dataset.favPayload || '{}'); } catch (_) {}
    const on = store().toggle('apartment', key, payload);
    toast(on ? `관심 단지에 담았어요${store().getAccount() ? '' : ' · 내 저장에서 볼 수 있어요'}` : '관심 단지에서 뺐어요');
  }

  function syncFavoriteButtons() {
    document.querySelectorAll('[data-fav-key]').forEach(button => {
      const on = store().has('apartment', button.dataset.favKey);
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
      const emoji = button.querySelector('span');
      const label = button.querySelector('em');
      if (emoji) emoji.textContent = on ? '❤️' : '🤍';
      if (label) label.textContent = on ? '관심 단지' : '관심';
    });
  }

  // ── 계산 결과 저장 ──
  function saveCalculation(type, inputPayload, summary) {
    if (!store() || !inputPayload) return;
    const key = `${type}-${Date.now().toString(36)}`;
    store().upsert('calculation', key, { calculatorType: type, inputPayload, summary, savedAt: new Date().toISOString() });
    toast('저장했어요 · 내 저장에서 다시 열 수 있어요');
  }

  function saveCurrentFundResult() {
    const input = typeof getStoredFundInputSnapshot === 'function' ? getStoredFundInputSnapshot() : null;
    if (!input) { toast('저장할 결과가 없어요'); return; }
    const root = document.getElementById('resultContent');
    const product = root?.querySelector('.result-title')?.textContent?.trim() || '정책대출';
    const amount = root?.querySelector('.result-conclusion-amount')?.textContent?.trim() || '';
    const price = Number(input.price) > 0 ? `${Number(input.price)}억 집` : '';
    saveCalculation('fund', input, {
      title: [price, product].filter(Boolean).join(' · '),
      line: amount ? `예상 한도 ${amount}` : '정책대출 결과',
    });
  }

  function saveCurrentBankResult() {
    const input = typeof collectBankCalculation === 'function' ? collectBankCalculation() : null;
    if (!input?.price) { toast('저장할 결과가 없어요'); return; }
    const eok = value => `${Number(value).toFixed(2).replace(/\.?0+$/, '')}억`;
    saveCalculation('bank', input, {
      title: `${eok(input.price)} 집 · 시중은행`,
      line: `대출 ${eok(input.loan)} · ${input.years || 30}년`,
    });
  }

  function buildSaveResultButtonHtml(handler) {
    return `<button type="button" class="save-result-btn" onclick="${handler}()"><span aria-hidden="true">💾</span> 이 결과 저장하기</button>`;
  }

  function openSavedCalculation(key) {
    const item = store()?.get('calculation', key);
    if (!item) return;
    const { calculatorType, inputPayload } = item.payload || {};
    closeSaved();
    if (typeof showCalculator === 'function') showCalculator();
    setTimeout(() => {
      if (calculatorType === 'fund' && typeof restoreFundCalculation === 'function') restoreFundCalculation(inputPayload);
      else if (calculatorType === 'bank' && typeof restoreBankCalculation === 'function') restoreBankCalculation(inputPayload);
      else if (calculatorType === 'rvb' && typeof openRentVsBuySaved === 'function') openRentVsBuySaved(inputPayload);
      syncTabbar();
    }, 80);
  }

  // ── 내 저장 화면 ──
  function ensureSavedScreen() {
    let screen = document.getElementById('savedScreen');
    if (!screen) {
      screen = document.createElement('section');
      screen.id = 'savedScreen';
      screen.className = 'saved-screen';
      screen.setAttribute('aria-label', '내 저장');
      (document.querySelector('.app') || document.body).appendChild(screen);
    }
    return screen;
  }

  function openSaved() {
    savedOpen = true;
    renderSaved();
    ensureSavedScreen().classList.add('is-open');
    document.getElementById('resultFloatingSummary')?.setAttribute('hidden', '');
    syncTabbar();
    store()?.syncNow?.().catch(() => {});
  }

  function closeSaved() {
    if (!savedOpen) return;
    savedOpen = false;
    document.getElementById('savedScreen')?.classList.remove('is-open');
    document.getElementById('resultFloatingSummary')?.removeAttribute('hidden');
    syncTabbar();
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }

  function accountCardHtml() {
    const account = store().getAccount();
    if (!account) {
      return `
        <div class="saved-account">
          <div><strong>카카오로 연결하면</strong><span>휴대폰을 바꿔도 저장한 단지와 계산이 그대로 남아요</span></div>
          <button type="button" class="saved-kakao-btn" onclick="connectSavedKakao(this)">카카오로 연결</button>
        </div>`;
    }
    return `
      <div class="saved-account is-linked">
        <div><strong>${esc(account.nickname)} 님</strong><span>${esc(store().getSyncStatus())}</span></div>
        <button type="button" class="saved-text-btn" onclick="disconnectSavedKakao()">연결 해제</button>
      </div>`;
  }

  function apartmentRowsHtml() {
    const items = store().list('apartment');
    if (!items.length) {
      return `<div class="saved-empty"><span aria-hidden="true">🏘️</span><p>지도나 단지 상세에서 🤍를 누르면 여기 모여요</p><button type="button" class="saved-text-btn" onclick="goAppTab('map')">지도에서 단지 보기</button></div>`;
    }
    return items.map(item => {
      const p = item.payload || {};
      const meta = [p.location, p.grade ? `${p.grade}등급` : '', p.households ? `${Number(p.households).toLocaleString()}세대` : ''].filter(Boolean).join(' · ');
      return `
        <div class="saved-row">
          <button type="button" class="saved-row-main" onclick="openSavedApartment('${esc(item.key)}')">
            <strong>${esc(p.aptName || '단지')}</strong><span>${esc(meta)}</span>
          </button>
          <button type="button" class="saved-row-remove" onclick="removeSavedItem('apartment','${esc(item.key)}')" aria-label="${esc(p.aptName)} 관심 해제">❤️</button>
        </div>`;
    }).join('');
  }

  function calculationRowsHtml() {
    const items = store().list('calculation');
    if (!items.length) {
      return `<div class="saved-empty"><span aria-hidden="true">🧮</span><p>대출 결과 화면에서 '이 결과 저장하기'를 누르면 여기 모여요</p><button type="button" class="saved-text-btn" onclick="goAppTab('calc')">대출 계산하러 가기</button></div>`;
    }
    const emoji = { fund: '🏛️', bank: '🏦', rvb: '🏠' };
    return items.map(item => {
      const p = item.payload || {};
      return `
        <div class="saved-row">
          <button type="button" class="saved-row-main" onclick="openSavedCalculation('${esc(item.key)}')">
            <strong><span class="saved-row-emoji" aria-hidden="true">${emoji[p.calculatorType] || '🧮'}</span>${esc(p.summary?.title || '저장한 계산')}</strong>
            <span>${esc(p.summary?.line || '')}${p.savedAt ? ` · ${formatDate(p.savedAt)} 저장` : ''}</span>
          </button>
          <button type="button" class="saved-row-remove is-x" onclick="removeSavedItem('calculation','${esc(item.key)}')" aria-label="저장한 계산 삭제">×</button>
        </div>`;
    }).join('');
  }

  function commuteHtml() {
    const filters = mapState()?.filters;
    const label = typeof getMapCommuteLabel === 'function' && filters?.commuteDest ? getMapCommuteLabel(filters) : '';
    if (!label) {
      return `<div class="saved-empty is-inline"><span aria-hidden="true">🚇</span><p>지도에서 출퇴근을 설정하면 저장돼요</p></div>`;
    }
    return `
      <div class="saved-row">
        <button type="button" class="saved-row-main" onclick="goAppTab('map'); setTimeout(() => window.openDashboardMapCommuteFilter?.(), 700)">
          <strong><span class="saved-row-emoji" aria-hidden="true">🚇</span>${esc(label)}</strong><span>지도에서 이 출근지 기준으로 시간을 보여줘요</span>
        </button>
      </div>`;
  }

  function renderSaved() {
    if (!store()) return;
    const screen = ensureSavedScreen();
    const scroll = screen.querySelector('.saved-body')?.scrollTop || 0;
    screen.innerHTML = `
      <div class="saved-body">
        <h1 class="saved-title">내 저장</h1>
        ${accountCardHtml()}
        <section class="saved-section">
          <h2>관심 단지 <b>${store().list('apartment').length || ''}</b></h2>
          ${apartmentRowsHtml()}
        </section>
        <section class="saved-section">
          <h2>저장한 계산 <b>${store().list('calculation').length || ''}</b></h2>
          ${calculationRowsHtml()}
        </section>
        <section class="saved-section">
          <h2>출근지</h2>
          ${commuteHtml()}
        </section>
      </div>`;
    const body = screen.querySelector('.saved-body');
    if (body) body.scrollTop = scroll;
  }

  async function connectSavedKakao(button) {
    if (button) { button.disabled = true; button.textContent = '연결 중'; }
    try {
      await store().connectKakao();
      toast('카카오 계정에 연결했어요');
    } catch (error) {
      toast(error?.message || '카카오 연결을 완료하지 못했어요');
    } finally {
      renderSaved();
    }
  }

  function disconnectSavedKakao() {
    store().disconnectKakao();
    toast('연결을 해제했어요. 이 기기에 저장된 항목은 그대로 있어요');
  }

  function removeSavedItem(kind, key) { store().remove(kind, key); }

  function openSavedApartment(kaptCode) {
    closeSaved();
    if (typeof showDashboard === 'function') showDashboard();
    setTimeout(() => {
      if (typeof openDashboardMapApartmentDetail === 'function') openDashboardMapApartmentDetail(kaptCode);
      setTimeout(syncTabbar, 600);
    }, 620);
  }

  // ── 시작 ──
  function init() {
    buildTabbar();
    const app = document.querySelector('.app');
    if (app) new MutationObserver(syncTabbar).observe(app, { attributes: true, attributeFilter: ['class'], childList: true });
    document.querySelectorAll('.slide').forEach(slide => {
      new MutationObserver(syncTabbar).observe(slide, { attributes: true, attributeFilter: ['class'] });
    });
    window.addEventListener('saved-items-changed', () => {
      syncFavoriteButtons();
      if (savedOpen) renderSaved();
      syncTabbar();
    });
    syncTabbar();
  }

  Object.assign(window, {
    goAppTab: goTab,
    syncAppTabbar: syncTabbar,
    buildFavoriteButtonHtml,
    toggleFavoriteApartment,
    buildSaveResultButtonHtml,
    saveCurrentFundResult,
    saveCurrentBankResult,
    saveCalculation,
    openSavedCalculation,
    openSavedApartment,
    removeSavedItem,
    connectSavedKakao,
    disconnectSavedKakao,
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
