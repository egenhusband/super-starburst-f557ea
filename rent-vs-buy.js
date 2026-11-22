/*
 * 월세 vs 매수 계산기
 *
 * 질문: "지금 내는 월세(+ 더 낼 수 있는 돈)로 대출 원리금을 내면, 얼마짜리 집을 살 수 있나?"
 *  - 40년 만기 원리금균등 기준. 집값 상승·하락 예측은 넣지 않는다. 월 현금흐름만 비교한다.
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
  // 시중 주담대 금리 — 5대 은행 혼합형(5년 고정) 2026년 9월 연 4.89~7.29%.
  // 우대금리를 일부 받은 일반 차주 기준으로 중간보다 조금 낮은 5.6%를 쓴다. 보금자리론(40년 5.35%)보다 높게 나오는 게 현실에 가깝다.
  const RVB_BANK_RATE = 5.6;
  // 실제로 많이 고르는 40년 만기 기준 (보금자리 40년은 만 39세 이하·신혼, 디딤돌 40년은 청년·신혼 대상)
  const RVB_YEARS = 40;
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
      const rate = rates ? rates.getDidimdolBaseRate(income, newlywed ? '신혼' : '', RVB_YEARS) : 3.8; // 40년은 30년 금리표 적용
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
        ? rates.getBogeumBaseRate(RVB_YEARS) + rates.getBogeumRegulationSurcharge(region.regulated ? '규제지역' : '')
        : 5.35;
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
  // 메인 계산기와 같은 방식: 한 화면에 질문 하나(3개) → 결과. 지역·조건·추가 납입은 결과에서 바로 바꾼다.
  const RVB_STEPS = [
    { key: 'rentManwon', title: '지금 월세가\n얼마예요?', sub: '관리비는 빼고 월세만 적어주세요', unit: '만원/월', placeholder: '예: 120' },
    { key: 'cashManwon', title: '집 사는 데 쓸 수 있는\n돈은 얼마예요?', sub: '돌려받을 보증금까지 합쳐서 적어주세요', unit: '만원', placeholder: '예: 13000' },
    { key: 'incomeManwon', title: '연소득은\n얼마예요?', sub: '세전 기준, 부부라면 합산 소득이에요', unit: '만원', placeholder: '예: 7000' },
  ];
  const rvbState = {
    step: 0,
    askSteps: [0, 1, 2],
    values: { rentManwon: null, cashManwon: null, incomeManwon: null },
    region: 'metro', firstHome: true, newlywed: false, extraManwon: 0, targetManwon: null,
  };

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

  function rvbInput() {
    return {
      rentManwon: Number(rvbState.values.rentManwon) || 0,
      depositManwon: 0,
      savingsManwon: Number(rvbState.values.cashManwon) || 0,
      incomeManwon: Number(rvbState.values.incomeManwon) || 0,
      extraManwon: rvbState.extraManwon,
      targetPriceEok: (Number(rvbState.targetManwon) || 0) / 10000,
      region: rvbState.region,
      firstHome: rvbState.firstHome,
      newlywed: rvbState.newlywed,
    };
  }

  function rvbSheet() { return document.querySelector('#rvbOverlay .rvb-sheet'); }

  function renderRentVsBuyStep() {
    const sheet = rvbSheet();
    if (!sheet) return;
    const step = RVB_STEPS[rvbState.step];
    const value = rvbState.values[step.key];
    sheet.innerHTML = `
      <div class="rvb-top">
        <button type="button" class="rvb-icon-btn" onclick="${rvbState.askSteps.indexOf(rvbState.step) <= 0 ? 'closeRentVsBuy()' : 'rentVsBuyBack()'}" aria-label="${rvbState.askSteps.indexOf(rvbState.step) <= 0 ? '닫기' : '이전'}">${rvbState.askSteps.indexOf(rvbState.step) <= 0 ? '×' : '‹'}</button>
        <span class="rvb-progress">${rvbState.askSteps.indexOf(rvbState.step) + 1} / ${rvbState.askSteps.length}</span>
      </div>
      <div class="rvb-step">
        <h2 class="rvb-question">${rvbEsc(step.title).replace('\n', '<br>')}</h2>
        <p class="rvb-sub">${rvbEsc(step.sub)}</p>
        <div class="number-field rvb-number">
          <input type="number" id="rvbStepInput" inputmode="numeric" min="0" placeholder="${step.placeholder}" data-amount="manwon"${value != null ? ` value="${value}"` : ''}
            oninput="rentVsBuyStepInput(this.value)" onkeydown="if(event.key==='Enter'){rentVsBuyNext()}">
          <span class="number-unit">${step.unit}</span>
        </div>
      </div>
      <button type="button" class="rvb-next" id="rvbNext" onclick="rentVsBuyNext()"${value > 0 ? '' : ' disabled'}>${rvbState.step === rvbState.askSteps[rvbState.askSteps.length - 1] ? '결과 보기' : '다음'}</button>`;
    setTimeout(() => document.getElementById('rvbStepInput')?.focus(), 250);
  }

  function rentVsBuyStepInput(raw) {
    const step = RVB_STEPS[rvbState.step];
    rvbState.values[step.key] = raw === '' ? null : Number(raw);
    const next = document.getElementById('rvbNext');
    if (next) next.disabled = !(Number(raw) > 0);
  }

  function rentVsBuyNext() {
    const step = RVB_STEPS[rvbState.step];
    if (!(Number(rvbState.values[step.key]) > 0)) return;
    const position = rvbState.askSteps.indexOf(rvbState.step);
    const next = rvbState.askSteps[position + 1];
    if (next == null) { renderRentVsBuyResult(); return; }
    rvbState.step = next;
    renderRentVsBuyStep();
  }

  function rentVsBuyBack() {
    const position = rvbState.askSteps.indexOf(rvbState.step);
    rvbState.step = rvbState.askSteps[Math.max(0, position - 1)];
    renderRentVsBuyStep();
  }

  function rvbBarsHtml(result, rentWon) {
    const maxWon = Math.max(rentWon, result.monthlyWon, 1);
    const pct = won => `${Math.max(0, Math.min(100, won / maxWon * 100)).toFixed(1)}%`;
    return `
      <div class="rvb-bars">
        <div class="rvb-bar-row">
          <div class="rvb-bar-label"><span>월세</span><strong>${rvbFormatManwon(rentWon)}</strong></div>
          <div class="rvb-bar"><i class="is-gone" style="width:${pct(rentWon)}"></i></div>
          <small>전부 나가는 돈</small>
        </div>
        <div class="rvb-bar-row">
          <div class="rvb-bar-label"><span>대출 갚기</span><strong>${rvbFormatManwon(result.monthlyWon)}</strong></div>
          <div class="rvb-bar"><i class="is-gone" style="width:${pct(result.firstInterestWon)}"></i><i class="is-kept" style="width:${pct(result.firstPrincipalWon)}"></i></div>
          <small>이자 ${rvbFormatManwon(result.firstInterestWon)}는 나가고, <b>원금 ${rvbFormatManwon(result.firstPrincipalWon)}은 내 집에 쌓여요</b></small>
        </div>
      </div>`;
  }

  function rvbTargetHtml(output, rentWon) {
    const target = output.target;
    const field = `
      <div class="number-field rvb-number is-compact">
        <input type="number" id="rvbTargetInput" inputmode="numeric" min="0" placeholder="보고 있는 집값 (예: 55000)" data-amount="manwon"${rvbState.targetManwon ? ` value="${rvbState.targetManwon}"` : ''} onchange="setRentVsBuyTarget(this.value)" onkeydown="if(event.key==='Enter'){setRentVsBuyTarget(this.value)}">
        <span class="number-unit">만원</span>
      </div>`;
    if (!target) return `<details class="rvb-more"><summary>보고 있는 집이 있어요</summary>${field}</details>`;
    const body = target.product
      ? `<p class="rvb-target-line">${rvbFormatEok(target.priceEok)} 집이면 매달 <strong>${rvbFormatManwon(target.monthlyWon)}</strong> 갚아요 (월세보다 ${target.monthlyWon >= rentWon ? `${rvbFormatManwon(target.monthlyWon - rentWon)} 더` : `${rvbFormatManwon(rentWon - target.monthlyWon)} 덜`})</p>${rvbBarsHtml(target, rentWon)}`
      : `<p class="rvb-target-line">${rvbFormatEok(target.priceEok)} 집은 대출 한도가 모자라요. 현금이 약 <strong>${rvbFormatManwon(target.shortfallWon)}</strong> 더 있어야 해요.</p>`;
    return `<details class="rvb-more" open><summary>보고 있는 집이 있어요</summary>${field}${body}</details>`;
  }

  // 못 사는 이유가 현금인지 월 납입인지 구분해서 알려준다
  function rvbInfeasibleHtml(input) {
    for (let extra = (input.extraManwon || 0) + 10; extra <= 300; extra += 10) {
      const found = rvbFindMaxPrice({ ...input, extraManwon: extra });
      if (found) {
        const more = extra - (input.extraManwon || 0);
        return `<p class="rvb-sub">한 달에 <strong>${more}만원</strong>을 더 낼 수 있다면 <strong>${rvbFormatEok(found.priceEok)}</strong> 집부터 가능해요. 아래에서 바꿔볼 수 있어요.</p>`;
      }
    }
    return `<p class="rvb-sub">지금은 월 납입보다 <strong>현금</strong>이 모자라요. 대출은 집값의 70% 안팎까지라, 나머지와 취득세 같은 부대비용은 쓸 수 있는 돈으로 채워야 해요.</p>`;
  }

  function renderRentVsBuyResult() {
    const sheet = rvbSheet();
    if (!sheet) return;
    const input = rvbInput();
    const output = rvbCompute(input);
    const rentWon = input.rentManwon * 10000;
    const max = output.maxResult;
    const budgetText = rvbState.extraManwon > 0 ? `월 ${rvbFormatManwon((input.rentManwon + rvbState.extraManwon) * 10000)}` : `월세 ${rvbFormatManwon(rentWon)}`;
    const headline = max
      ? `<h2 class="rvb-question">${budgetText}이면<br><em>${rvbFormatEok(max.priceEok)}</em> 집을 살 수 있어요</h2>`
      : `<h2 class="rvb-question">${budgetText}로는<br>아직 살 수 있는 집이 없어요</h2>`;
    const body = max ? `
        ${rvbBarsHtml(max, rentWon)}
        <p class="rvb-loan-line">${rvbEsc(max.product.name)} ${rvbFormatManwon(max.loanWon)} · 연 ${max.product.rate.toFixed(2)}% · ${RVB_YEARS}년</p>
        <p class="rvb-loan-line is-sub">쓸 수 있는 돈 ${rvbFormatManwon(max.cashWon)}에서 취득세·중개보수 등 ${rvbFormatManwon(max.costsWon)}이 먼저 나가요</p>
        <button type="button" class="rvb-next" onclick="openRentVsBuyMap(${max.priceEok})">${rvbFormatEok(max.priceEok)} 이하 단지 지도에서 보기</button>`
      : rvbInfeasibleHtml(input);
    sheet.innerHTML = `
      <div class="rvb-top">
        <button type="button" class="rvb-icon-btn" onclick="closeRentVsBuy()" aria-label="닫기">×</button>
        <button type="button" class="rvb-text-btn" onclick="restartRentVsBuy()">처음부터</button>
      </div>
      <div class="rvb-step">
        ${headline}
        ${body}
      </div>
      <div class="rvb-adjust">
        <div class="rvb-adjust-head">조건 바꿔보기</div>
        <div class="rvb-slider">
          <div><span>한 달에 더 낼 수 있다면</span><strong id="rvbExtraValue">${rvbState.extraManwon > 0 ? `+${rvbState.extraManwon}만원` : '지금 월세만큼'}</strong></div>
          <input type="range" min="0" max="150" step="10" value="${rvbState.extraManwon}" oninput="setRentVsBuyExtra(this.value)" aria-label="한 달에 더 낼 수 있는 돈">
        </div>
        <div class="rvb-chips">
          ${RVB_REGIONS.map(r => `<button type="button" class="rvb-chip${r.key === rvbState.region ? ' is-selected' : ''}" onclick="setRentVsBuyRegion('${r.key}')"${r.hint ? ` title="${rvbEsc(r.hint)}"` : ''}>${r.label}</button>`).join('')}
        </div>
        <div class="rvb-chips">
          <button type="button" class="rvb-chip${rvbState.firstHome ? ' is-selected' : ''}" onclick="toggleRentVsBuyFlag('firstHome')">생애최초 구입</button>
          <button type="button" class="rvb-chip${rvbState.newlywed ? ' is-selected' : ''}" onclick="toggleRentVsBuyFlag('newlywed')">신혼부부</button>
        </div>
        ${rvbTargetHtml(output, rentWon)}
      </div>
      <p class="rvb-disclaimer">집값이 오르거나 내리는 건 넣지 않았어요. 관리비·재산세, 금리 변동, 방공제 면제 여부에 따라 실제와 달라질 수 있어요.</p>`;
  }

  // 슬라이더는 끌 때마다 화면 전체를 다시 그리지 않고, 손을 뗀 뒤 한 번만 다시 계산한다
  let rvbExtraTimer = null;
  function setRentVsBuyExtra(value) {
    rvbState.extraManwon = Number(value) || 0;
    const label = document.getElementById('rvbExtraValue');
    if (label) label.textContent = rvbState.extraManwon > 0 ? `+${rvbState.extraManwon}만원` : '지금 월세만큼';
    clearTimeout(rvbExtraTimer);
    rvbExtraTimer = setTimeout(() => {
      const sheet = rvbSheet();
      const scrollTop = sheet?.scrollTop || 0;
      renderRentVsBuyResult();
      if (sheet) sheet.scrollTop = scrollTop;
    }, 180);
  }

  function rerenderKeepScroll() {
    const sheet = rvbSheet();
    const scrollTop = sheet?.scrollTop || 0;
    renderRentVsBuyResult();
    if (sheet) sheet.scrollTop = scrollTop;
  }
  function setRentVsBuyRegion(key) { rvbState.region = key; rerenderKeepScroll(); }
  function toggleRentVsBuyFlag(key) { rvbState[key] = !rvbState[key]; rerenderKeepScroll(); }
  function setRentVsBuyTarget(value) { rvbState.targetManwon = Number(value) > 0 ? Number(value) : null; rerenderKeepScroll(); }

  function restartRentVsBuy() {
    rvbState.values = { rentManwon: null, cashManwon: null, incomeManwon: null };
    rvbState.extraManwon = 0;
    rvbState.targetManwon = null;
    rvbState.askSteps = RVB_STEPS.map((_, index) => index);
    rvbState.step = 0;
    renderRentVsBuyStep();
  }

  function openRentVsBuy(prefill = {}) {
    closeRentVsBuy(true);
    rvbState.values = {
      rentManwon: null,
      cashManwon: prefill.cashManwon || null,
      incomeManwon: prefill.incomeManwon || null,
    };
    rvbState.extraManwon = 0;
    rvbState.targetManwon = prefill.targetManwon || null;
    if (prefill.region) rvbState.region = prefill.region;
    if (typeof prefill.firstHome === 'boolean') rvbState.firstHome = prefill.firstHome;
    if (typeof prefill.newlywed === 'boolean') rvbState.newlywed = prefill.newlywed;
    // 이미 아는 값(대출 결과에서 넘어온 소득·자산)은 다시 묻지 않는다
    rvbState.askSteps = RVB_STEPS.map((_, index) => index).filter(index => index === 0 || !(Number(rvbState.values[RVB_STEPS[index].key]) > 0));
    rvbState.step = 0;
    const overlay = document.createElement('div');
    overlay.className = 'rvb-overlay';
    overlay.id = 'rvbOverlay';
    overlay.innerHTML = '<div class="rvb-sheet" role="dialog" aria-modal="true" aria-label="월세 vs 매수 계산기"></div>';
    (document.querySelector('.app') || document.body).appendChild(overlay);
    renderRentVsBuyStep();
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

  // 대출 결과 화면에서 열 때: 이미 입력한 소득·자산·지역·가구 조건과 집값을 채우고 월세만 묻는다
  function openRentVsBuyFromResult() {
    const snapshot = typeof getStoredFundInputSnapshot === 'function' ? getStoredFundInputSnapshot() : null;
    const prefill = {};
    if (snapshot) {
      if (Number(snapshot.income) > 0) prefill.incomeManwon = Math.round(Number(snapshot.income));
      if (Number(snapshot.price) > 0) prefill.targetManwon = Math.round(Number(snapshot.price) * 10000);
      if (Number(snapshot.asset) > 0) prefill.cashManwon = Math.round(Number(snapshot.asset) * 10000);
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
    rentVsBuyStepInput,
    rentVsBuyNext,
    rentVsBuyBack,
    restartRentVsBuy,
    setRentVsBuyExtra,
    setRentVsBuyTarget,
    setRentVsBuyRegion,
    toggleRentVsBuyFlag,
    openRentVsBuyMap,
    openRentVsBuyFromResult,
    buildRentVsBuyEntryHtml,
  };
}));
