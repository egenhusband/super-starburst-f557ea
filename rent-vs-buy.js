/*
 * 월세 vs 매수 계산기
 *
 * 질문: "지금 내는 월세(+ 더 낼 수 있는 돈)로 대출 원리금을 내면, 얼마짜리 집을 살 수 있나?"
 *  - 집값 상승·하락 예측은 넣지 않는다. 월 현금흐름만 비교한다.
 *  - 원리금 중 원금은 '내 집에 쌓이는 돈', 이자는 월세처럼 '나가는 돈'으로 나눠 보여준다.
 *
 * 대출 규칙은 calc-loan.js(정책대출)·calculator.js(시중대출)와 같은 기준을 단순화해 쓴다.
 *  정책: 디딤돌(일반 5억·한도 2억 / 생애최초 2.4억 / 신혼 6억·3.2억), 보금자리(6억·3.6억 / 생애최초 4.2억)
 *  시중: 규제지역 LTV 40%(생애최초 70%), 수도권·규제 고가주택 한도 6/4/2억, DSR 40% + 스트레스 금리
 *  방공제는 디딤돌·시중에 보수적으로 반영, DTI·DSR은 기타 대출이 없다고 가정.
 * 금리는 loan-rates.js(LoanRates)를 그대로 쓴다.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
}(typeof self !== 'undefined' ? self : this, function (root) {
  const LoanRatesApi = root.LoanRates || (typeof require === 'function' ? require('./loan-rates.js') : null);

  const RVB_REGIONS = [
    { key: 'seoul', label: '서울', regulated: true, metro: true, roomManwon: 5500 },
    { key: 'metro_reg', label: '경기 규제지역', hint: '과천·광명·성남·하남·수원·안양·용인 일부·구리·의왕·동탄', regulated: true, metro: true, roomManwon: 4800 },
    { key: 'metro', label: '경기·인천 그 외', regulated: false, metro: true, roomManwon: 4800 },
    { key: 'local', label: '지방', regulated: false, metro: false, roomManwon: 2500 },
  ];
  // 시중 주담대 참고 금리 — 한국은행 예금은행 주담대 신규취급액 가중평균(2026년 9월 4.88%) 반올림
  const RVB_BANK_RATE = 4.9;
  const RVB_YEARS = 30;
  const RVB_DSR_STRESS = { metro: 3.0, local: 0.75 };

  function rvbRegion(key) {
    return RVB_REGIONS.find(r => r.key === key) || RVB_REGIONS[2];
  }

  // 원리금균등 월 상환액(원)
  function rvbMonthlyPayment(principalWon, annualRate, years = RVB_YEARS) {
    if (principalWon <= 0) return 0;
    const r = annualRate / 100 / 12;
    const n = years * 12;
    if (r <= 0) return principalWon / n;
    return principalWon * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }

  // 월 상환액(원)으로 빌릴 수 있는 최대 원금(원)
  function rvbPrincipalFromPayment(paymentWon, annualRate, years = RVB_YEARS) {
    if (paymentWon <= 0) return 0;
    const r = annualRate / 100 / 12;
    const n = years * 12;
    if (r <= 0) return paymentWon * n;
    return paymentWon * (1 - Math.pow(1 + r, -n)) / r;
  }

  // 취득세 + 중개보수 + 등기·이사 (원)
  function rvbPurchaseCostsWon(priceEok, input) {
    const tax = root.RealEstateTax;
    if (tax?.calculateAcquisitionTax && tax?.calculatePurchaseCosts) {
      const acquisition = tax.calculateAcquisitionTax({ priceEok, isFirstHome: Boolean(input.firstHome) }).total;
      return tax.calculatePurchaseCosts({ priceEok, acquisition }).total;
    }
    // tax.js가 없을 때(테스트 등) 근사: 취득세 1~3% + 중개 0.4~0.7% + 150만원
    const rate = priceEok <= 6 ? 0.011 : priceEok <= 9 ? 0.011 + (priceEok - 6) * 0.0067 : 0.033;
    return Math.round(priceEok * 1e8 * (rate + 0.005) + 1500000);
  }

  function rvbProducts(priceEok, input) {
    const region = rvbRegion(input.region);
    const income = Number(input.incomeManwon) || 0;
    const firstHome = Boolean(input.firstHome);
    const newlywed = Boolean(input.newlywed);
    const netAssetEok = ((Number(input.depositManwon) || 0) + (Number(input.savingsManwon) || 0)) / 10000;
    const metroOrReg = region.metro || region.regulated;
    const rates = LoanRatesApi;
    const products = [];

    // 디딤돌
    const dIncomeLimit = newlywed ? 8500 : firstHome ? 7000 : 6000;
    const dPriceLimit = newlywed ? 6 : 5;
    if (income <= dIncomeLimit && priceEok <= dPriceLimit && netAssetEok <= 5.11) {
      const ltv = firstHome ? (metroOrReg ? 0.7 : 0.8) : 0.7;
      const cap = newlywed ? 3.2 : firstHome ? 2.4 : 2.0;
      const rate = rates ? rates.getDidimdolBaseRate(income, newlywed ? '신혼' : '', 30) : 3.8;
      products.push({
        key: 'didimdol', name: '디딤돌 대출', rate,
        maxLoanEok: Math.max(0, Math.min(cap, priceEok * ltv) - region.roomManwon / 10000),
        dtiRatio: 0.6,
      });
    }
    // 보금자리론
    const bIncomeLimit = newlywed ? 8500 : 7000;
    if (income <= bIncomeLimit && priceEok <= 6) {
      const ltv = firstHome ? (metroOrReg ? 0.7 : 0.8) : (region.regulated ? 0.6 : 0.7);
      const cap = firstHome ? 4.2 : 3.6;
      const rate = rates
        ? rates.getBogeumBaseRate(30) + rates.getBogeumRegulationSurcharge(region.regulated ? '규제지역' : '')
        : 5.3;
      products.push({ key: 'bogeum', name: '보금자리론', rate, maxLoanEok: Math.min(cap, priceEok * ltv), dtiRatio: 0.6 });
    }
    // 시중은행
    const bankLtv = region.regulated ? (firstHome ? 0.7 : 0.4) : firstHome ? (region.metro ? 0.7 : 0.8) : 0.7;
    const bankCap = (region.metro || region.regulated) ? (priceEok <= 15 ? 6 : priceEok <= 25 ? 4 : 2) : Infinity;
    products.push({
      key: 'bank', name: '시중은행 주담대', rate: RVB_BANK_RATE,
      maxLoanEok: Math.max(0, Math.min(bankCap, priceEok * bankLtv - region.roomManwon / 10000)),
      dsrRatio: 0.4, stress: region.metro || region.regulated ? RVB_DSR_STRESS.metro : RVB_DSR_STRESS.local,
    });
    return products;
  }

  // 집값 priceEok를 살 때 가장 유리한 방법 (불가능하면 null)
  function rvbEvaluatePrice(priceEok, input) {
    const cashWon = ((Number(input.depositManwon) || 0) + (Number(input.savingsManwon) || 0)) * 10000;
    const budgetWon = ((Number(input.rentManwon) || 0) + (Number(input.extraManwon) || 0)) * 10000;
    const incomeWon = (Number(input.incomeManwon) || 0) * 10000;
    const costsWon = rvbPurchaseCostsWon(priceEok, input);
    const loanNeededWon = Math.max(0, priceEok * 1e8 + costsWon - cashWon);
    let best = null;
    let largestLoanWon = 0;
    rvbProducts(priceEok, input).forEach(product => {
      let maxLoanWon = product.maxLoanEok * 1e8;
      if (product.dtiRatio && incomeWon > 0) {
        maxLoanWon = Math.min(maxLoanWon, rvbPrincipalFromPayment(incomeWon * product.dtiRatio / 12, product.rate));
      }
      if (product.dsrRatio && incomeWon > 0) {
        maxLoanWon = Math.min(maxLoanWon, rvbPrincipalFromPayment(incomeWon * product.dsrRatio / 12, product.rate + product.stress));
      }
      largestLoanWon = Math.max(largestLoanWon, maxLoanWon);
      if (loanNeededWon > maxLoanWon) return;
      const monthlyWon = rvbMonthlyPayment(loanNeededWon, product.rate);
      const option = { product, loanWon: loanNeededWon, monthlyWon, maxLoanWon };
      if (!best || monthlyWon < best.monthlyWon) best = option;
    });
    if (!best) return { priceEok, feasible: false, costsWon, loanNeededWon, cashWon, shortfallWon: loanNeededWon - largestLoanWon };
    const interestWon = best.loanWon * best.product.rate / 100 / 12;
    return {
      priceEok,
      feasible: best.monthlyWon <= budgetWon + 1,
      product: best.product,
      loanWon: best.loanWon,
      monthlyWon: best.monthlyWon,
      firstInterestWon: interestWon,
      firstPrincipalWon: Math.max(0, best.monthlyWon - interestWon),
      costsWon,
      cashWon,
      budgetWon,
    };
  }

  // 같은 월 지출로 살 수 있는 가장 비싼 집 (0.05억 단위)
  function rvbFindMaxPrice(input) {
    let best = null;
    for (let step = 10; step <= 600; step += 1) {
      const priceEok = step * 0.05;
      const result = rvbEvaluatePrice(priceEok, input);
      if (result.feasible) best = result;
    }
    return best;
  }

  function rvbCompute(input) {
    const maxResult = rvbFindMaxPrice(input);
    const target = Number(input.targetPriceEok) > 0 ? rvbEvaluatePrice(Number(input.targetPriceEok), input) : null;
    return { input, maxResult, target };
  }

  // ── 화면 ─────────────────────────────────────────
  const rvbState = { firstHome: true, newlywed: false, region: 'metro' };

  function rvbFormatManwon(won) {
    const manwon = Math.round(won / 10000);
    if (typeof root.AmountInput?.formatManwonKorean === 'function' && manwon >= 10000) return root.AmountInput.formatManwonKorean(manwon);
    return `${manwon.toLocaleString('ko-KR')}만원`;
  }

  function rvbFormatEok(eok) {
    return `${Number(eok).toFixed(2).replace(/\.?0+$/, '')}억`;
  }

  function rvbEsc(text) {
    return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function buildRentVsBuyFormHtml(prefill = {}) {
    const value = key => (prefill[key] ?? '') === '' ? '' : ` value="${rvbEsc(prefill[key])}"`;
    return `
      <div class="rvb-head">
        <div>
          <strong>월세 vs 매수</strong>
          <span>지금 내는 월세로 대출을 갚으면 얼마짜리 집을 살 수 있는지 계산해요</span>
        </div>
        <button type="button" class="rvb-close" onclick="closeRentVsBuy()" aria-label="닫기">×</button>
      </div>
      <div class="rvb-form">
        <label class="rvb-field"><span>지금 내는 월세</span>
          <div class="number-field"><input type="number" id="rvbRent" inputmode="numeric" min="0" placeholder="예: 120" data-amount="manwon"${value('rentManwon')}><span class="number-unit">만원/월</span></div>
        </label>
        <label class="rvb-field"><span>보증금</span>
          <div class="number-field"><input type="number" id="rvbDeposit" inputmode="numeric" min="0" placeholder="예: 5000" data-amount="manwon"${value('depositManwon')}><span class="number-unit">만원</span></div>
        </label>
        <label class="rvb-field"><span>보증금 말고 모은 돈</span>
          <div class="number-field"><input type="number" id="rvbSavings" inputmode="numeric" min="0" placeholder="예: 8000" data-amount="manwon"${value('savingsManwon')}><span class="number-unit">만원</span></div>
        </label>
        <label class="rvb-field"><span>부부 합산 연소득 <small>(세전)</small></span>
          <div class="number-field"><input type="number" id="rvbIncome" inputmode="numeric" min="0" placeholder="예: 7000" data-amount="manwon"${value('incomeManwon')}><span class="number-unit">만원</span></div>
        </label>
        <div class="rvb-field"><span>사려는 지역</span>
          <div class="rvb-chips" id="rvbRegionChips">
            ${RVB_REGIONS.map(r => `<button type="button" data-rvb-region="${r.key}" class="rvb-chip" onclick="setRentVsBuyRegion('${r.key}')"${r.hint ? ` title="${rvbEsc(r.hint)}"` : ''}>${r.label}</button>`).join('')}
          </div>
        </div>
        <div class="rvb-field"><span>해당하면 선택</span>
          <div class="rvb-chips">
            <button type="button" id="rvbFirstHome" class="rvb-chip" onclick="toggleRentVsBuyFlag('firstHome')">생애최초 구입</button>
            <button type="button" id="rvbNewlywed" class="rvb-chip" onclick="toggleRentVsBuyFlag('newlywed')">신혼부부 (7년 이내)</button>
          </div>
        </div>
        <label class="rvb-field"><span>월세보다 더 낼 수 있는 돈 <small>(선택)</small></span>
          <div class="number-field"><input type="number" id="rvbExtra" inputmode="numeric" min="0" placeholder="0" data-amount="manwon"${value('extraManwon')}><span class="number-unit">만원/월</span></div>
        </label>
        <label class="rvb-field"><span>보고 있는 집값 <small>(선택 — 입력하면 그 집 기준 월 납입도 보여줘요)</small></span>
          <div class="number-field"><input type="number" id="rvbTarget" inputmode="numeric" min="0" placeholder="예: 55000" data-amount="manwon"${value('targetManwon')}><span class="number-unit">만원</span></div>
        </label>
        <p class="rvb-error" id="rvbError"></p>
        <button type="button" class="rvb-submit" onclick="runRentVsBuy()">계산하기</button>
      </div>
      <div id="rvbResult" class="rvb-result"></div>`;
  }

  function syncRentVsBuyChips() {
    document.querySelectorAll('[data-rvb-region]').forEach(button => {
      button.classList.toggle('is-selected', button.dataset.rvbRegion === rvbState.region);
    });
    document.getElementById('rvbFirstHome')?.classList.toggle('is-selected', rvbState.firstHome);
    document.getElementById('rvbNewlywed')?.classList.toggle('is-selected', rvbState.newlywed);
  }

  function setRentVsBuyRegion(key) { rvbState.region = key; syncRentVsBuyChips(); }
  function toggleRentVsBuyFlag(key) { rvbState[key] = !rvbState[key]; syncRentVsBuyChips(); }

  function readRentVsBuyInput() {
    const num = id => {
      const raw = document.getElementById(id)?.value;
      return raw === '' || raw == null ? null : Number(raw);
    };
    return {
      rentManwon: num('rvbRent'),
      depositManwon: num('rvbDeposit') || 0,
      savingsManwon: num('rvbSavings') || 0,
      incomeManwon: num('rvbIncome'),
      extraManwon: num('rvbExtra') || 0,
      targetPriceEok: (num('rvbTarget') || 0) / 10000,
      region: rvbState.region,
      firstHome: rvbState.firstHome,
      newlywed: rvbState.newlywed,
    };
  }

  function buildRentVsBuyBreakdownHtml(result, rentWon) {
    const extraWon = Math.max(0, result.monthlyWon - rentWon);
    return `
      <div class="rvb-compare">
        <div class="rvb-compare-row">
          <span>지금 월세</span>
          <strong>${rvbFormatManwon(rentWon)}</strong>
          <em>전부 나가는 돈</em>
        </div>
        <div class="rvb-compare-row is-buy">
          <span>대출 월 납입 <small>(첫 달)</small></span>
          <strong>${rvbFormatManwon(result.monthlyWon)}</strong>
          <em>이자 ${rvbFormatManwon(result.firstInterestWon)} · 원금 ${rvbFormatManwon(result.firstPrincipalWon)}</em>
        </div>
      </div>
      <p class="rvb-note">원금 ${rvbFormatManwon(result.firstPrincipalWon)}은 갚을수록 내 집 지분으로 쌓여요. 그래서 월세와 직접 비교할 돈은 이자 ${rvbFormatManwon(result.firstInterestWon)}이에요${extraWon > 0 ? ` (월세보다 ${rvbFormatManwon(extraWon)} 더 나가요)` : ''}.</p>
      <dl class="rvb-detail">
        <div><dt>대출</dt><dd>${rvbEsc(result.product.name)} ${rvbFormatManwon(result.loanWon)} · 연 ${result.product.rate.toFixed(2)}% · 30년 원리금균등</dd></div>
        <div><dt>필요한 현금</dt><dd>${rvbFormatManwon(result.cashWon)} (취득세·중개보수 등 ${rvbFormatManwon(result.costsWon)} 포함)</dd></div>
      </dl>`;
  }

  function renderRentVsBuyResult(output) {
    const box = document.getElementById('rvbResult');
    if (!box) return;
    const rentWon = (output.input.rentManwon || 0) * 10000;
    const budgetWon = rentWon + (output.input.extraManwon || 0) * 10000;
    const parts = [];
    const max = output.maxResult;
    if (max) {
      parts.push(`
        <section class="rvb-section">
          <span class="rvb-label">월 ${rvbFormatManwon(budgetWon)}로 살 수 있는 집</span>
          <strong class="rvb-amount">최대 약 ${rvbFormatEok(max.priceEok)}</strong>
          ${buildRentVsBuyBreakdownHtml(max, rentWon)}
          <button type="button" class="rvb-map-cta" onclick="openRentVsBuyMap(${max.priceEok})">${rvbFormatEok(max.priceEok)} 이하 단지 지도에서 보기</button>
        </section>`);
    } else {
      parts.push(`
        <section class="rvb-section">
          <span class="rvb-label">월 ${rvbFormatManwon(budgetWon)}로는</span>
          <strong class="rvb-amount is-muted">아직 살 수 있는 집이 없어요</strong>
          <p class="rvb-note">모은 돈이 집값의 30% 안팎과 취득세 등 부대비용을 채워야 대출이 나와요. 월 납입 가능 금액을 늘리거나 모은 돈을 넣어 다시 계산해 보세요.</p>
        </section>`);
    }
    const target = output.target;
    if (target) {
      parts.push(target.product ? `
        <section class="rvb-section">
          <span class="rvb-label">보고 있는 집 ${rvbFormatEok(target.priceEok)}을 사면</span>
          <strong class="rvb-amount is-small">월 ${rvbFormatManwon(target.monthlyWon)}</strong>
          ${buildRentVsBuyBreakdownHtml(target, rentWon)}
        </section>` : `
        <section class="rvb-section">
          <span class="rvb-label">보고 있는 집 ${rvbFormatEok(target.priceEok)}은</span>
          <strong class="rvb-amount is-muted is-small">대출 한도가 모자라요</strong>
          <p class="rvb-note">필요한 대출은 ${rvbFormatManwon(target.loanNeededWon)}인데 받을 수 있는 한도를 넘어요. 현금이 약 ${rvbFormatManwon(target.shortfallWon)} 더 있어야 해요.</p>
        </section>`);
    }
    parts.push('<p class="rvb-disclaimer">집값이 오르거나 내리는 건 반영하지 않았어요. 관리비·재산세, 금리 변동, 방공제 면제 여부에 따라 실제와 달라질 수 있어요.</p>');
    box.innerHTML = parts.join('');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function runRentVsBuy() {
    const input = readRentVsBuyInput();
    const error = document.getElementById('rvbError');
    if (!(input.rentManwon > 0)) { if (error) error.textContent = '지금 내는 월세를 입력해 주세요'; return; }
    if (!(input.incomeManwon > 0)) { if (error) error.textContent = '연소득을 입력해 주세요'; return; }
    if (error) error.textContent = '';
    renderRentVsBuyResult(rvbCompute(input));
  }

  function openRentVsBuy(prefill = {}) {
    closeRentVsBuy(true);
    if (prefill.region) rvbState.region = prefill.region;
    if (typeof prefill.firstHome === 'boolean') rvbState.firstHome = prefill.firstHome;
    if (typeof prefill.newlywed === 'boolean') rvbState.newlywed = prefill.newlywed;
    const overlay = document.createElement('div');
    overlay.className = 'rvb-overlay';
    overlay.id = 'rvbOverlay';
    overlay.innerHTML = `<div class="rvb-sheet" role="dialog" aria-modal="true" aria-label="월세 vs 매수 계산기">${buildRentVsBuyFormHtml(prefill)}</div>`;
    overlay.addEventListener('click', event => { if (event.target === overlay) closeRentVsBuy(); });
    (document.querySelector('.app') || document.body).appendChild(overlay);
    syncRentVsBuyChips();
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeRentVsBuy(immediate) {
    const overlay = document.getElementById('rvbOverlay');
    if (!overlay) return;
    if (immediate === true) { overlay.remove(); return; }
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 300);
  }

  function openRentVsBuyMap(priceEok) {
    closeRentVsBuy(true);
    if (typeof openDashboardMapFromResultCta === 'function') {
      openDashboardMapFromResultCta({ dataset: { mapTargetPrice: String(priceEok) } });
    }
  }

  // 대출 결과 화면에서 열 때: 입력해 둔 소득·자산·지역·가구 조건과 집값을 채운다
  function openRentVsBuyFromResult() {
    const snapshot = typeof getStoredFundInputSnapshot === 'function' ? getStoredFundInputSnapshot() : null;
    const prefill = {};
    if (snapshot) {
      if (snapshot.income) prefill.incomeManwon = Math.round(Number(snapshot.income));
      if (snapshot.price) prefill.targetManwon = Math.round(Number(snapshot.price) * 10000);
      if (snapshot.asset) prefill.savingsManwon = Math.round(Number(snapshot.asset) * 10000);
      prefill.firstHome = snapshot.house === '생애최초';
      prefill.newlywed = snapshot.household === '신혼';
      const province = snapshot.regionSelection?.province;
      prefill.region = snapshot.region === '규제지역' ? (province === 'seoul' ? 'seoul' : 'metro_reg')
        : snapshot.region === '수도권' ? 'metro' : snapshot.region === '지방' ? 'local' : undefined;
    }
    openRentVsBuy(prefill);
  }

  function buildRentVsBuyEntryHtml() {
    return `<button type="button" class="rvb-entry" onclick="openRentVsBuyFromResult()">
      <span><strong>지금 월세 내고 계세요?</strong><small>월세와 이 집의 월 납입을 나란히 비교해 볼 수 있어요</small></span>
    </button>`;
  }

  return {
    RVB_REGIONS,
    rvbMonthlyPayment,
    rvbPrincipalFromPayment,
    rvbEvaluatePrice,
    rvbFindMaxPrice,
    rvbCompute,
    openRentVsBuy,
    closeRentVsBuy,
    runRentVsBuy,
    setRentVsBuyRegion,
    toggleRentVsBuyFlag,
    openRentVsBuyMap,
    openRentVsBuyFromResult,
    buildRentVsBuyEntryHtml,
  };
}));
