  const TOTAL = 8;
  let current = 0;      // 0 = intro, 1~7 = 기금대출 슬라이드
  let loanType = null;  // 'fund' | 'bank'
  const answers = { household: null, house: null, children: null, region: null };

  function haptic(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 8);
  }

  document.querySelectorAll('.option-card').forEach(card => {
    card.addEventListener('click', () => {
      haptic(8);
      const group = card.dataset.group;
      document.querySelectorAll(`[data-group="${group}"]`).forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      answers[group] = card.dataset.val;
      updateNextBtn();
    });
  });

  ['income','price','asset','otherLoanPrincipal','otherLoanRate','otherLoanYears'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateNextBtn);
  });

  function canProceed() {
    if (current === 0) return !!loanType;
    if (current === 1) return !!answers.household;
    if (current === 2) return !!answers.house;
    if (current === 3) return !!answers.children;
    if (current === 4) return !!answers.region;
    if (current === 5) return document.getElementById('income').value !== '';
    if (current === 6) return document.getElementById('price').value !== '';
    if (current === 7) return document.getElementById('asset').value !== '';
    if (current === 8) {
      const noneChecked = document.getElementById('otherLoanNone')?.checked;
      const principal   = document.getElementById('otherLoanPrincipal')?.value;
      const rate        = document.getElementById('otherLoanRate')?.value;
      const years       = document.getElementById('otherLoanYears')?.value;
      return noneChecked || (principal !== '' && rate !== '' && years !== '');
    }
    return true;
  }

  function updateNextBtn() {
    document.getElementById('btnNext').disabled = !canProceed();
  }

  function setProgress(step) {
    const step2 = step > 0 ? step - 1 : 0;  // intro 제외
    const pct = step2 >= TOTAL ? 100 : Math.round((step2 / TOTAL) * 100);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressLabel').textContent = step2 < TOTAL && step > 0 ? `${step2 + 1} / ${TOTAL}` : (step >= TOTAL + 1 ? '완료' : '');
  }

  function goNext() {
    // intro 슬라이드: 선택에 따라 분기
    if (current === 0) {
      if (loanType === 'bank') {
        showBankLoanScreen();
        return;
      }
      // 기금대출: 다음 슬라이드(slide 1)로
      navigateTo(1, 'forward');
      return;
    }
    if (current === 8) {
      const income = parseFloat(document.getElementById('income').value);
      const price  = parseFloat(document.getElementById('price').value);
      const asset  = parseFloat(document.getElementById('asset').value);
      if (isNaN(income) || income < 0) { document.getElementById('incomeErr').textContent = '올바른 소득을 입력해주세요'; return; }
      if (isNaN(price)  || price  < 0) { document.getElementById('priceErr').textContent  = '올바른 금액을 입력해주세요'; return; }
      if (isNaN(asset)  || asset  < 0) { document.getElementById('assetErr').textContent  = '올바른 금액을 입력해주세요'; return; }
      const noneChecked = document.getElementById('otherLoanNone')?.checked;
      let otherLoanInterest = 0;
      if (!noneChecked) {
        const principal = parseFloat(document.getElementById('otherLoanPrincipal').value) || 0;
        const rate      = parseFloat(document.getElementById('otherLoanRate').value) || 0;
        const yrs       = parseFloat(document.getElementById('otherLoanYears').value) || 0;
        if (principal > 0 && rate > 0 && yrs > 0) {
          // 원리금균등 월납입 계산 후 연간 이자 추출
          const P = principal * 100000000;
          const r = rate / 12 / 100;
          const n = yrs * 12;
          const monthly = (P * r * Math.pow(1+r,n)) / (Math.pow(1+r,n) - 1);
          // 연간 원리금 - 연간 원금상환 = 연간 이자
          const annualPayment     = monthly * 12;
          const annualPrincipalRep = P / n * 12; // 원금균등 근사
          // 원리금균등 기준 연간 이자 = 총납입 - 원금 (1년치 근사)
          const annualInterestWon = annualPayment - (P / n * 12);
          otherLoanInterest = Math.round(annualInterestWon / 10000); // 만원 단위
        }
      }
      renderResult(income, price, asset, otherLoanInterest);
      navigateTo(9, 'forward');
      document.getElementById('bottomNav').style.display = 'none';
      document.getElementById('progressWrap').style.display = 'none';
      if (isGuestMode) setTimeout(showPayPopup, 400);
      return;
    }
    navigateTo(current + 1, 'forward');
  }

  function toggleOtherLoanNone() {
    const checked = document.getElementById('otherLoanNone')?.checked;
    const wrap    = document.getElementById('otherLoanInputWrap');
    const box     = document.getElementById('otherLoanNoneBox');
    const label   = document.getElementById('otherLoanNoneLabel');
    if (wrap)  wrap.style.opacity  = checked ? '0.4' : '1';
    if (box)   {
      box.style.background    = checked ? 'var(--accent)' : 'var(--bg2)';
      box.style.borderColor   = checked ? 'var(--accent)' : 'var(--separator)';
      box.textContent         = checked ? '✓' : '';
      box.style.color         = checked ? '#fff' : '';
      box.style.fontWeight    = checked ? '700' : '';
    }
    if (label) label.style.borderColor = checked ? 'var(--accent)' : 'var(--separator)';
    if (checked) {
      document.getElementById('otherLoanPrincipal').value = '';
      document.getElementById('otherLoanRate').value = '';
      document.getElementById('otherLoanYears').value = '';
    }
    updateNextBtn();
  }

  function goBack() {
    if (current === 0) return;
    navigateTo(current - 1, 'back');
  }

  function resetCalculatorToIntro() {
    const allSlides = document.querySelectorAll('.slide');
    allSlides.forEach(slide => {
      slide.classList.remove('active', 'exit-left', 'exit-right');
      Array.from(slide.children).forEach(c => c.classList.remove('slide-child-enter'));
    });

    current = 0;
    if (allSlides[0]) allSlides[0].classList.add('active');
    setProgress(0);
    document.getElementById('bottomNav').style.display = 'flex';
    document.getElementById('progressWrap').style.display = 'block';
    document.getElementById('btnBack').disabled = true;
    updateNextBtn();
  }

  function startCalculatorFlow() {
    restartApp({ showDashboardAfterReset: false });
    resetCalculatorToIntro();
    showCalculator();
  }

  function navigateTo(next, direction = 'forward') {
    const allSlides = document.querySelectorAll('.slide');
    const exitClass = direction === 'forward' ? 'exit-left' : 'exit-right';

    allSlides[current].classList.remove('active');
    Array.from(allSlides[current].children).forEach(c => c.classList.remove('slide-child-enter'));
    allSlides[current].classList.add(exitClass);

    const prev = current;
    current = next;
    setProgress(current);
    document.getElementById('btnBack').disabled = current === 0;
    updateNextBtn();

    setTimeout(() => {
      allSlides[prev].classList.remove(exitClass);
      Array.from(allSlides[current].children).forEach((child, i) => {
        child.classList.remove('slide-child-enter');
        void child.offsetWidth;
        child.style.setProperty('--enter-delay', `${i * 70}ms`);
        child.classList.add('slide-child-enter');
      });
      allSlides[current].style.transition = 'none';
      allSlides[current].classList.add('active');
      void allSlides[current].offsetWidth;
      allSlides[current].style.transition = '';
      const inp = allSlides[current].querySelector('input');
      if (inp) setTimeout(() => inp.focus(), 350);
    }, 240);
  }


  // ── 대출 유형 선택 ──
  function selectLoanType(type) {
    loanType = type;
    document.querySelectorAll('[data-group="loanType"]').forEach(c => c.classList.remove('selected'));
    document.querySelector(`[data-val="${type}"]`).classList.add('selected');
    updateNextBtn();
  }

  // ── 시중대출 화면 표시 ──
  function showBankLoanScreen() {
    const allSlides = document.querySelectorAll('.slide');
    allSlides[current].classList.remove('active');
    Array.from(allSlides[current].children).forEach(c => c.classList.remove('slide-child-enter'));
    allSlides[current].classList.add('exit-left');
    const prev = current;
    setTimeout(() => allSlides[prev].classList.remove('exit-left'), 380);

    document.getElementById('bottomNav').style.display = 'none';
    document.getElementById('progressWrap').style.display = 'none';

    const resultSlide = document.querySelector('[data-slide="8"]');
    resultSlide.classList.add('active');
    resultSlide.innerHTML = buildBankLoanFormHtml();
    current = allSlides.length - 1;
    setTimeout(showBankNotice, 400); // 슬라이드 전환 후 팝업
  }

  // ── 시중대출 입력 폼 HTML ──
  function buildBankLoanFormHtml() {
    return `
      <div style="display:flex;flex-direction:column;gap:0">
      <div class="result-header-area">
        <div class="result-badge-wrap">
          <div class="result-icon blue">🏦</div>
          <div>
            <div class="result-option-label blue">시중 주택담보대출</div>
            <div class="result-title">조건을 입력해주세요</div>
          </div>
        </div>
        <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.25)">
          <span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;animation:pulse-dot 1.8s ease-in-out infinite"></span>
          <span style="font-size:11px;font-weight:600;color:var(--green);letter-spacing:-0.1px">실시간 대출 규제 반영 중</span>
        </div>
      </div>

      <div class="result-group" style="display:flex;flex-direction:column;gap:10px;margin-top:8px;padding:14px 14px">

        <div class="bank-form-row" style="align-items:center">
          <label class="bank-form-label">생애최초</label>
          <div style="display:flex;gap:8px;">
            <button class="bank-tag-btn" id="fbY" onclick="selectFirstBuyer('Y',this)">예</button>
            <button class="bank-tag-btn active" id="fbN" onclick="selectFirstBuyer('N',this)">아니오</button>
          </div>
        </div>

        <div class="bank-form-row">
          <label class="bank-form-label">지역</label>
          <select class="bank-region-select" id="bankRegionSelect" onchange="selectRegionDetail(this.value)">
            <option value="">지역을 선택해주세요</option>
            <optgroup label="🔴 규제지역 (LTV 40%)">
              <option value="reg_seoul">서울특별시 (전역)</option>
              <option value="reg_gwacheon">경기 — 과천시</option>
              <option value="reg_gwangmyeong">경기 — 광명시</option>
              <option value="reg_seongnam">경기 — 성남시 (분당·수정·중원구)</option>
              <option value="reg_suwon">경기 — 수원시 (영통·장안·팔달구)</option>
              <option value="reg_anyang">경기 — 안양시 (동안구)</option>
              <option value="reg_yongin">경기 — 용인시 (수지구)</option>
              <option value="reg_uiwang">경기 — 의왕시</option>
              <option value="reg_hanam">경기 — 하남시</option>
            </optgroup>
            <optgroup label="수도권 (LTV 70%)">
              <option value="incheon_gangwha">인천 — 강화군·옹진군</option>
              <option value="incheon_special">인천 — 서구 일부·경제특구</option>
              <option value="incheon_etc">인천 — 그 외</option>
              <option value="metro_city">경기 — 의정부·구리·고양·수원 일부·부천·광명 일부·과천 일부·의왕 일부·군포·용인 일부·화성·세종·김포</option>
              <option value="siheung_banwol">시흥 — 반월특수지역</option>
              <option value="siheung_etc">시흥 — 그 외</option>
              <option value="namyangju_core">남양주 — 호평·별내·금곡·일패·이패·삼패·가운·수석·지금·도농</option>
              <option value="namyangju_etc">남양주 — 그 외</option>
              <option value="gyeonggi_city">경기 — 안산시·광주시·파주시·이천시·평택시</option>
            </optgroup>
            <optgroup label="광역시 (LTV 70%)">
              <option value="metro_gun">광주·대구·대전·부산·울산 — 군지역</option>
              <option value="metro_etc">광주·대구·대전·부산·울산 — 그 외</option>
            </optgroup>
            <optgroup label="그 외 (LTV 70%)">
              <option value="other">그 밖의 지역</option>
            </optgroup>
          </select>
        </div>
        <div id="bangBadge" style="display:none" class="bang-badge">
          <span style="font-size:16px">🔒</span>
          <div class="bang-badge-text" id="bangBadgeText"></div>
        </div>

        <div class="bank-form-row">
          <label class="bank-form-label">주택가격</label>
          <div class="bank-input-wrap">
            <input class="bank-input" id="bankPrice" type="number" min="0" step="0.1" placeholder="예: 5" oninput="updateBankCalc()">
            <span class="bank-unit">억원</span>
          </div>
        </div>

        <div class="bank-form-row">
          <label class="bank-form-label">연소득</label>
          <div class="bank-input-wrap">
            <input class="bank-input" id="bankIncome" type="number" min="0" step="100" placeholder="예: 5000" oninput="updateBankCalc()">
            <span class="bank-unit">만원</span>
          </div>
        </div>
        <div id="bankIncomeMsg" style="font-size:11px;color:var(--label3);padding:0 2px;min-height:14px;margin-top:-4px">DSR 계산에 사용됩니다 (대출 1억 초과 시 적용)</div>

        <div class="bank-form-row">
          <label class="bank-form-label">대출금액</label>
          <div class="bank-input-wrap">
            <input class="bank-input" id="bankLoan" type="number" min="0" step="0.1" placeholder="예: 3" oninput="updateBankCalc()">
            <span class="bank-ltv-badge" id="bankLtvBadge"></span>
            <span class="bank-unit">억원</span>
          </div>
        </div>
        <div id="bankLoanMsg" style="font-size:11px;color:var(--red);padding:0 2px;min-height:14px;margin-top:-4px"></div>

        <div class="bank-form-row">
          <label class="bank-form-label">대출기간</label>
          <div class="bank-input-wrap">
            <input class="bank-input" id="bankYears" type="number" min="1" max="50" step="1" placeholder="예: 30" oninput="updateBankCalc()">
            <span class="bank-unit">년</span>
          </div>
        </div>
        <div id="bankYearsMsg" style="font-size:11px;color:var(--label3);padding:0 2px;min-height:14px;margin-top:-4px"></div>

        <div class="bank-form-row" style="align-items:center">
          <label class="bank-form-label">주택종류</label>
          <div style="display:flex;gap:8px;">
            <button class="bank-tag-btn active" id="mrtgA" onclick="toggleMrtg('A',this)">아파트</button>
            <button class="bank-tag-btn" id="mrtgE" onclick="toggleMrtg('E',this)">아파트외</button>
          </div>
        </div>

        <div class="bank-form-row" style="align-items:center">
          <label class="bank-form-label">금리방식</label>
          <div style="display:flex;gap:8px;">
            <button class="bank-tag-btn active" id="rateF" onclick="toggleRate('F',this)">고정</button>
            <button class="bank-tag-btn active" id="rateC" onclick="toggleRate('C',this)">변동</button>
          </div>
        </div>

        <div class="bank-form-row" style="align-items:center">
          <label class="bank-form-label">상환방식</label>
          <div style="display:flex;gap:8px;">
            <button class="bank-tag-btn active" id="rpayD" onclick="toggleRpay('D',this)">분할상환</button>
            <button class="bank-tag-btn active" id="rpayS" onclick="toggleRpay('S',this)">만기일시</button>
          </div>
        </div>

      </div>

      <button class="btn-next" style="margin-top:16px;width:100%;height:52px;min-height:52px;display:flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:14px;font-size:16px;font-weight:600;padding:0" id="bankSearchBtn" onclick="searchBankLoans()" disabled>
        🔍 내 조건으로 비교하기
      </button>

      <div id="bankResultArea" style="margin-top:16px"></div>

      <div class="result-spacer"></div>
      <button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>
      </div>
    `;
  }

  // ── 방공제 테이블 (단위: 만원) ──
  const BANG_TABLE = {
    // 규제지역 (서울 전역 + 경기 8개)
    reg_seoul:       5500,
    reg_gwacheon:    4800,
    reg_gwangmyeong: 4800,
    reg_seongnam:    4800,
    reg_suwon:       4800,
    reg_anyang:      4800,
    reg_yongin:      4800,
    reg_uiwang:      4800,
    reg_hanam:       4800,
    // 수도권 일반
    incheon_gangwha: 2500,
    incheon_special: 2800,
    incheon_etc:     4800,
    metro_city:      4800,
    siheung_banwol:  2500,
    siheung_etc:     4800,
    namyangju_core:  4800,
    namyangju_etc:   2500,
    gyeonggi_city:   2800,
    metro_gun:       2500,
    metro_etc:       2800,
    other:           2500,
  };

  // 규제지역 — LTV 40% 적용
  const REG_ZONES = new Set([
    'reg_seoul','reg_gwacheon','reg_gwangmyeong','reg_seongnam',
    'reg_suwon','reg_anyang','reg_yongin','reg_uiwang','reg_hanam'
  ]);

  // 수도권 여부 (대출기간 30년 제한용)
  const METRO_REGIONS = new Set([
    'reg_seoul','reg_gwacheon','reg_gwangmyeong','reg_seongnam',
    'reg_suwon','reg_anyang','reg_yongin','reg_uiwang','reg_hanam',
    'incheon_gangwha','incheon_special','incheon_etc',
    'metro_city','siheung_banwol','siheung_etc',
    'namyangju_core','namyangju_etc','gyeonggi_city'
  ]);

  let bankRegionKey  = ''; // 선택된 지역 key
  let bankRegion     = 'M'; // 'M'=수도권, 'N'=비수도권 (기존 LTV 로직용)
  let bankFirstBuyer = 'N';

  function getBangAmount() {
    return BANG_TABLE[bankRegionKey] || 0; // 만원
  }

  function selectRegionDetail(val) {
    bankRegionKey = val;
    bankRegion    = METRO_REGIONS.has(val) ? 'M' : 'N';

    // 방공제 배지 업데이트
    const badge    = document.getElementById('bangBadge');
    const badgeTxt = document.getElementById('bangBadgeText');
    const bang     = getBangAmount();
    if (val && bang > 0) {
      badgeTxt.innerHTML = `선택 지역 방공제 <strong>${bang.toLocaleString()}만원</strong> 적용 — 실질 대출금액에서 차감 후 월납입 계산`;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }

    // 수도권 대출기간 30년 제한
    const yearsEl  = document.getElementById('bankYears');
    const yearsMsg = document.getElementById('bankYearsMsg');
    if (bankRegion === 'M' && yearsEl) {
      if (parseFloat(yearsEl.value) > 30) yearsEl.value = 30;
      yearsEl.max = 30;
      if (yearsMsg) yearsMsg.textContent = '수도권은 최대 30년까지 가능합니다';
    } else if (yearsEl) {
      yearsEl.max = 50;
      if (yearsMsg) yearsMsg.textContent = '';
    }

    updateBankCalc();
    checkBankSearchBtn();
  }

  function checkBankSearchBtn() {
    const price    = parseFloat(document.getElementById('bankPrice')?.value);
    const loan     = parseFloat(document.getElementById('bankLoan')?.value);
    const years    = parseFloat(document.getElementById('bankYears')?.value);
    const searchBtn = document.getElementById('bankSearchBtn');
    if (!searchBtn) return;
    const allFilled = price > 0 && loan > 0 && years > 0 && bankRegionKey !== '';
    searchBtn.disabled    = !allFilled;
    searchBtn.style.opacity = allFilled ? '1' : '';
  }

  // ── 최초 1회 주의사항 팝업 ──
  function showBankNotice() {
    if (localStorage.getItem('bankNoticeSeen')) return;
    const overlay = document.createElement('div');
    overlay.className = 'bank-notice-overlay';
    overlay.id = 'bankNoticeOverlay';
    overlay.innerHTML = `
      <div class="bank-notice-sheet" id="bankNoticeSheet">
        <div class="bank-notice-title">⚠️ 시중 주담대 이용 전 확인사항</div>
        <div class="bank-notice-sub">실제 대출 신청 전 반드시 읽어주세요</div>
        <div class="bank-notice-item">
          <div class="bank-notice-icon">📊</div>
          <div class="bank-notice-text"><strong>전월 취급 평균금리 기준</strong>으로 표시됩니다. 실제 적용 금리는 신용도·소득·담보 심사 후 결정되며 다를 수 있습니다.</div>
        </div>
        <div class="bank-notice-item">
          <div class="bank-notice-icon">🔒</div>
          <div class="bank-notice-text"><strong>방공제(최우선변제 소액보증금)</strong>가 대출금에서 자동 차감 적용됩니다. 지역 선택 시 해당 금액이 반영돼요.</div>
        </div>
        <div class="bank-notice-item">
          <div class="bank-notice-icon">🏙️</div>
          <div class="bank-notice-text"><strong>규제지역(서울 전역·경기 8개 지역)</strong>은 LTV 40%가 적용됩니다. 드롭다운에서 🔴 규제지역을 선택하면 자동 반영돼요.</div>
        </div>
        <div class="bank-notice-item">
          <div class="bank-notice-icon">🏦</div>
          <div class="bank-notice-text">표시된 상품은 금융감독원 <strong>금융상품 한눈에</strong> 데이터 기준이며, 일부 상품은 누락될 수 있습니다.</div>
        </div>
        <div class="bank-notice-item">
          <div class="bank-notice-icon">📋</div>
          <div class="bank-notice-text"><strong>DSR 시뮬레이션</strong>은 무대출 상황 기준 참고용이며, 기존 대출이 있다면 실제 한도는 더 낮을 수 있습니다.</div>
        </div>
        <button class="btn-notice-confirm" onclick="closeBankNotice()">확인했어요</button>
      </div>
    `;
    document.querySelector('.app').appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeBankNotice() {
    localStorage.setItem('bankNoticeSeen', '1');
    const overlay = document.getElementById('bankNoticeOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 320);
  }

  // ── DSR 스트레스 가산금리 ──
  // 고정금리 선택 시 0%, 수도권/규제지역 1.50%, 지방 0.75%
  function getDsrStressRate() {
    // 고정금리만 선택 시 평균 0.8% 적용 (혼합형 1.2% / 주기형 0.6% 평균)
    const onlyFixed = bankFilter.rate.includes('F') && !bankFilter.rate.includes('C');
    if (onlyFixed) return 0.8;
    // 수도권 or 규제지역 → 3단계 1.50%
    if (bankRegion === 'M') return 1.50;
    // 지방 → 2단계 0.75%
    return 0.75;
  }

  // DSR 40% 기준 최대 월납입 → 최대 대출 가능 원금 역산
  // avgRate: 전월평균금리 (%) / years: 대출기간 / stressRate: 스트레스 가산금리
  function calcDsrMaxLoan(incomeMan, avgRate, years) {
    const maxMonthlyPayment = (incomeMan * 10000 * 0.4) / 12; // 연소득 × 40% ÷ 12
    const stressRate = getDsrStressRate();
    const effectiveRate = avgRate + stressRate; // 스트레스 금리 합산
    const r = effectiveRate / 12 / 100;
    const n = years * 12;
    if (r <= 0 || n <= 0) return Infinity;
    // 원리금균등 역산: P = PMT × (1-(1+r)^-n) / r
    const maxPrincipal = maxMonthlyPayment * (1 - Math.pow(1 + r, -n)) / r;
    return maxPrincipal / 100000000; // 억원 단위
  }

  // LTV 한도 계산 (규제지역·생애최초·지역 기반)
  function getBankLtvLimit() {
    if (REG_ZONES.has(bankRegionKey)) {
      // 규제지역: 생애최초 70%, 일반 40%
      return bankFirstBuyer === 'Y' ? 70 : 40;
    }
    if (bankFirstBuyer === 'Y') {
      return bankRegion === 'M' ? 70 : 80; // 비규제: 수도권 70%, 비수도권 80%
    }
    return 70;
  }

  // 고가주택 대출 한도 (규제지역 수도권 기준, 억원)
  // 고가주택 대출 한도 (규제지역 + 수도권 전체 적용, 억원)
  function getBankPriceLimit(price) {
    if (bankRegion !== 'M') return Infinity; // 지방은 한도 없음
    if (price <= 15) return 6;
    if (price <= 25) return 4;
    return 2;
  }

  function selectFirstBuyer(val, btn) {
    bankFirstBuyer = val;
    document.querySelectorAll('#fbY,#fbN').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateBankCalc();
  }

  // ── 시중대출 필터 + 전역 상태 ──
  const bankFilter   = { mrtg: ['A'], rate: ['F','C'], rpay: ['D','S'] };
  let bankCompareSet = new Set();
  let bankAllProds   = [];
  let bankLoanCtx    = { loanEok: 0, loanInputEok: 0, bangMan: 0, years: 30 };
  let bankCurrentPage = 1;
  let bankSortBy     = 'rate';
  let bankMajorFirst = false;

  function toggleMrtg(val, btn) {
    const idx = bankFilter.mrtg.indexOf(val);
    if (idx >= 0) { if (bankFilter.mrtg.length > 1) { bankFilter.mrtg.splice(idx,1); btn.classList.remove('active'); } }
    else { bankFilter.mrtg.push(val); btn.classList.add('active'); }
  }
  function toggleRate(val, btn) {
    const idx = bankFilter.rate.indexOf(val);
    if (idx >= 0) { if (bankFilter.rate.length > 1) { bankFilter.rate.splice(idx,1); btn.classList.remove('active'); } }
    else { bankFilter.rate.push(val); btn.classList.add('active'); }
    updateBankCalc(); // 금리방식 변경 시 DSR 스트레스 재계산
  }
  function toggleRpay(val, btn) {
    const idx = bankFilter.rpay.indexOf(val);
    if (idx >= 0) { if (bankFilter.rpay.length > 1) { bankFilter.rpay.splice(idx,1); btn.classList.remove('active'); } }
    else { bankFilter.rpay.push(val); btn.classList.add('active'); }
  }

  function updateBankCalc() {
    const price     = parseFloat(document.getElementById('bankPrice')?.value);
    const loanInput = document.getElementById('bankLoan');
    const loan      = parseFloat(loanInput?.value);
    const badge     = document.getElementById('bankLtvBadge');
    const loanMsg   = document.getElementById('bankLoanMsg');

    if (!price || price <= 0) {
      if (badge)   badge.textContent = '';
      if (loanMsg) loanMsg.textContent = '';
      return;
    }

    const ltvLimit   = getBankLtvLimit();
    const priceLimit = getBankPriceLimit(price);
    const ltvMaxLoan = Math.floor(price * ltvLimit) / 100;
    const maxLoan    = priceLimit === Infinity ? ltvMaxLoan : Math.min(ltvMaxLoan, priceLimit);
    const isReg      = REG_ZONES.has(bankRegionKey);
    const isMetro    = bankRegion === 'M';

    // 한도 제한 이유 항상 표시
    const limitReason = isMetro && priceLimit < ltvMaxLoan
      ? `고가주택 한도 ${priceLimit}억 적용 (LTV ${ltvLimit}% 기준 ${ltvMaxLoan.toFixed(1)}억)`
      : isReg
        ? `규제지역 LTV ${ltvLimit}% 기준`
        : `LTV ${ltvLimit}% 기준`;

    // 대출금액 초과 시 자동 클리핑
    if (loan > 0 && loan > maxLoan) {
      if (loanInput) loanInput.value = maxLoan.toFixed(1);
    }

    if (loanMsg) {
      loanMsg.style.color = isMetro && priceLimit < ltvMaxLoan ? 'var(--yellow)' : 'var(--label3)';
      loanMsg.textContent = `최대 ${maxLoan.toFixed(1)}억 · ${limitReason}`;
    }

    // LTV 배지
    const actualLoan = parseFloat(loanInput?.value);
    if (badge && actualLoan > 0) {
      const ltv = Math.round((actualLoan / price) * 100);
      badge.textContent = 'LTV ' + ltv + '%';
      badge.style.color = ltv > ltvLimit ? 'var(--red)' : 'var(--green)';
    } else if (badge) {
      badge.textContent = '';
    }

    // DSR 계산 (대출 1억 초과 + 연소득 입력 시)
    const income     = parseFloat(document.getElementById('bankIncome')?.value);
    const dsrMsg     = document.getElementById('bankIncomeMsg');
    const years      = parseFloat(document.getElementById('bankYears')?.value);
    const actualLoanVal = parseFloat(loanInput?.value) || 0;

    if (dsrMsg && income > 0 && actualLoanVal > 1) {
      const stressRate = getDsrStressRate();
      const avgRate    = 5.0; // 참고용 평균금리 (전월 평균 기준 추정)
      const loanYears  = years > 0 ? years : 30;
      const dsrMax     = calcDsrMaxLoan(income, avgRate, loanYears);
      const dsrMaxLoan = Math.min(dsrMax, maxLoan); // LTV와 DSR 중 낮은 값

      const stressLabel = stressRate > 0
        ? ` (스트레스 +${stressRate}% 적용)`
        : '';

      if (actualLoanVal > dsrMax) {
        dsrMsg.style.color = 'var(--red)';
        dsrMsg.innerHTML = `⚠️ DSR 초과 — 연소득 기준 최대 <strong>${dsrMax.toFixed(2)}억</strong> 가능${stressLabel}`;
      } else {
        dsrMsg.style.color = 'var(--green)';
        dsrMsg.innerHTML = `✓ DSR 통과 — 연소득 기준 최대 <strong>${dsrMax.toFixed(2)}억</strong> 가능${stressLabel}`;
      }
    } else if (dsrMsg && actualLoanVal <= 1 && income > 0) {
      dsrMsg.style.color = 'var(--label3)';
      dsrMsg.textContent = '대출 1억 이하 — DSR 미적용';
    } else if (dsrMsg) {
      dsrMsg.style.color = 'var(--label3)';
      dsrMsg.textContent = '추정 DSR 계산에 사용됩니다 (대출 1억 초과 시 적용)';
    }

    // 검색 버튼 활성화
    checkBankSearchBtn();
  }

  // ── DSR 초과 확인 팝업 ──
  let _dsrPendingProceed = null; // 조회 계속 진행용 콜백
  let _dsrMaxForReenter  = 0;   // 재입력 시 자동 세팅할 금액

  function showDsrConfirm(dsrMax, loanVal, onProceed) {
    const overlay = document.getElementById('dsrConfirmOverlay');
    const desc    = document.getElementById('dsrConfirmDesc');
    if (!overlay || !desc) { onProceed(); return; }
    _dsrPendingProceed = onProceed;
    _dsrMaxForReenter  = dsrMax;
    desc.innerHTML = `입력하신 대출금액 <strong>${loanVal.toFixed(1)}억</strong>이 약식 DSR 계산 기준 최대 <strong>${dsrMax.toFixed(2)}억</strong>을 초과해요.<br><small style="color:var(--label3);font-size:11px">무대출 가정 · 참고용 수치이며 실제와 다를 수 있어요</small>`;
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeDsrConfirm() {
    const overlay = document.getElementById('dsrConfirmOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }

  function dsrConfirmProceed() {
    closeDsrConfirm();
    if (_dsrPendingProceed) { _dsrPendingProceed(); _dsrPendingProceed = null; }
  }

  function dsrConfirmReenter() {
    closeDsrConfirm();
    const loanEl = document.getElementById('bankLoan');
    if (loanEl && _dsrMaxForReenter > 0) {
      // 소수점 1자리 내림으로 세팅 — 반올림으로 한도 초과 방지
      loanEl.value = (Math.floor(_dsrMaxForReenter * 10) / 10).toFixed(1);
      updateBankCalc();
    }
    _dsrPendingProceed = null;
  }

  // ── 시중대출 API 조회 ──
  async function searchBankLoans() {
    const price     = parseFloat(document.getElementById('bankPrice')?.value);
    const loanInput = parseFloat(document.getElementById('bankLoan')?.value);
    const years     = parseFloat(document.getElementById('bankYears')?.value) || 30;
    const area      = document.getElementById('bankResultArea');

    if (!price || !loanInput) {
      area.innerHTML = '<div class="result-tagline grey-border">주택가격과 대출금액을 입력해주세요.</div>';
      return;
    }

    // DSR 초과 여부 확인 (연소득 입력 + 대출 1억 초과 시)
    const income = parseFloat(document.getElementById('bankIncome')?.value);
    if (income > 0 && loanInput > 1) {
      const loanYears = years > 0 ? years : 30;
      const dsrMax    = calcDsrMaxLoan(income, 5.0, loanYears);
      if (loanInput > dsrMax + 0.001) {
        showDsrConfirm(dsrMax, loanInput, () => _doSearchBankLoans(price, loanInput, years, area));
        return;
      }
    }

    _doSearchBankLoans(price, loanInput, years, area);
  }

  async function _doSearchBankLoans(price, loanInput, years, area) {

    // 방공제 차감
    const bangMan  = getBangAmount(); // 만원
    const bangEok  = bangMan / 10000; // 억원
    const netLoan  = Math.max(loanInput - bangEok, 0);

    bankCompareSet.clear();
    bankBangBanner = '';
    updateCompareBar();

    area.innerHTML = `
      <div class="fetch-loader">
        <div class="fetch-loader-title">금리 정보를 불러오는 중...</div>
        <div class="fetch-progress-track">
          <div class="fetch-progress-fill"></div>
        </div>
        <div class="fetch-loader-sub" id="fetchProgress">은행권 조회 중</div>
      </div>`;

    try {
      const sectors = [
        { code: '020000', label: '은행권' },
        { code: '030300', label: '저축은행' }
      ];
      let allBase = [], allOptions = [];

      for (const s of sectors) {
        const prog = document.getElementById('fetchProgress');
        if (prog) prog.textContent = `${s.label} 조회 중...`;

        let page = 1;
        let safeguard = 0;
        while (safeguard++ < 20) {
          const res = await fetch(`/.netlify/functions/mortgage?sector=${s.code}&page=${page}`);

          // ── 에러 코드 처리 ──
          if (res.status === 429) {
            area.innerHTML = `
              <div class="result-group">
                <div style="text-align:center;padding:16px 0">
                  <div style="font-size:28px;margin-bottom:10px">⚠️</div>
                  <div style="font-size:15px;font-weight:600;color:var(--label1);margin-bottom:6px">오늘 조회 한도를 초과했어요</div>
                  <div style="font-size:13px;color:var(--label3);line-height:1.6">금융감독원 API의 일일 조회 한도(10,000건)에<br>도달했습니다. 내일 다시 시도해주세요.</div>
                </div>
              </div>`;
            return;
          }
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `서버 오류 (${res.status})`);
          }

          const data = await res.json();
          allBase    = allBase.concat(data.baseList    || []);
          allOptions = allOptions.concat(data.optionList || []);
          if (prog) prog.textContent = `${s.label} 조회 중... (${page}/${data.maxPage || '?'}페이지)`;
          if (!data.hasMore) break;
          page++;
        }
      }

      // netLoan(방공제 차감액)으로 월납입 계산, bangMan 정보도 전달
      bankLoanCtx = { loanEok: netLoan, loanInputEok: loanInput, bangMan, years };
      renderBankResults({ baseList: allBase, optionList: allOptions }, netLoan, years, loanInput, bangMan);

    } catch (e) {
      area.innerHTML = `<div class="result-tagline grey-border">데이터를 불러오지 못했습니다.<br><small style="color:var(--label3)">${e.message}</small></div>`;
    }
  }

  const BANK_PAGE_SIZE = 10;

  let bankBangBanner = ''; // 방공제 배너 HTML (renderBankPage에서 사용)

  function renderBankResults(data, loanEok, years, loanInputEok, bangMan) {
    const area = document.getElementById('bankResultArea');
    const { baseList, optionList } = data;

    // 방공제 배너 — renderBankPage에서도 접근 가능하도록 외부 변수에 저장
    bankBangBanner = (bangMan > 0 && loanInputEok > loanEok) ? `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(255,214,10,0.07);border:1px solid rgba(255,214,10,0.2);border-radius:10px;margin-bottom:14px">
        <span style="font-size:16px">🔒</span>
        <div style="font-size:12px;color:rgba(255,214,10,0.8);line-height:1.5">
          방공제 <strong style="color:var(--yellow)">${bangMan.toLocaleString()}만원</strong> 차감 적용
          &nbsp;·&nbsp; ${loanInputEok.toFixed(1)}억 → <strong style="color:#fff">${loanEok.toFixed(2)}억</strong> 기준으로 월납입 계산
        </div>
      </div>` : '';

    const baseMap = {};
    baseList.forEach(b => { baseMap[b.fin_co_no + '_' + b.fin_prdt_cd] = b; });

    const filtered = optionList.filter(o => {
      const mrtgOk = bankFilter.mrtg.includes(o.mrtg_type);
      const rateOk = bankFilter.rate.includes(o.lend_rate_type);
      const rpayOk = bankFilter.rpay.includes(o.rpay_type);
      return mrtgOk && rateOk && rpayOk && o.lend_rate_min > 0;
    });

    if (!filtered.length) {
      area.innerHTML = '<div class="result-tagline grey-border">조건에 맞는 상품이 없습니다. 필터를 조정해보세요.</div>';
      return;
    }

    const prodMap = {};
    filtered.forEach(o => {
      const key = o.fin_co_no + '_' + o.fin_prdt_cd;
      if (!prodMap[key]) prodMap[key] = { key, base: baseMap[key], options: [] };
      prodMap[key].options.push(o);
    });

    const prods = Object.values(prodMap)
      .filter(p => p.base)
      .sort((a, b) => {
        const minA = Math.min(...a.options.map(o => o.lend_rate_min));
        const minB = Math.min(...b.options.map(o => o.lend_rate_min));
        return minA - minB;
      });

    bankAllProds = prods;
    bankCurrentPage = 1;
    bankSortBy = 'rate';
    bankMajorFirst = false;
    renderBankPage(loanEok, years);

    // 힌트 플로팅 표시
    showCompareHint();
  }

  // ── 주요은행 필터 ──
  const MAJOR_BANKS = ['KB국민은행', '우리은행', '신한은행', 'KEB하나은행', 'NH농협은행'];

  function toggleMajorFirst() {
    bankMajorFirst = !bankMajorFirst;
    bankCurrentPage = 1;
    renderBankPage(bankLoanCtx.loanEok, bankLoanCtx.years, true);
  }

  function setBankSort(val) {
    bankSortBy = val;
    renderBankPage(bankLoanCtx.loanEok, bankLoanCtx.years, true);
  }

  function renderBankPage(loanEok, years, noAnimate) {
    const area    = document.getElementById('bankResultArea');
    const loanWon = loanEok * 100000000;
    const n       = years * 12;

    // 월납입 계산 + 정렬용 캐싱
    let prods = bankAllProds.map(p => {
      const avgRate = p.options.reduce((s, o) => s + (o.lend_rate_avg || o.lend_rate_min || 0), 0) / p.options.length;
      const r       = avgRate / 12 / 100;
      const monthly = r > 0 ? Math.round((loanWon * r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1)) : 0;
      return { ...p, _minRate: Math.min(...p.options.map(o => o.lend_rate_min)), _monthly: monthly };
    });

    if (bankSortBy === 'rate') {
      prods.sort((a, b) => a._minRate - b._minRate);
    } else {
      prods.sort((a, b) => (a._monthly || Infinity) - (b._monthly || Infinity));
    }

    if (bankMajorFirst) {
      const majors = prods.filter(p => MAJOR_BANKS.includes(p.base.kor_co_nm));
      const others = prods.filter(p => !MAJOR_BANKS.includes(p.base.kor_co_nm));
      prods = [...majors, ...others];
    }

    const cards = prods.map((p, i) => {
      const b          = p.base;
      const minRate    = p._minRate;
      const maxRate    = Math.max(...p.options.map(o => o.lend_rate_max));
      const monthly    = p._monthly;
      const monthlyStr = monthly > 0 ? Math.round(monthly/10000).toLocaleString() + '만원/월' : '-';
      const rateTypes  = [...new Set(p.options.map(o => o.lend_rate_type_nm))].join(' · ');
      const rpayTypes  = [...new Set(p.options.map(o => o.rpay_type_nm))].join(' · ');
      const isOnline   = b.join_way && (b.join_way.includes('인터넷') || b.join_way.includes('스마트폰'));

      const rankBadge = i === 0
        ? `<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:rgba(255,107,157,0.15);color:#ff6b9d;font-weight:700">${bankSortBy==='rate'?'최저금리':'최저납입'}</span>`
        : i === 1
        ? '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:var(--accent-dim);color:var(--accent);font-weight:700">2위</span>'
        : i === 2
        ? '<span style="font-size:10px;padding:2px 7px;border-radius:20px;background:var(--green-dim);color:var(--green);font-weight:700">3위</span>'
        : '';

      const isChecked = bankCompareSet.has(p.key);

      // 상세 정보 필드
      const erlyRpayFee = b.erly_rpay_fee || '-';
      const loanInciExpn = b.loan_inci_expn || '-';
      const dlyRate  = b.dly_rate  || '-';
      const loanLmt  = b.loan_lmt  || '-';
      const joinWay  = b.join_way  || '-';

      return `
        <div class="result-group bank-card${noAnimate ? '' : ' card-animate'}" id="bcard-${i}" style="margin-bottom:8px${noAnimate ? '' : `;animation-delay:${i * 0.05}s`}">
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px">
            <div class="compare-check${isChecked?' checked':''}" id="chk-${i}" onclick="toggleCompare('${p.key}',${i})">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                ${rankBadge}
                <span style="font-weight:700;font-size:15px">${b.kor_co_nm}</span>
                ${isOnline?'<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:rgba(10,132,255,0.12);color:var(--accent)">앱/인터넷</span>':''}
              </div>
              <div style="font-size:12px;color:var(--label3)">${b.fin_prdt_nm}</div>
            </div>
          </div>
          <div class="rate-limit-row" style="margin-bottom:8px">
            <div class="info-pill">
              <span class="info-pill-label">금리 범위</span>
              <span class="info-pill-val blue">${minRate.toFixed(2)} ~ ${maxRate.toFixed(2)}%</span>
            </div>
            <div class="info-pill">
              <span class="info-pill-label">월납입 추정</span>
              <span class="info-pill-val">${monthlyStr}</span>
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span style="font-size:11px;color:var(--label3)">${rateTypes}</span>
              <span style="font-size:11px;color:var(--label3)">·</span>
              <span style="font-size:11px;color:var(--label3)">${rpayTypes}</span>
            </div>
            <button onclick="toggleBankDetail('detail-${i}')" id="detailBtn-${i}"
              style="flex-shrink:0;background:var(--bg4);border:none;border-radius:8px;padding:4px 10px;font-size:11px;color:var(--label2);cursor:pointer;font-family:inherit;margin-left:8px">
              상세 ▾
            </button>
          </div>
          <div class="bank-detail-panel" id="detail-${i}">
            <div class="bank-detail-inner">
              <div class="bank-detail-row">
                <div class="bank-detail-label">중도상환수수료</div>
                <div class="bank-detail-val">${erlyRpayFee}</div>
              </div>
              <div class="bank-detail-row">
                <div class="bank-detail-label">연체이자율</div>
                <div class="bank-detail-val">${dlyRate}</div>
              </div>
              <div class="bank-detail-row">
                <div class="bank-detail-label">대출한도</div>
                <div class="bank-detail-val">${loanLmt}</div>
              </div>
              <div class="bank-detail-row">
                <div class="bank-detail-label">대출 부대비용</div>
                <div class="bank-detail-val">${loanInciExpn}</div>
              </div>
              <div class="bank-detail-row">
                <div class="bank-detail-label">가입방법</div>
                <div class="bank-detail-val">${joinWay}</div>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    const sortBar = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px">
        <div style="display:flex;gap:4px">
          <button onclick="setBankSort('rate')" style="padding:6px 12px;border-radius:20px;border:1.5px solid ${bankSortBy==='rate'?'var(--accent)':'var(--separator)'};background:${bankSortBy==='rate'?'var(--accent-dim)':'var(--bg3)'};color:${bankSortBy==='rate'?'var(--accent)':'var(--label2)'};font-family:inherit;font-size:12px;font-weight:${bankSortBy==='rate'?'700':'400'};cursor:pointer">금리 낮은 순</button>
          <button onclick="setBankSort('monthly')" style="padding:6px 12px;border-radius:20px;border:1.5px solid ${bankSortBy==='monthly'?'var(--accent)':'var(--separator)'};background:${bankSortBy==='monthly'?'var(--accent-dim)':'var(--bg3)'};color:${bankSortBy==='monthly'?'var(--accent)':'var(--label2)'};font-family:inherit;font-size:12px;font-weight:${bankSortBy==='monthly'?'700':'400'};cursor:pointer">월납입 낮은 순</button>
        </div>
        <button onclick="toggleMajorFirst()" style="display:flex;align-items:center;gap:5px;padding:6px 10px;border-radius:20px;border:1.5px solid ${bankMajorFirst?'var(--accent)':'var(--separator)'};background:${bankMajorFirst?'var(--accent-dim)':'var(--bg3)'};color:${bankMajorFirst?'var(--accent)':'var(--label3)'};font-family:inherit;font-size:11px;font-weight:${bankMajorFirst?'700':'400'};cursor:pointer;white-space:nowrap">
          🏦 주요은행 먼저
        </button>
      </div>
      <div style="font-size:11px;color:var(--label3);margin-bottom:12px">※ 전월 취급 평균금리 기준 · 실제 금리는 심사 후 결정됩니다</div>`;

    area.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div class="group-label" style="margin-bottom:0">총 ${prods.length}개 상품</div>
      </div>
      ${bankBangBanner}
      ${sortBar}
      ${cards}
      <div class="result-spacer"></div>
      ${bankNoticeHtml()}
    `;
  }

  function bankGoPage() {} // unused

  // ── 힌트 플로팅 ──
  let _hintDismissed = false;
  function showCompareHint() {
    if (_hintDismissed) return;
    let hint = document.getElementById('compareHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'compareHint';
      hint.className = 'compare-hint';
      hint.innerHTML = `<div class="compare-hint-bubble">☑️ 카드를 <span>체크</span>하면 상품을 비교할 수 있어요</div>`;
      document.querySelector('.app').appendChild(hint);
    }
    // compareBar가 이미 표시 중이면 스킵
    const bar = document.getElementById('compareBar');
    if (bar && parseFloat(bar.style.opacity) > 0) return;

    requestAnimationFrame(() => hint.classList.add('visible'));
    // 자동 숨김 없음 — 체크 시에만 사라짐
  }

  function hideCompareHint() {
    _hintDismissed = true;
    const hint = document.getElementById('compareHint');
    if (hint) hint.classList.remove('visible');
  }

  function toggleBankDetail(id) {
    const el  = document.getElementById(id);
    const idx = id.split('-')[1];
    const btn = document.getElementById('detailBtn-' + idx);
    if (!el) return;
    const open = el.classList.toggle('open');
    if (btn) btn.textContent = open ? '상세 ▴' : '상세 ▾';
  }

  // ── 비교 체크 토글 ──
  function toggleCompare(key, idx) {
    haptic(8);
    const chk = document.getElementById('chk-' + idx);
    if (bankCompareSet.has(key)) {
      bankCompareSet.delete(key);
      chk && chk.classList.remove('checked');
    } else {
      if (bankCompareSet.size >= 3) {
        // 최대 3개 알림
        chk.style.animation = 'shake 0.3s';
        setTimeout(() => chk && (chk.style.animation = ''), 300);
        return;
      }
      bankCompareSet.add(key);
      chk && chk.classList.add('checked');
    }
    updateCompareBar();
  }

  // ── 하단 비교 바 업데이트 ──
  function updateCompareBar() {
    let bar = document.getElementById('compareBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'compareBar';
      bar.className = 'compare-bar';
      document.querySelector('.app').appendChild(bar);
    }
    const cnt = bankCompareSet.size;

    if (cnt === 0) {
      bar.style.transform = 'translateY(100%)';
      bar.style.opacity   = '0';
      return;
    }

    // 첫 체크 시 힌트 영구 숨김
    hideCompareHint();

    if (cnt < 2) {
      bar.style.transform = 'translateY(0)';
      bar.style.opacity   = '1';
      bar.innerHTML = `<span style="font-size:14px;font-weight:500;color:rgba(255,255,255,0.8)">${cnt}개 선택됨 · 1개 더 선택하면 비교 가능</span>`;
      return;
    }

    bar.style.transform = 'translateY(0)';
    bar.style.opacity   = '1';
    bar.innerHTML = `
      <button onclick="resetCompare()" style="background:rgba(255,255,255,0.15);border:none;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:500;color:#fff;cursor:pointer;font-family:inherit">✕ 초기화</button>
      <span style="font-size:14px;font-weight:600;color:#fff">${cnt}개 선택됨</span>
      <button onclick="showComparePanel()" style="background:#fff;color:var(--accent);border:none;border-radius:10px;padding:8px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:-0.3px">비교하기 →</button>
    `;
  }

  // ── 비교 체크 전체 초기화 ──
  function resetCompare() {
    bankCompareSet.clear();
    // 카드 체크박스 UI 모두 해제
    document.querySelectorAll('.compare-check.checked').forEach(el => el.classList.remove('checked'));
    updateCompareBar();
  }

  // ── 비교 패널 ──
  function showComparePanel() {
    const selected = bankAllProds.filter(p => bankCompareSet.has(p.key));
    if (!selected.length) return;

    const { loanEok, years } = bankLoanCtx;
    const loanWon = loanEok * 100000000;
    const n       = years * 12;

    const cols = selected.map(p => {
      const b        = p.base;
      const minRate  = Math.min(...p.options.map(o => o.lend_rate_min));
      const maxRate  = Math.max(...p.options.map(o => o.lend_rate_max));
      const avgRate  = p.options.reduce((s, o) => s + (o.lend_rate_avg || o.lend_rate_min || 0), 0) / p.options.length;
      const r        = avgRate / 12 / 100;
      const monthly  = r > 0 ? Math.round((loanWon * r * Math.pow(1+r,n)) / (Math.pow(1+r,n)-1)) : 0;
      const monthlyStr = monthly > 0 ? Math.round(monthly/10000).toLocaleString() + '만원' : '-';
      const rateTypes  = [...new Set(p.options.map(o => o.lend_rate_type_nm))].join('<br>');
      const rpayTypes  = [...new Set(p.options.map(o => o.rpay_type_nm))].join('<br>');
      const isOnline   = b.join_way && (b.join_way.includes('인터넷') || b.join_way.includes('스마트폰'));
      const erlyRpayFee  = b.erly_rpay_fee  || '-';
      const loanInciExpn = b.loan_inci_expn || '-';
      const dlyRate      = b.dly_rate       || '-';
      const loanLmt      = b.loan_lmt       || '-';
      return { b, minRate, maxRate, avgRate, monthly, monthlyStr, rateTypes, rpayTypes, isOnline, erlyRpayFee, loanInciExpn, dlyRate, loanLmt };
    });

    const minRateVal   = Math.min(...cols.map(c => c.minRate));
    const minMonthly   = Math.min(...cols.map(c => c.monthly));

    // 열 너비: 2개 50/50, 3개 33/33/33
    const colPct       = cols.length === 2 ? '50%' : '33.33%';
    const gridCols     = cols.map(() => colPct).join(' ');

    const colHeaders = cols.map(c => `
      <div class="cmp-col-head">
        <div style="font-size:13px;font-weight:700;color:var(--label1);word-break:keep-all;line-height:1.4">${c.b.kor_co_nm}</div>
        <div style="font-size:10px;color:var(--label3);margin-top:3px;line-height:1.4;word-break:break-all;overflow-wrap:break-word">${c.b.fin_prdt_nm}</div>
      </div>`).join('');

    const rows = [
      {
        label: '금리 범위',
        vals: cols.map(c => {
          const color = c.minRate === minRateVal ? '#ff6b9d' : 'var(--accent)';
          return `<div style="font-weight:700;color:${color};line-height:1.8;font-size:14px">
            <div>${c.minRate.toFixed(2)}%</div>
            <div>${c.maxRate.toFixed(2)}%</div>
          </div>`;
        })
      },
      {
        label: '전월<br>평균금리',
        vals: cols.map(c => `<span style="font-size:13px">${c.avgRate.toFixed(2)}%</span>`)
      },
      {
        label: `<span style="font-size:12px;font-weight:600;color:var(--label2);line-height:1.4">월납입액<br>추정</span><br><span style="font-size:10px;color:var(--label3);font-weight:400">${loanEok.toFixed(2)}억 ${years}년</span>`,
        vals: cols.map(c => `<span style="font-size:15px;font-weight:700;color:${c.monthly === minMonthly ? 'var(--green)' : 'var(--label1)'}">${c.monthlyStr}</span>`)
      },
      {
        label: '금리<br>방식',
        vals: cols.map(c => `<span style="font-size:12px">${c.rateTypes}</span>`)
      },
      {
        label: '상환<br>방식',
        vals: cols.map(c => `<span style="font-size:12px">${c.rpayTypes}</span>`)
      },
      {
        label: '온라인<br>가입',
        vals: cols.map(c => c.isOnline
          ? '<span style="color:var(--green);font-size:13px">✓ 가능</span>'
          : '<span style="color:var(--label3);font-size:13px">－</span>')
      },
      {
        label: '중도상환<br>수수료',
        vals: cols.map(c => `<span style="font-size:11px;color:var(--label2);line-height:1.6;text-align:left;display:block">${c.erlyRpayFee}</span>`)
      },
      {
        label: '연체<br>이자율',
        vals: cols.map(c => `<span style="font-size:11px;color:var(--label2);line-height:1.6;text-align:left;display:block">${c.dlyRate}</span>`)
      },
      {
        label: '대출<br>한도',
        vals: cols.map(c => `<span style="font-size:11px;color:var(--label2);line-height:1.6;text-align:left;display:block">${c.loanLmt}</span>`)
      },
      {
        label: '부대<br>비용',
        vals: cols.map(c => `<span style="font-size:11px;color:var(--label2);line-height:1.6;text-align:left;display:block">${c.loanInciExpn}</span>`)
      }
    ];

    let panel = document.getElementById('comparePanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'comparePanel';
      panel.className = 'compare-panel';
      document.querySelector('.app').appendChild(panel);
    }
    panel.innerHTML = `
      <div class="compare-panel-inner">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-shrink:0">
          <div style="font-size:17px;font-weight:700">상품 비교</div>
          <button onclick="closeComparePanel()" style="background:var(--bg4);border:none;border-radius:8px;padding:6px 14px;color:var(--label2);font-size:13px;cursor:pointer;font-family:inherit">닫기</button>
        </div>
        <div style="display:flex;gap:0;margin-bottom:2px">
          <div style="width:56px;flex-shrink:0"></div>
          <div style="flex:1;min-width:0;display:grid;grid-template-columns:${gridCols};gap:2px">${colHeaders}</div>
        </div>
        ${rows.map(row => `
        <div style="display:flex;gap:0;margin-bottom:2px">
          <div class="cmp-row-label">${row.label}</div>
          <div style="flex:1;min-width:0;display:grid;grid-template-columns:${gridCols};gap:2px">
            ${row.vals.map(v => `<div class="cmp-col-val">${v}</div>`).join('')}
          </div>
        </div>`).join('')}
        <div style="font-size:11px;color:var(--label3);margin-top:16px;line-height:1.6">
          ※ 월납입은 원리금균등 방식 · 전월평균금리 기준 약식 계산값으로 실제와 다를 수 있습니다.<br>
          ※ 실제 금리 및 한도는 해당 금융회사에 직접 문의하세요.
        </div>
      </div>
    `;
    panel.style.display = 'flex';
    requestAnimationFrame(() => panel.classList.add('open'));
  }

  function closeComparePanel() {
    const panel = document.getElementById('comparePanel');
    if (!panel) return;
    panel.classList.remove('open');
    setTimeout(() => {
      panel.style.display = 'none';
      // 선택된 상품이 있으면 compareBar 다시 표시
      updateCompareBar();
    }, 300);
  }

  // ── 한도 포맷 ──
  function formatLimit(eok) {
    const totalMan = Math.round(eok * 10000);
    const eokPart  = Math.floor(totalMan / 10000);
    const manPart  = totalMan % 10000;
    if (manPart === 0) return `${eokPart}억원`;
    return `${eokPart}억 ${manPart.toLocaleString()}만원`;
  }

  // ── 월납입액 계산 ──
  function calcMonthly(principal, annualRate, method, years) {
    const P = principal;
    const r = annualRate / 12 / 100;
    const n = (years || 40) * 12;
    if (method === 'equal-principal') {
      // 체감식(원금균등): 1회차 = 원금/n + 잔액이자 → 매월 감소
      return (P / n) + (P * r);
    } else if (method === 'annuity') {
      // 원리금균등: 매월 동일
      return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    } else {
      // 체증식: 매월 원금 상환액이 d씩 증가 (d = a, 초회원금 = a)
      // a = 2P / (n*(n+1)),  1회차 납입 = a + P*r → 매월 증가
      const a = 2 * P / (n * (n + 1));
      return a + P * r;
    }
  }

  function formatWon(won) {
    return Math.round(won).toLocaleString() + '원';
  }

  // ══ 기금대출 금리 테이블 ══

  // 보금자리론 기한별 기본금리 (아낌e 기준)
  // 2026-04-29 현재는 4월 공시 금리가 적용 중이며,
  // 2026-05-01부터는 4/24 발표된 5월 금리가 적용됩니다.
  const BOGEUM_RATE_SCHEDULE = [
    {
      effectiveFrom: '2026-04-01',
      label: '2026년 4월 1일 기준',
      rates: { 10:4.45, 15:4.55, 20:4.60, 30:4.65, 40:4.70, 50:4.75 }
    },
    {
      effectiveFrom: '2026-05-01',
      label: '2026년 5월 1일 기준',
      rates: { 10:4.60, 15:4.70, 20:4.75, 30:4.80, 40:4.85, 50:4.90 }
    }
  ];

  function getCurrentBogeumRateSet(now = new Date()) {
    const todayKey = Number(String(now.getFullYear())
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0'));
    let active = BOGEUM_RATE_SCHEDULE[0];
    BOGEUM_RATE_SCHEDULE.forEach(entry => {
      const effectiveKey = Number(entry.effectiveFrom.replace(/-/g, ''));
      if (todayKey >= effectiveKey) active = entry;
    });
    return active;
  }

  function getBogeumBaseRate(years, now = new Date()) {
    const rateSet = getCurrentBogeumRateSet(now);
    return rateSet.rates[years] || rateSet.rates[30];
  }

  function getBogeumRegulationSurcharge(region) {
    return region === '규제지역' ? 0.1 : 0;
  }

  function getBogeumRateLabel(now = new Date()) {
    const minRate = getBogeumBaseRate(10, now);
    const maxRate = getBogeumBaseRate(50, now);
    return `${minRate.toFixed(2)}~${maxRate.toFixed(2)}%`;
  }

  // 디딤돌 소득·기한별 기본금리 — 일반/생애최초 (신혼 아님)
  const DIDIMDOL_RATES_GENERAL = [
    { maxIncome: 2000,  rates: { 10:2.85, 15:2.95, 20:3.05, 30:3.10 } },
    { maxIncome: 4000,  rates: { 10:3.20, 15:3.30, 20:3.40, 30:3.45 } },
    { maxIncome: 7000,  rates: { 10:3.55, 15:3.65, 20:3.75, 30:3.80 } },
    { maxIncome: 8500,  rates: { 10:3.90, 15:4.00, 20:4.10, 30:4.15 } },
  ];
  // 디딤돌 소득·기한별 기본금리 — 신혼가구
  const DIDIMDOL_RATES_NEWLYWED = [
    { maxIncome: 2000,  rates: { 10:2.55, 15:2.65, 20:2.75, 30:2.80 } },
    { maxIncome: 4000,  rates: { 10:2.90, 15:3.00, 20:3.10, 30:3.15 } },
    { maxIncome: 7000,  rates: { 10:3.25, 15:3.35, 20:3.45, 30:3.50 } },
    { maxIncome: 8500,  rates: { 10:3.60, 15:3.70, 20:3.80, 30:3.85 } },
  ];

  // 신생아 특례 소득별 금리 범위 (기존 getNewbornRate 활용 — min 사용)
  // getNewbornRate(income) → { min, max, max30, label }

  function getDidimdolBaseRate(income, household, years) {
    const table = household === '신혼' ? DIDIMDOL_RATES_NEWLYWED : DIDIMDOL_RATES_GENERAL;
    const row = table.find(r => income <= r.maxIncome) || table[table.length - 1];
    return row.rates[years] || row.rates[30];
  }

  // ── 우대금리 카드 HTML 헬퍼 ──
  function prefCardHtml(uid, pref, label, val, checked, colorCls, isExcl, exclGroup, extraAttrs) {
    const selClass = checked ? ' selected-' + colorCls : '';
    const checkSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const dataAttrs = isExcl
      ? 'data-excl="' + exclGroup + '" data-pref="' + pref + '"'
      : 'data-pref="' + pref + '"';
    return '<div class="rate-pref-card' + selClass + '" ' + dataAttrs + (extraAttrs ? ' ' + extraAttrs : '') + ' onclick="togglePrefCard(this,\'' + uid + '\',\'' + colorCls + '\',' + (isExcl?'true':'false') + ')">'
      + '<div class="rate-pref-card-check">' + checkSvg + '</div>'
      + '<span class="rate-pref-card-label">' + label + '</span>'
      + '<span class="rate-pref-card-val">' + val + '</span>'
      + '</div>';
  }

  // ── 우대금리 체크리스트 HTML 생성 ──
  function prefListHtml(uid, product, household, house, region) {
    const isNewlywed   = household === '신혼';
    const isFirstBuyer = house === '생애최초';
    const isLocal      = region === '지방';
    const c            = product === 'bogeumjari' ? 'green' : product === 'newborn' ? 'nb' : 'blue';
    const chevronSvg2 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const selectHtml = (uid2) => '<div class="rate-select-wrap">'
      + '<select data-pref-select onchange="recalcRate(\'' + uid2 + '\')">'
      + '<option value="0">청약저축 — 해당 없음</option>'
      + '<option value="0.3">5년↑ · 60회차↑  -0.3%p</option>'
      + '<option value="0.4">10년↑ · 120회차↑  -0.4%p</option>'
      + '<option value="0.5">15년↑ · 180회차↑  -0.5%p</option>'
      + '</select>'
      + '<span class="rate-select-chevron" style="color:var(--label3)">' + chevronSvg2 + '</span>'
      + '</div>';

    if (product === 'bogeumjari') {
      return '<div class="rate-pref-list" id="pref-' + uid + '">'
        + prefCardHtml(uid,'0.1','전자약정 및 전자등기','-0.1%p',false,c,false,'','data-pref-extra="electronic"')
        + prefCardHtml(uid,'0.1','저소득청년','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'0.3','신혼가구','-0.3%p',isNewlywed,c,true,'bogeum-family-' + uid,'data-optional-excl="true"')
        + prefCardHtml(uid,'0.2','신생아 출산가구','-0.2%p',false,c,true,'bogeum-family-' + uid,'data-optional-excl="true"')
        + prefCardHtml(uid,'0.5','다자녀가구 2자녀','-0.5%p',false,c,false,'')
        + prefCardHtml(uid,'0.7','다자녀가구 3자녀 이상','-0.7%p',false,c,false,'')
        + prefCardHtml(uid,'0.7','사회적 배려층 (한부모·장애인·다문화)','-0.7%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','미분양관리지역 미분양 아파트','-0.2%p',false,c,false,'')
        + prefCardHtml(uid,'0.1','녹색건축물','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'1.0','전세사기피해자','-1.0%p',false,c,false,'')
        + '</div>'
        + '<div class="rate-pref-group-label">표시 기본금리는 아낌e 기준 · 규제지역 선택 시 0.1%p 가산 · 비대면(u) 및 대면(t) 방식은 추가 0.1%p 가산 · 일반 우대 최대 1.0%p · 전자약정/전자등기 0.1%p 별도 중복 가능 · 최종금리 연 1.2% 이상</div>';
    }

    if (product === 'didimdol') {
      const exclItems = [
        { key:'한부모',   pref:'0.5', label:'한부모 가구 (연소득 6천 이하)' },
        { key:'다자녀',   pref:'0.7', label:'다자녀 가구 (3명↑)' },
        { key:'2자녀',    pref:'0.5', label:'2자녀 가구' },
        { key:'1자녀',    pref:'0.3', label:'1자녀 가구' },
        { key:'신혼생애', pref:'0.2', label:'다문화·장애인·신혼·생애최초' },
        { key:'none',     pref:'0.0', label:'해당 없음' },
      ];
      const exclHtml = exclItems.map(function(e) {
        const checked = (e.key==='신혼생애'&&(isNewlywed||isFirstBuyer)) || (e.key==='none'&&!isNewlywed&&!isFirstBuyer);
        return prefCardHtml(uid, e.pref, e.label, e.pref==='0.0'?'—':'-'+e.pref+'%p', checked, c, true, 'excl-'+uid);
      }).join('');

      return '<div class="rate-pref-group-label">중복불가 — 1개 선택</div>'
        + '<div class="rate-pref-list" id="pref-excl-' + uid + '">' + exclHtml + '</div>'
        + '<div class="rate-pref-group-label">중복가능</div>'
        + '<div class="rate-pref-list" id="pref-' + uid + '">'
        + selectHtml(uid)
        + prefCardHtml(uid,'0.1','전자계약 체결 (국토부, ~26.12.31)','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','지방 소재 주택','-0.2%p',isLocal,c,false,'')
        + prefCardHtml(uid,'0.1','대출 30% 이하 신청','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','중도상환 40% 이상','-0.2%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','지방 미분양 주택','-0.2%p',false,c,false,'')
        + '</div>'
        + '<div class="rate-pref-group-label">상한 0.5%p (다자녀 0.7%p) · 최저금리 1.2%</div>';
    }

    if (product === 'newborn') {
      return '<div class="rate-pref-list" id="pref-' + uid + '">'
        + selectHtml(uid)
        + prefCardHtml(uid,'0.2','추가 출산 자녀 1명당','-0.2%p',false,c,false,'')
        + prefCardHtml(uid,'0.1','미성년 자녀 (출생 2년 초과) 1명당','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'0.1','대출 30% 이하 신청','-0.1%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','중도상환 40% 이상','-0.2%p',false,c,false,'')
        + prefCardHtml(uid,'0.2','지방 소재 주택','-0.2%p',isLocal,c,false,'')
        + prefCardHtml(uid,'0.2','지방 미분양 주택','-0.2%p',false,c,false,'')
        + '</div>'
        + '<div class="rate-pref-group-label">최종금리 연 1.2% 이상 · 우대금리 적용은 수탁은행 심사 후 결정</div>';
    }
    return '';
  }

  // ── 우대금리 상한 토스트 ──
  let _prefToastTimer = null;
  function showPrefToast() {
    const toast = document.getElementById('prefToast');
    if (!toast) return;
    if (_prefToastTimer) clearTimeout(_prefToastTimer);
    toast.classList.add('show');
    _prefToastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2200);
  }

  // ── 카드 클릭 핸들러 ──
  function isBogeumjariPrefSection(uid) {
    const section = document.getElementById('tabs-' + uid)?.closest('[data-color]');
    return section?.dataset.color === 'green';
  }

  function getBogeumjariRegularPrefTotal(uid) {
    let total = 0;
    const prefList = document.getElementById('pref-' + uid);
    if (prefList) {
      prefList.querySelectorAll('.rate-pref-card.selected-green').forEach(function(c) {
        if (c.dataset.prefExtra !== 'electronic') total += parseFloat(c.dataset.pref || 0);
      });
    }
    return Math.round(total * 100) / 100;
  }

  function togglePrefCard(card, uid, colorCls, isExcl) {
    if (isExcl) {
      const group = card.dataset.excl;
      const isOptionalExcl = card.dataset.optionalExcl === 'true';
      const wasSelected = card.classList.contains('selected-' + colorCls);
      if (isBogeumjariPrefSection(uid) && !wasSelected) {
        const addVal = card.dataset.prefExtra === 'electronic' ? 0 : parseFloat(card.dataset.pref || 0);
        if (Math.round((getBogeumjariRegularPrefTotal(uid) + addVal) * 100) / 100 > 1.0) {
          showPrefToast();
          return;
        }
      }
      document.querySelectorAll('[data-excl="' + group + '"]').forEach(function(c) {
        c.classList.remove('selected-blue','selected-green','selected-nb');
      });
      if (!isOptionalExcl || !wasSelected) card.classList.add('selected-' + colorCls);
    } else {
      const isBogeumjari = isBogeumjariPrefSection(uid);
      if (isBogeumjari) {
        const isCurrentlySelected = card.classList.contains('selected-' + colorCls);
        const addVal = card.dataset.prefExtra === 'electronic' ? 0 : parseFloat(card.dataset.pref || 0);
        if (!isCurrentlySelected && Math.round((getBogeumjariRegularPrefTotal(uid) + addVal) * 100) / 100 > 1.0) {
          showPrefToast();
          return;
        }
      }
      // 디딤돌 전용 상한 체크 (surcharge 요소 존재 여부로 판별)
      const isDidimdol = !!document.getElementById('surcharge-' + uid);
      if (isDidimdol) {
        const isCurrentlySelected = card.classList.contains('selected-' + colorCls);
        if (!isCurrentlySelected) {
          // 선택 추가 시도 — 상한 초과 여부 미리 계산
          const exclList = document.getElementById('pref-excl-' + uid);
          let prefCap = 0.5;
          if (exclList) {
            const selExcl = exclList.querySelector('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb');
            if (selExcl && parseFloat(selExcl.dataset.pref || 0) >= 0.7) prefCap = 0.7;
          }

          // 현재 중복가능 카드 합산
          let prefTotal = 0;
          const prefList = document.getElementById('pref-' + uid);
          if (prefList) {
            prefList.querySelectorAll('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb').forEach(function(c) {
              prefTotal += parseFloat(c.dataset.pref || 0);
            });
            const selectEl = prefList.querySelector('[data-pref-select]');
            if (selectEl) prefTotal += parseFloat(selectEl.value || 0);
          }
          // exclList 합산
          if (exclList) {
            const selExcl = exclList.querySelector('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb');
            if (selExcl) prefTotal += parseFloat(selExcl.dataset.pref || 0);
          }

          const addVal = parseFloat(card.dataset.pref || 0);
          if (Math.round((prefTotal + addVal) * 100) / 100 > prefCap) {
            showPrefToast();
            return; // 선택 차단
          }
        }
      }
      card.classList.toggle('selected-' + colorCls);
    }
    recalcRate(uid);
  }

  // ── 디딤돌 가산금리 선택 HTML ──
  function surchargeHtml(uid) {
    const checkSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const opts = [
      { val: '0',   label: '해당 없음 (변동금리)' },
      { val: '0.1', label: '5년 단위 변동금리' },
      { val: '0.2', label: '고정금리 10년 적용 (10년 초과 대출)' },
      { val: '0.3', label: '순수 고정금리 / 10년 고정 후 변동 + 대출기간 10년' },
    ];
    const cards = opts.map((o, i) =>
      '<div class="rate-surcharge-card' + (i === 0 ? ' selected-blue' : '') + '" '
      + 'data-surcharge="' + o.val + '" '
      + 'onclick="selectSurcharge(this,\'' + uid + '\')">'
      + '<div class="rate-surcharge-card-check">' + checkSvg + '</div>'
      + '<span class="rate-surcharge-card-label">' + o.label + '</span>'
      + '<span class="rate-surcharge-card-val">' + (o.val === '0' ? '—' : '+' + o.val + '%p') + '</span>'
      + '</div>'
    ).join('');
    return '<div class="rate-surcharge-wrap" id="surcharge-' + uid + '">'
      + '<div class="rate-pref-group-label">금리 방식 (가산금리)</div>'
      + '<div class="rate-surcharge-opts">' + cards + '</div>'
      + '</div>';
  }

  function selectSurcharge(card, uid) {
    const wrap = document.getElementById('surcharge-' + uid);
    if (!wrap) return;
    wrap.querySelectorAll('.rate-surcharge-card').forEach(c =>
      c.classList.remove('selected-blue')
    );
    card.classList.add('selected-blue');
    recalcRate(uid);
  }

  // ── 계산기 HTML 생성 ──
  function rateCalcHtml(uid, product, income, principal, household, house, region, colorCls) {
    const isBogeumjari = product === 'bogeumjari';
    const isDidimdol   = product === 'didimdol';
    const isNewborn    = product === 'newborn';
    const accentColor  = colorCls === 'green' ? 'var(--green)' : colorCls === 'nb' ? '#ff6b9d' : 'var(--accent)';
    const activeClass  = `active-${colorCls}`;

    // 기한 옵션
    const yearOpts = isBogeumjari
      ? [10,15,20,30,40,50]
      : [10,15,20,30];
    const defaultYear = isBogeumjari ? 30 : 30;
    const yearOptsHtml = yearOpts.map(y =>
      `<option value="${y}" ${y===defaultYear?'selected':''}>${y}년</option>`
    ).join('');

    // 기본금리 계산
    let baseRate;
    if (isBogeumjari) {
      baseRate = getBogeumBaseRate(defaultYear);
    } else if (isDidimdol) {
      baseRate = getDidimdolBaseRate(income, household, defaultYear);
    } else {
      baseRate = getNewbornRate(income, defaultYear).rate;
    }
    baseRate = Math.round(baseRate * 100) / 100;
    const initSurcharge = isBogeumjari ? getBogeumRegulationSurcharge(region) : 0;
    const initFinalRate = Math.round((baseRate + initSurcharge) * 100) / 100;

    const initAmt = calcMonthly(principal, initFinalRate, 'annuity', defaultYear);

    const chevronSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    return `
      <div class="rate-calc-section" data-color="${colorCls}" data-uid="${uid}" data-product="${product}" data-region="${region}">
        <div class="rate-dropdown-box" id="yr-box-${uid}">
          <span class="rate-dropdown-label">대출기한</span>
          <div class="rate-dropdown-right">
            <span class="rate-dropdown-val" id="yr-val-${uid}">${defaultYear}년</span>
            <span class="rate-dropdown-chevron">${chevronSvg}</span>
          </div>
          <select class="rate-dropdown-select" id="yr-${uid}" onchange="recalcRateWithYear('${uid}','${product}',${income},'${household}'); document.getElementById('yr-val-${uid}').textContent=this.value+'년'">
            ${yearOptsHtml}
          </select>
        </div>
        ${prefListHtml(uid, product, household, house, region)}
        ${isDidimdol ? surchargeHtml(uid) : ''}
        <div class="rate-summary" id="rs-${uid}">
          <div class="rate-summary-row">
            <span class="rs-label">기본금리</span>
            <span class="rs-val" id="rs-base-${uid}">${baseRate.toFixed(2)}%</span>
          </div>
          <div class="rate-summary-row">
            <span class="rs-label">우대금리</span>
            <span class="rs-val" id="rs-pref-${uid}">0.00%p</span>
          </div>
          ${(isDidimdol || isBogeumjari) ? `<div class="rate-summary-row"><span class="rs-label">가산금리</span><span class="rs-val" id="rs-surcharge-${uid}">+${initSurcharge.toFixed(2)}%p</span></div>` : ''}
          <div class="rate-summary-row rs-final">
            <span class="rs-label">적용금리</span>
            <span class="rs-val" id="rs-final-${uid}" style="color:${accentColor}">${initFinalRate.toFixed(2)}%</span>
          </div>
        </div>
        <div class="repay-method-tabs" id="tabs-${uid}">
          <button class="repay-method-tab ${activeClass}" id="tab-annuity-${uid}" onclick="selectRepayTab('${uid}','annuity','${product}','${colorCls}',${principal})">원리금균등</button>
          <button class="repay-method-tab" id="tab-equal-principal-${uid}" onclick="selectRepayTab('${uid}','equal-principal','${product}','${colorCls}',${principal})">원금균등</button>
          <button class="repay-method-tab" id="tab-increasing-${uid}" onclick="selectRepayTab('${uid}','increasing','${product}','${colorCls}',${principal})">체증식</button>
        </div>
        <div class="monthly-result-row" style="align-items:flex-end">
          <span class="monthly-result-label">첫 달 월 납입액</span>
          <span class="monthly-result-amount" id="mc-amt-${uid}" data-principal="${principal}" style="color:${accentColor};text-align:right">${formatWon(initAmt)}</span>
        </div>
        <div class="monthly-result-note" id="mc-note-${uid}" style="text-align:right">적용금리 ${initFinalRate.toFixed(2)}% · ${defaultYear}년 만기 · 원리금균등 · 1회차 기준</div>
        <button class="sch-open-btn" onclick="openScheduleSheet('${uid}','${colorCls}')" style="color:${accentColor}">
          전체 상환 스케줄 보기 →
        </button>
      </div>`;
  }

  // ── 월별 상환 스케줄 ──
  

  function buildScheduleRows(principal, rate, method, years) {
    var rows = [], rem = principal;
    var n = years * 12, r = rate / 12 / 100;
    if (method === 'annuity') {
      var m = (principal * r * Math.pow(1+r,n)) / (Math.pow(1+r,n) - 1);
      for (var i = 1; i <= n; i++) {
        var int = rem * r, pri = m - int;
        rem -= pri;
        rows.push({ i: i, pri: pri, int: int, t: m, rem: Math.max(rem, 0) });
      }
    } else if (method === 'equal-principal') {
      var pf = principal / n;
      for (var i = 1; i <= n; i++) {
        var int = rem * r, t = pf + int;
        rem -= pf;
        rows.push({ i: i, pri: pf, int: int, t: t, rem: Math.max(rem, 0) });
      }
    } else {
      var a = 2 * principal / (n * (n + 1));
      for (var i = 1; i <= n; i++) {
        var pri = a * i, int = rem * r, t = pri + int;
        rem -= pri;
        rows.push({ i: i, pri: pri, int: int, t: t, rem: Math.max(rem, 0) });
      }
    }
    return rows;
  }

  function fmtMan(won) {
    return Math.round(won / 10000).toLocaleString() + '만';
  }
  function fmtEok(won) {
    return (won / 100000000).toFixed(2) + '억';
  }
  // 억 단위 포맷 (총액용): 1억 미만은 만원, 이상은 "N억 N,NNN만원"
  function fmtEokMan(won) {
    var man = Math.round(won / 10000);
    if (man < 10000) return man.toLocaleString() + '만원';
    var eok = Math.floor(man / 10000);
    var rem = man % 10000;
    return rem > 0 ? eok + '억 ' + rem.toLocaleString() + '만원' : eok + '억원';
  }
  var fmtWon = fmtEokMan;

  // uid별 현재 표시 회차 수 관리
  var scheduleShowCount = {};

  function openScheduleSheet(uid, colorCls) {
    var amtEl = document.querySelector('.rate-calc-section[data-uid="' + uid + '"] [id^="mc-amt-"]');
    if (!amtEl) return;
    var principal = parseFloat(amtEl.dataset.principal || 0);
    if (principal <= 0) return;

    var rateEl = document.getElementById('rs-final-' + uid);
    var rate   = parseFloat(rateEl ? rateEl.textContent : 0);
    if (!rate) return;

    var yrEl  = document.getElementById('yr-' + uid);
    var years = parseInt(yrEl ? yrEl.value : 30) || 30;

    var tabs      = document.getElementById('tabs-' + uid);
    var activeTab = tabs ? tabs.querySelector('[class*="active-"]') : null;
    var method    = 'annuity';
    if (activeTab) {
      if (activeTab.id.includes('equal-principal')) method = 'equal-principal';
      else if (activeTab.id.includes('increasing')) method = 'increasing';
    }
    var methodLabel = method === 'equal-principal' ? '원금균등' : method === 'increasing' ? '체증식' : '원리금균등';

    var rows = buildScheduleRows(principal, rate, method, years);
    var totalPay = rows.reduce(function(s, r) { return s + r.t;   }, 0);
    var totalInt = rows.reduce(function(s, r) { return s + r.int; }, 0);

    // 요약
    document.getElementById('schSumPay').textContent = fmtWon(totalPay);
    document.getElementById('schSumInt').textContent = fmtWon(totalInt);
    document.getElementById('schSubLabel').textContent =
      (principal/100000000).toFixed(1) + '억 · ' + rate.toFixed(2) + '% · ' + years + '년 · ' + methodLabel;

    // 테이블
    document.getElementById('schTableBody').innerHTML = rows.map(function(row) {
      return '<tr>' +
        '<td>' + row.i + '회</td>' +
        '<td class="ssp">' + fmtMan(row.pri) + '</td>' +
        '<td class="ssi">' + fmtMan(row.int) + '</td>' +
        '<td class="sst">' + fmtMan(row.t)   + '</td>' +
        '<td style="color:var(--label3)">' + fmtEok(row.rem) + '</td>' +
      '</tr>';
    }).join('');

    // 바텀시트 오픈
    document.getElementById('schOverlay').classList.add('open');
    var sheet = document.getElementById('schSheet');
    sheet.classList.add('open');
    sheet.querySelector('.sch-sheet-body').scrollTop = 0;
  }

  function closeScheduleSheet() {
    document.getElementById('schOverlay').classList.remove('open');
    document.getElementById('schSheet').classList.remove('open');
  }

  function renderSchedule(uid) {
    // 바텀시트 방식으로 전환 후 인라인 테이블 없음 — 유지만
  }

  function toggleSchedule(uid) {
    // 미사용
  }

  // ── 실시간 재계산 ──
  function recalcRate(uid) {
    const el = document.getElementById('rs-base-' + uid);
    if (!el) return;

    const baseRate = parseFloat(el.textContent);
    const years    = (parseInt(document.getElementById('yr-' + uid)?.value || 30) || 30);

    // 카드형 우대금리 합산
    let prefTotal = 0;
    let prefExtraTotal = 0;

    // 중복불가 카드 (excl 그룹)
    const exclList = document.getElementById('pref-excl-' + uid);
    if (exclList) {
      const selCard = exclList.querySelector('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb');
      if (selCard) prefTotal += parseFloat(selCard.dataset.pref || 0);
    }

    // 중복가능 카드 + 청약저축 드롭다운
    const prefList = document.getElementById('pref-' + uid);
    if (prefList) {
      prefList.querySelectorAll('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb').forEach(card => {
        const cardPref = parseFloat(card.dataset.pref || 0);
        if (card.dataset.prefExtra === 'electronic') prefExtraTotal += cardPref;
        else prefTotal += cardPref;
      });
      const selectEl = prefList.querySelector('[data-pref-select]');
      if (selectEl) prefTotal += parseFloat(selectEl.value || 0);
    }

    // 상품별 우대금리 상한 적용
    const noteEl = document.getElementById('mc-note-' + uid);
    const calcSectionForProduct = document.getElementById('tabs-' + uid)?.closest('[data-color]');
    const isBogeumjari = calcSectionForProduct?.dataset.color === 'green'
      || noteEl?.textContent?.includes('보금자리')
      || document.getElementById('tab-annuity-' + uid)?.classList.contains('active-green');

    // 기한에 따른 기본금리 갱신 — DOM에서 읽기
    const baseEl   = document.getElementById('rs-base-' + uid);
    const curBase  = parseFloat(baseEl?.textContent) || 3.0;

    prefTotal = Math.round(prefTotal * 100) / 100;
    prefExtraTotal = Math.round(prefExtraTotal * 100) / 100;

    if (isBogeumjari) {
      prefTotal = Math.min(prefTotal, 1.0);
      prefTotal = Math.round((prefTotal + prefExtraTotal) * 100) / 100;
    }

    // 디딤돌 우대금리 상한 적용 (일반 0.5%p, 다자녀 0.7%p)
    if (document.getElementById('surcharge-' + uid)) {
      const exclListForCap = document.getElementById('pref-excl-' + uid);
      let prefCap = 0.5;
      if (exclListForCap) {
        const selExcl = exclListForCap.querySelector('.rate-pref-card.selected-blue,.rate-pref-card.selected-green,.rate-pref-card.selected-nb');
        if (selExcl && parseFloat(selExcl.dataset.pref || 0) >= 0.7) prefCap = 0.7;
      }
      prefTotal = Math.min(prefTotal, prefCap);
      prefTotal = Math.round(prefTotal * 100) / 100;
    }

    // 가산금리
    const surchargeWrap = document.getElementById('surcharge-' + uid);
    let surcharge = 0;
    if (surchargeWrap) {
      const selSurcharge = surchargeWrap.querySelector('.rate-surcharge-card.selected-blue');
      if (selSurcharge) surcharge = parseFloat(selSurcharge.dataset.surcharge || 0);
    }
    if (isBogeumjari) {
      const sectionRegion = calcSectionForProduct?.dataset.region || '';
      surcharge += getBogeumRegulationSurcharge(sectionRegion);
    }
    surcharge = Math.round(surcharge * 100) / 100;

    // 최종금리 계산: 기본금리 - 우대금리 + 가산금리, 최저 1.2%
    let finalRate = Math.max(curBase - prefTotal + surcharge, 1.2);
    finalRate = Math.round(finalRate * 100) / 100;

    // 요약 갱신
    document.getElementById('rs-pref-' + uid).textContent = '-' + prefTotal.toFixed(2) + '%p';
    const surchargeEl = document.getElementById('rs-surcharge-' + uid);
    if (surchargeEl) surchargeEl.textContent = '+' + surcharge.toFixed(2) + '%p';
    document.getElementById('rs-final-' + uid).textContent = finalRate.toFixed(2) + '%';

    // 현재 선택된 상환방식 찾기
    const tabs = document.getElementById('tabs-' + uid);
    let method = 'annuity';
    if (tabs) {
      const activeTab = tabs.querySelector('.repay-method-tab.active-blue, .repay-method-tab.active-green, .repay-method-tab.active-nb');
      if (activeTab) {
        if (activeTab.id.includes('equal-principal')) method = 'equal-principal';
        else if (activeTab.id.includes('increasing'))    method = 'increasing';
      }
    }

    // 체증식 50년 불가 처리 (보금자리론)
    const incBtn = document.getElementById('tab-increasing-' + uid);
    if (incBtn) {
      const isInc50 = years === 50;
      incBtn.disabled = isInc50;
      if (isInc50 && method === 'increasing') {
        method = 'annuity';
        const tabs = document.getElementById('tabs-' + uid);
        if (tabs) {
          tabs.querySelectorAll('.repay-method-tab').forEach(b =>
            b.classList.remove('active-blue','active-green','active-nb')
          );
          const annuityBtn = document.getElementById('tab-annuity-' + uid);
          if (annuityBtn) {
            // data-color 속성에서 colorCls 읽기
            const section = annuityBtn.closest('[data-color]');
            const colorCls = section ? section.dataset.color : 'blue';
            annuityBtn.classList.add('active-' + colorCls);
          }
        }
      }
    }

    // 월납입 재계산
    const amtEl = document.getElementById('mc-amt-' + uid);
    if (amtEl) {
      const principal = parseFloat(amtEl.dataset.principal || 0);
      if (principal > 0) {
        const amt = calcMonthly(principal, finalRate, method, years);
        amtEl.textContent = formatWon(amt);
      }
    }
    if (noteEl) {
      const methodLabel = method === 'equal-principal' ? '원금균등' : method === 'increasing' ? '체증식' : '원리금균등';
      noteEl.textContent = `적용금리 ${finalRate.toFixed(2)}% · ${years}년 만기 · ${methodLabel} · 1회차 기준`;
    }

    // DTI 재계산 (상품별)
    const calcSection = document.getElementById('tabs-' + uid)?.closest('[data-color]');
    if (calcSection) {
      const color = calcSection.dataset.color;
      if (color === 'green') recalcDti('green_dti');
      else if (color === 'blue') recalcDti('blue_dti');
      else if (color === 'nb') recalcDti('nb_dti');
    }

    // 상환 스케줄 갱신 (초기화 후 렌더)
    scheduleShowCount[uid] = 12;
    renderSchedule(uid);
  }

  // 기한 변경 시 기본금리도 갱신 (디딤돌/신생아 기한별 금리 반영)
  function recalcRateWithYear(uid, product, income, household) {
    const years   = (parseInt(document.getElementById('yr-' + uid)?.value || 30) || 30);
    const baseEl  = document.getElementById('rs-base-' + uid);
    if (!baseEl) return;

    let newBase;
    if (product === 'bogeumjari') {
      newBase = getBogeumBaseRate(years);
    } else if (product === 'didimdol') {
      newBase = getDidimdolBaseRate(income, household, years);
    } else {
      // 신생아: 기한별 금리 적용
      newBase = getNewbornRate(income, years).rate;
    }
    newBase = Math.round(newBase * 100) / 100;
    baseEl.textContent = newBase.toFixed(2) + '%';
    recalcRate(uid);
  }

  // 상환방식 탭 전환
  function selectRepayTab(uid, method, product, colorCls, principal) {
    const years    = (parseInt(document.getElementById('yr-' + uid)?.value || 30) || 30);
    if (method === 'increasing' && years === 50) return; // 체증식 50년 불가
    const finalRate = parseFloat(document.getElementById('rs-final-' + uid)?.textContent || 3.0);
    const tabs = document.getElementById('tabs-' + uid);
    if (tabs) {
      tabs.querySelectorAll('.repay-method-tab').forEach(b => {
        b.classList.remove('active-blue','active-green','active-nb');
      });
      document.getElementById(`tab-${method}-${uid}`)?.classList.add(`active-${colorCls}`);
    }
    const amt   = calcMonthly(principal, finalRate, method, years);
    const amtEl = document.getElementById('mc-amt-' + uid);
    if (amtEl) amtEl.textContent = formatWon(amt);
    const noteEl = document.getElementById('mc-note-' + uid);
    if (noteEl) {
      const methodLabel = method === 'equal-principal' ? '원금균등' : method === 'increasing' ? '체증식' : '원리금균등';
      noteEl.textContent = `적용금리 ${finalRate.toFixed(2)}% · ${years}년 만기 · ${methodLabel} · 1회차 기준`;
    }

    // DTI 재계산 (상품별)
    var dtiUid = colorCls === 'green' ? 'green_dti' : colorCls === 'blue' ? 'blue_dti' : colorCls === 'nb' ? 'nb_dti' : null;
    if (dtiUid && document.getElementById('dti-card-' + dtiUid)) recalcDti(dtiUid);

    // 상환 스케줄 갱신 (초기화 후 렌더)
    scheduleShowCount[uid] = 12;
    renderSchedule(uid);
  }

  const ROOM_DEDUCTION_AMOUNTS = {
    seoul: 0.55,
    metro: 0.48,
    city: 0.28,
    other: 0.25
  };

  const ROOM_DEDUCTION_LABELS = {
    seoul: '서울',
    metro: '수도권·세종·용인·화성·김포',
    city: '광역시·안산·광주 등',
    other: '기타 지역'
  };

  function formatRoomDeductionAmount(eok) {
    if (eok < 1) return Math.round(eok * 10000).toLocaleString() + '만원';
    return formatLimit(eok);
  }

  function getDefaultRoomRegionKey(region) {
    if (region === '규제지역') return 'seoul';
    if (region === '수도권') return 'metro';
    return 'other';
  }

  function isRoomDeductionMetroScope(regionKey) {
    return regionKey === 'seoul' || regionKey === 'metro';
  }

  function getRoomDeductionState(product, baseLimit, income, price, house, region, regionKey, desiredOn) {
    const key = regionKey || getDefaultRoomRegionKey(region);
    const rawDeduction = Math.min(ROOM_DEDUCTION_AMOUNTS[key] || 0, price * 0.5);
    const lowIncomeHome = income <= 4000 && price <= 3;
    let checked = false;
    let locked = true;
    let note = '';

    if (product === 'didimdol') {
      const mandatory = isRoomDeductionMetroScope(key) && !lowIncomeHome;
      checked = mandatory;
      locked = true;
      note = mandatory
        ? '수도권 소재 아파트 구입은 방공제 의무 적용 대상입니다. 주택유형은 아파트 기준으로 계산합니다.'
        : lowIncomeHome
          ? '연소득 4천만원 이하 가구가 3억원 이하 주택을 구입하는 예외 대상으로 방공제를 적용하지 않습니다.'
          : '지방 또는 비수도권 분류는 디딤돌 관리방안의 방공제 의무 적용 대상에서 제외됩니다.';
    } else if (product === 'newborn') {
      const forced = price > 6;
      locked = forced;
      checked = forced ? true : !!desiredOn;
      note = forced
        ? '주택가격 6억원 초과 구간은 방공제를 적용한 예상 한도로 표시합니다.'
        : '생애최초 또는 HF 보증 가능 구간은 방공제 면제 가능성이 있어 토글로 한도 차이를 확인할 수 있습니다.';
    }

    const deduction = checked ? rawDeduction : 0;
    return {
      key,
      checked,
      locked,
      rawDeduction,
      deduction,
      finalLimit: Math.max(0, baseLimit - deduction),
      note
    };
  }

  function roomDeductionHtml(uid, product, state, baseLimit, price, income, house, region) {
    if (product !== 'didimdol' && product !== 'newborn') return '';
    const colorCls = product === 'newborn' ? 'nb' : 'blue';
    const opts = Object.keys(ROOM_DEDUCTION_LABELS).map(function(key) {
      return '<option value="' + key + '"' + (state.key === key ? ' selected' : '') + '>'
        + ROOM_DEDUCTION_LABELS[key] + ' · ' + formatRoomDeductionAmount(ROOM_DEDUCTION_AMOUNTS[key]) + '</option>';
    }).join('');
    return '<div class="room-deduction-box" id="room-box-' + uid + '" data-room-card="true" data-product="' + product
      + '" data-base-limit="' + baseLimit + '" data-price="' + price + '" data-income="' + income
      + '" data-house="' + house + '" data-region="' + region + '">'
      + '<div class="room-deduction-head">'
      + '<div><div class="room-deduction-title">방공제 반영</div><div class="room-deduction-sub">임대차 없음 · 아파트 1개 방 기준</div></div>'
      + '<label class="room-toggle ' + colorCls + '"><input id="room-toggle-' + uid + '" type="checkbox" onchange="updateRoomDeduction(\'' + uid + '\')" '
      + (state.checked ? 'checked ' : '') + (state.locked ? 'disabled ' : '') + '><span class="room-toggle-track"></span></label>'
      + '</div>'
      + '<select class="room-deduction-select" id="room-region-' + uid + '" onchange="updateRoomDeduction(\'' + uid + '\')">' + opts + '</select>'
      + '<div class="room-deduction-row"><span>방공제 차감 전</span><span id="room-base-' + uid + '">' + formatLimit(baseLimit) + '</span></div>'
      + '<div class="room-deduction-row"><span>방공제 금액</span><span id="room-deduct-' + uid + '">'
      + (state.deduction > 0 ? '-' + formatRoomDeductionAmount(state.deduction) : '미적용') + '</span></div>'
      + '<div class="room-deduction-row final ' + colorCls + '"><span>차감 후 예상 한도</span><span id="room-final-' + uid + '">' + formatLimit(state.finalLimit) + '</span></div>'
      + '<div class="room-deduction-note" id="room-note-' + uid + '">' + state.note + '</div>'
      + '</div>';
  }

  function applyRoomLimitToRate(uid, finalLimit) {
    const amtEl = document.getElementById('mc-amt-' + uid);
    if (!amtEl) return;
    amtEl.dataset.principal = String(finalLimit * 100000000);
    recalcRate(uid);
  }

  function updateRoomDeduction(uid) {
    const box = document.getElementById('room-box-' + uid);
    if (!box) return;
    const toggle = document.getElementById('room-toggle-' + uid);
    const regionEl = document.getElementById('room-region-' + uid);
    const state = getRoomDeductionState(
      box.dataset.product,
      parseFloat(box.dataset.baseLimit || 0),
      parseFloat(box.dataset.income || 0),
      parseFloat(box.dataset.price || 0),
      box.dataset.house,
      box.dataset.region,
      regionEl ? regionEl.value : null,
      toggle ? toggle.checked : false
    );

    if (toggle) {
      toggle.disabled = state.locked;
      toggle.checked = state.checked;
    }

    const deductEl = document.getElementById('room-deduct-' + uid);
    const finalEl = document.getElementById('room-final-' + uid);
    const noteEl = document.getElementById('room-note-' + uid);
    if (deductEl) deductEl.textContent = state.deduction > 0 ? '-' + formatRoomDeductionAmount(state.deduction) : '미적용';
    if (finalEl) finalEl.textContent = formatLimit(state.finalLimit);
    if (noteEl) noteEl.textContent = state.note;

    const card = box.closest('.limit-detail-card');
    const amountEl = card ? card.querySelector('[data-room-final-amount]') : null;
    if (amountEl) amountEl.textContent = formatLimit(state.finalLimit);
    document.querySelectorAll('[data-room-sync="' + box.dataset.product + '"]').forEach(function(el) {
      el.textContent = formatLimit(state.finalLimit);
    });

    applyRoomLimitToRate(uid, state.finalLimit);
    const dtiUid = box.dataset.product === 'newborn' ? 'nb_dti' : 'blue_dti';
    if (document.getElementById('dti-card-' + dtiUid)) recalcDti(dtiUid);
  }

  function limitCardHtml(colorCls, ltvLimit, maxLimit, finalLimit, price, household, house, children, region, income) {
    const ltvApplied    = ltvLimit <= maxLimit;
    const appliedCls    = ltvApplied    ? ` applied${colorCls === 'green' ? ' green' : ''}` : '';
    const maxAppliedCls = !ltvApplied   ? ` applied${colorCls === 'green' ? ' green' : ''}` : '';
    const houseLabel    = household === '신혼' || children === '2명이상' ? '신혼·다자녀'
                        : house === '생애최초' ? '생애최초' : '일반';
    const reasonText = ltvApplied
      ? `LTV ${Math.round(ltvLimit/price*100)}% 기준 적용 · 주택가격 <em>${price}억 × ${Math.round(ltvLimit/price*100)}%</em> = <em>${formatLimit(ltvLimit)}</em>`
      : `상품 한도 기준 적용 · <em>${houseLabel}</em> 가구 최대 한도 <em>${formatLimit(maxLimit)}</em>`;

    const uid          = colorCls + '_' + Math.random().toString(36).slice(2, 7);
    const product      = colorCls === 'blue' ? 'didimdol' : 'bogeumjari';
    const roomState    = product === 'didimdol' ? getRoomDeductionState(product, finalLimit, income, price, house, region) : null;
    const displayLimit = roomState ? roomState.finalLimit : finalLimit;
    const principalWon = displayLimit * 100000000;

    return `
        <div class="limit-detail-card ${colorCls}-top">
          <div class="limit-detail-label">예상 대출 한도</div>
          <div class="limit-detail-amount ${colorCls}" data-room-final-amount>${formatLimit(displayLimit)}</div>
          <div class="limit-breakdown">
            <div class="limit-breakdown-item">
              <span class="breakdown-label">LTV ${Math.round(ltvLimit/price*100)}% 적용</span>
              <span class="breakdown-val${appliedCls}">${formatLimit(ltvLimit)}</span>
            </div>
            <div class="limit-breakdown-item">
              <span class="breakdown-label">상품 최대 한도</span>
              <span class="breakdown-val${maxAppliedCls}">${formatLimit(maxLimit)}</span>
            </div>
          </div>
          <div class="limit-applied-note">${reasonText}</div>
          <div class="limit-reason">LTV 계산은 생애최초와 규제지역을 반영해 자동 계산되며, 개인별 신용 및 소득에 따라 달라질 수 있습니다. 보다 자세한 산정내역은 한국주택금융공사에서 꼭 확인이 필요합니다.</div>
          ${roomState ? roomDeductionHtml(uid, product, roomState, finalLimit, price, income, house, region) : ''}
          ${colorCls === 'green' && house === '생애최초' && region !== '규제지역' && region !== '수도권' ? `
          <div class="ltv80-notice">
            <div class="ltv80-notice-icon">⚠️</div>
            <div class="ltv80-notice-text"><strong>LTV 80% 적용 안내</strong><br>특례구입자금 보증 가입 및 아파트인 경우 LTV 80%까지 가능합니다. 정확한 적용 기준은 심사를 통해 결정되며, 이 수치는 참고용 예측치입니다.</div>
          </div>` : ''}
          ${rateCalcHtml(uid, product, income, principalWon, household, house, region, colorCls)}
        </div>`;
  }

  // ── 시중은행 전용 주의사항 ──
  function bankNoticeHtml() {
    const items = [
      '표시 금리는 전월 취급 평균금리 기준이며, 실제 금리는 신용도·소득·담보 심사 후 결정됩니다.',
      '월납입 추정액은 원리금균등상환 방식 참고용 수치로 실제 납입액과 다를 수 있습니다.',
      '혼합금리(일정 기간 고정 후 변동)는 고정금리로 분류됩니다.',
      '규제지역 여부 및 생애최초 여부에 따라 LTV가 달라질 수 있으며, 실제 규제 적용과 다를 수 있습니다.',
      'DSR 시뮬레이션은 무대출 상황 기준의 참고용 결과입니다. 최종 대출 가능 여부 및 한도는 금융사 심사로 결정되며, 기존 대출이 있을 경우 실제 한도는 더 낮거나 심사가 불가할 수 있습니다.',
      'DSR 시뮬레이션은 모든 대출이 없는 무대출 상황을 가정합니다. 기존 주담대·신용대출·2금융권 대출이 있다면 실제 대출 가능 금액은 더 적거나 심사가 불가할 수 있으며, 반드시 수탁 은행 상담이 필요합니다.',
      '고정금리는 혼합형(5년 고정, 약 1.2%)·주기형(5년 이상 고정, 약 0.6%) 유형에 따라 스트레스 금리 가산 범위가 다르며, 실제 금융사 심사 조건과 다를 수 있습니다. 참고용으로만 사용해 주세요.',
    ];
    return `
      <div class="group-label">꼭 확인해 주세요</div>
      <div class="notice-list">
        ${items.map(t => `<div class="notice-item">${t}</div>`).join('')}
      </div>`;
  }

  // ── 공통: 주의사항 bullet ──
  function noticeHtml() {
    return `
        <div class="group-label">주의사항</div>
        <div class="notice-list">
          <div class="notice-item">자세한 조건은 <strong>주택금융공사 업무처리기준</strong> 확인 필수</div>
        </div>`;
  }

  // ── LOGIC ──
  function newbornLimitCardHtml(ltvLimit, maxLimit, finalLimit, price, house, rate30, income, household, region) {
    const ltvPct   = Math.round(ltvLimit / price * 100);
    const ltvLabel = ltvPct + '%';
    const ltvApplied = ltvLimit <= maxLimit;
    const appliedCls = ltvApplied ? ' applied' : '';
    const maxAppliedCls = !ltvApplied ? ' applied' : '';
    const reasonText = ltvApplied
      ? 'LTV ' + ltvLabel + ' 기준 · 주택가격 <em>' + price + '억 × ' + ltvLabel + '</em> = <em>' + formatLimit(ltvLimit) + '</em>'
      : '상품 한도 기준 · 최대 <em>' + formatLimit(maxLimit) + '</em>';

    const uid = 'nb_' + Math.random().toString(36).slice(2, 7);
    const roomState = getRoomDeductionState('newborn', finalLimit, income, price, house, region);
    const displayLimit = roomState.finalLimit;
    const principalWon = displayLimit * 100000000;

    return '<div class="limit-detail-card" style="border-top:3px solid #ff6b9d">'
      + '<div class="limit-detail-label">예상 대출 한도</div>'
      + '<div class="limit-detail-amount" style="color:#ff6b9d" data-room-final-amount>' + formatLimit(displayLimit) + '</div>'
      + '<div class="limit-breakdown">'
      + '<div class="limit-breakdown-item">'
      + '<span class="breakdown-label">LTV ' + ltvLabel + ' 적용</span>'
      + '<span class="breakdown-val' + appliedCls + '">' + formatLimit(ltvLimit) + '</span>'
      + '</div>'
      + '<div class="limit-breakdown-item">'
      + '<span class="breakdown-label">상품 최대 한도</span>'
      + '<span class="breakdown-val' + maxAppliedCls + '">' + formatLimit(maxLimit) + '</span>'
      + '</div>'
      + '</div>'
      + '<div class="limit-applied-note">' + reasonText + '</div>'
      + '<div class="limit-reason">LTV 계산은 생애최초와 규제지역을 반영해 자동 계산되며, 개인별 신용 및 소득에 따라 달라질 수 있습니다. 보다 자세한 산정내역은 기금e든든에서 꼭 확인이 필요합니다.</div>'
      + roomDeductionHtml(uid, 'newborn', roomState, finalLimit, price, income, house, region)
      + rateCalcHtml(uid, 'newborn', income, principalWon, household, house, region, 'nb')
      + '</div>';
  }

  function newbornRateTableHtml(income) {
    let tbody = '';
    NEWBORN_RATE_TABLE.forEach(function(r) {
      const mine = income <= r.maxIncome && (NEWBORN_RATE_TABLE.indexOf(r) === 0 || income > NEWBORN_RATE_TABLE[NEWBORN_RATE_TABLE.indexOf(r)-1].maxIncome);
      const bg = mine ? 'background:rgba(255,107,157,0.15)' : '';
      const fw = mine ? 'font-weight:700;color:#ff6b9d' : 'color:var(--label2)';
      tbody += '<tr style="' + bg + '">'
        + '<td style="padding:7px 8px;' + fw + '">' + r.label + (mine ? ' ◀' : '') + '</td>'
        + '<td style="padding:7px 8px;text-align:center;' + fw + '">' + r.r10 + '%</td>'
        + '<td style="padding:7px 8px;text-align:center;' + fw + '">' + r.r20 + '%</td>'
        + '<td style="padding:7px 8px;text-align:center;' + fw + '">' + r.r30 + '%</td>'
        + '</tr>';
    });
    return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="background:rgba(255,107,157,0.1)">'
      + '<th style="padding:8px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.1);color:var(--label2)">소득구간</th>'
      + '<th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);color:var(--label2)">10년</th>'
      + '<th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);color:var(--label2)">20년</th>'
      + '<th style="padding:8px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1);color:var(--label2)">30년</th>'
      + '</tr></thead>'
      + '<tbody>' + tbody + '</tbody>'
      + '</table></div>';
  }

  // 신생아특례 금리표 (소득 만원 기준, 기한별)
  // rows: [label, r10, r20, r30, condition]
  const NEWBORN_RATE_TABLE = [
    { label:'~2천만원',          r10:1.80, r20:2.00, r30:2.05, maxIncome:2000  },
    { label:'2천~4천만원',       r10:2.15, r20:2.35, r30:2.40, maxIncome:4000  },
    { label:'4천~6천만원',       r10:2.40, r20:2.60, r30:2.65, maxIncome:6000  },
    { label:'6천~8.5천만원',     r10:2.65, r20:2.85, r30:2.90, maxIncome:8500  },
    { label:'8.5천~1억원',       r10:2.90, r20:3.10, r30:3.20, maxIncome:10000 },
    { label:'1억~1.3억원',       r10:3.20, r20:3.40, r30:3.50, maxIncome:13000 },
    { label:'(맞벌이)1.3~1.5억', r10:3.50, r20:3.70, r30:3.80, maxIncome:15000 },
    { label:'(맞벌이)1.5~1.7억', r10:3.85, r20:4.05, r30:4.15, maxIncome:17000 },
    { label:'(맞벌이)1.7~2억',   r10:4.20, r20:4.40, r30:4.50, maxIncome:Infinity },
  ];

  function getNewbornRate(incomeMM, years) {
    const row = NEWBORN_RATE_TABLE.find(r => incomeMM <= r.maxIncome) || NEWBORN_RATE_TABLE[NEWBORN_RATE_TABLE.length - 1];
    const y = years || 30;
    const rate = y <= 10 ? row.r10 : y <= 20 ? row.r20 : row.r30;
    return { min: row.r10, max: row.r30, max30: row.r30, rate, label: row.label };
  }

  function buildNewbornFailHtml(income, asset, price, house, nbHouseOk, nbIncomeOk, nbAssetOk, nbPriceOk, tagsOnly,
                                 dHouseOk, dAssetOk, dIncomeOk, dPriceOk, dIncomeLimit, dPriceLimit,
                                 bHouseOk, bIncomeOk, bPriceOk, bIncomeLimit) {
    var failNb = [];
    if (!nbHouseOk)  failNb.push('주택상황 (' + house + ') — 무주택·생애최초·1주택(대환 목적)만 해당');
    if (!nbIncomeOk) failNb.push('소득 ' + income.toLocaleString() + '만 > 20,000만 (2억)');
    if (!nbAssetOk)  failNb.push('순자산 ' + asset + '억 > 5.11억');
    if (!nbPriceOk)  failNb.push('주택가격 ' + price + '억 > 9억');
    var failTags = failNb.map(function(r) { return '<span class="tag fail">✗ ' + r + '</span>'; }).join('');
    if (tagsOnly) return failTags;

    // 디딤돌 미해당 사유
    var failD = buildFailD(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house);
    var failDTags = failD.map(function(r) { return '<span class="tag fail">✗ ' + r + '</span>'; }).join('');

    // 보금자리론 미해당 사유
    var failB = [];
    if (!bHouseOk)  failB.push('주택상황 (' + house + ') — 1주택 이상은 해당 없음');
    if (!bIncomeOk) failB.push('소득 ' + income.toLocaleString() + '만 > ' + bIncomeLimit.toLocaleString() + '만');
    if (!bPriceOk)  failB.push('주택가격 ' + price + '억 > 6억');
    var failBTags = failB.map(function(r) { return '<span class="tag fail">✗ ' + r + '</span>'; }).join('');

    return '<div class="result-header-area"><div class="result-badge-wrap">'
      + '<div class="result-icon grey">🏦</div>'
      + '<div><div class="result-option-label grey">ALTERNATIVE</div><div class="result-title">시중은행</div></div>'
      + '</div></div>'
      + '<div class="result-tagline grey-border">입력하신 조건은 주택기금 대출 요건을 충족하지 않습니다. 시중은행을 알아봐주세요.</div>'
      + '<div class="result-spacer"></div>'
      + '<div class="group-label">자격 검토</div>'
      + '<div class="result-group">'
      + '<div class="tag-section-label">신생아 특례 미해당 사유</div><div class="tags">' + failTags + '</div>'
      + '<div style="height:8px"></div>'
      + '<div class="tag-section-label">디딤돌 미해당 사유</div><div class="tags">' + failDTags + '</div>'
      + '<div style="height:8px"></div>'
      + '<div class="tag-section-label">보금자리론 미해당 사유</div><div class="tags">' + failBTags + '</div>'
      + '</div>'
      + '<div class="result-spacer"></div>'
      + noticeHtml()
      + '<div class="result-spacer-sm"></div>'
      + '<button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>';
  }

  function buildNewbornHtml(o) {
    var newbornOk = o.newbornOk, didimdolOk = o.didimdolOk, bogeumjariOk = o.bogeumjariOk;
    var income = o.income, price = o.price, asset = o.asset;
    var household = o.household, house = o.house, children = o.children, region = o.region, otherLoanInterest = o.otherLoanInterest || 0;
    var nbRate = o.nbRate, nbLtvLimit = o.nbLtvLimit, nbMaxLimit = o.nbMaxLimit, nbFinalLimit = o.nbFinalLimit;
    var nbHouseOk = o.nbHouseOk, nbIncomeOk = o.nbIncomeOk, nbAssetOk = o.nbAssetOk, nbPriceOk = o.nbPriceOk;
    var dLtvLimit = o.dLtvLimit, dMaxLimit = o.dMaxLimit, dFinalLimit = o.dFinalLimit;
    var dIncomeLimit = o.dIncomeLimit, dPriceLimit = o.dPriceLimit;
    var bLtvLimit = o.bLtvLimit, bMaxLimit = o.bMaxLimit, bFinalLimit = o.bFinalLimit, bIncomeLimit = o.bIncomeLimit;
    var rateInfo = nbRate || getNewbornRate(income);
    var nbDisplayLimit = getRoomDeductionState('newborn', nbFinalLimit, income, price, house, region).finalLimit;
    var dDisplayLimit = getRoomDeductionState('didimdol', dFinalLimit, income, price, house, region).finalLimit;

    var tabs = [];
    if (newbornOk)    tabs.push('newborn');
    if (didimdolOk)   tabs.push('didimdol');
    if (bogeumjariOk) tabs.push('bogeumjari');
    var firstTab = tabs[0];

    // 탭 버튼 HTML
    function makeTabBtn(id, badge, name, limit, colorCls) {
      var isFirst = id === firstTab;
      var cls = 'result-tab' + (isFirst && colorCls !== 'nb' ? ' active-' + colorCls : '');
      var styleAttr = (isFirst && colorCls === 'nb') ? ' style="background:rgba(255,107,157,0.15);border-color:#ff6b9d;color:#ff6b9d"' : '';
      var badgeStyle = colorCls === 'nb' ? ' style="background:rgba(255,107,157,0.15);color:#ff6b9d"' : '';
      var badgeCls = colorCls === 'nb' ? 'result-tab-badge' : 'result-tab-badge ' + colorCls;
      return '<button class="' + cls + '"' + styleAttr + ' data-tab="' + id + '" onclick="switchTab3(this.dataset.tab)">'
        + '<span class="' + badgeCls + '"' + badgeStyle + '>' + badge + '</span>'
        + '<span class="result-tab-name">' + name + '</span>'
        + '<span class="result-tab-limit">' + limit + '</span>'
        + '</button>';
    }

    var tabsHtml = '<div class="result-tabs" id="tabs3-wrap">';
    if (newbornOk)    tabsHtml += makeTabBtn('newborn',    '금리 최저', '신생아 디딤돌',  '<span data-room-sync="newborn">' + formatLimit(nbDisplayLimit) + '</span>', 'nb');
    if (didimdolOk)   tabsHtml += makeTabBtn('didimdol',   newbornOk ? '차선책' : '금리 낮음', '디딤돌 대출', '<span data-room-sync="didimdol">' + formatLimit(dDisplayLimit) + '</span>', 'blue');
    if (bogeumjariOk) tabsHtml += makeTabBtn('bogeumjari', (newbornOk || didimdolOk) ? '한도 우위' : '추천', '보금자리론', formatLimit(bFinalLimit), 'green');
    tabsHtml += '</div>';

    // 신생아 패널
    var paneNewborn = '';
    if (newbornOk) {
      paneNewborn = '<div class="tab-pane3' + (firstTab === 'newborn' ? ' active' : '') + '" id="pane3-newborn">'
        + '<div class="newborn-hero"><div class="newborn-hero-badge">👶 신생아 특례 핵심 혜택</div><div class="newborn-hero-text">최저 1.8% 특례금리</div><div class="newborn-hero-sub">기본 5년 적용 · 추가 출산 시 1명당 5년 연장 (최장 15년)<br>시중 어디서도 볼 수 없는 파격적인 금리예요.</div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상품 정보</div>'
        + '<div class="result-group" style="padding-top:0;padding-bottom:0"><div class="rate-limit-row">'
        + '<div class="info-pill"><span class="info-pill-label">적용 금리</span><span class="info-pill-val" style="color:#ff6b9d">' + rateInfo.min + '~' + rateInfo.max + '%</span></div>'
        + '<div class="info-pill"><span class="info-pill-label">예상 한도</span><span class="info-pill-val" style="color:#ff6b9d" data-room-sync="newborn">' + formatLimit(nbDisplayLimit) + '</span></div>'
        + '</div></div>'
        + '<div class="result-spacer-sm"></div>'
        + newbornLimitCardHtml(nbLtvLimit, nbMaxLimit, nbFinalLimit, price, house, nbRate.max30, income, household, region)
        + bogeumDtiCardHtml('nb_dti', income, price, region, house, nbFinalLimit, getNewbornRate(income, 30).rate, 30, otherLoanInterest, 60)
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">충족 조건</div>'
        + '<div class="result-group"><div class="tag-section"><div class="tags">'
        + '<span class="tag pass">✓ 주택상황 (' + house + ')</span>'
        + '<span class="tag pass">✓ 소득 ' + income.toLocaleString() + '만 ≤ 20,000만</span>'
        + '<span class="tag pass">✓ 순자산 ' + asset + '억 ≤ 5.11억</span>'
        + '<span class="tag pass">✓ 주택가격 ' + price + '억 ≤ 9억</span>'
        + '</div></div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">소득별 금리 (소득구간: ' + rateInfo.label + ')</div>'
        + '<div class="result-group">' + newbornRateTableHtml(income)
        + '<div class="limit-reason" style="margin-top:8px">※ 특례금리 기본 5년 · 추가출산 +5년(최장 15년) · 취급은행: 우리·신한·국민·농협·하나</div></div>'
        + '<div class="result-spacer"></div>'
        + newbornFaqHtml()
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상환방식</div>'
        + repayHtml('didimdol')
        + '</div>';
    }

    // 디딤돌 패널
    var paneDidimdol = '';
    if (didimdolOk) {
      paneDidimdol = '<div class="tab-pane3' + (firstTab === 'didimdol' ? ' active' : '') + '" id="pane3-didimdol">'
        + '<div class="didimdol-hero"><div class="didimdol-hero-badge">✨ 디딤돌 핵심 혜택</div><div class="didimdol-hero-text">시중 어디에서도 볼 수 없는 파격적인 금리예요</div><div class="didimdol-hero-sub">정부 지원 정책 상품으로 시중 주담대보다 훨씬 낮은 금리를 받을 수 있습니다.</div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상품 정보</div>'
        + '<div class="result-group" style="padding-top:0;padding-bottom:0"><div class="rate-limit-row">'
        + '<div class="info-pill"><span class="info-pill-label">적용 금리</span><span class="info-pill-val blue">' + getDidimdolRateLabel(household, house) + '</span></div>'
        + '<div class="info-pill"><span class="info-pill-label">예상 한도</span><span class="info-pill-val blue" data-room-sync="didimdol">' + formatLimit(dDisplayLimit) + '</span></div>'
        + '</div></div>'
        + '<div class="result-spacer-sm"></div>'
        + limitCardHtml('blue', dLtvLimit, dMaxLimit, dFinalLimit, price, household, house, children, region, income)
        + bogeumDtiCardHtml('blue_dti', income, price, region, house, dFinalLimit, getDidimdolBaseRate(income, household, 30), 30, otherLoanInterest, 60)
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">충족 조건</div>'
        + '<div class="result-group"><div class="tag-section"><div class="tags">'
        + '<span class="tag pass">✓ 주택상황 (' + house + ')</span>'
        + '<span class="tag pass">✓ 순자산 ' + asset + '억 ≤ 5.11억</span>'
        + '<span class="tag pass">✓ 소득 ' + income.toLocaleString() + '만 ≤ ' + dIncomeLimit.toLocaleString() + '만</span>'
        + '<span class="tag pass">✓ 주택가격 ' + price + '억 ≤ ' + dPriceLimit + '억</span>'
        + '</div></div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상환방식</div>'
        + repayHtml('didimdol')
        + '</div>';
    }

    // 보금자리론 패널
    var paneBogeumjari = '';
    if (bogeumjariOk) {
      paneBogeumjari = '<div class="tab-pane3' + (firstTab === 'bogeumjari' ? ' active' : '') + '" id="pane3-bogeumjari">'
        + '<div class="bogeumjari-hero"><div class="bogeumjari-hero-badge">✨ 보금자리론 핵심 혜택</div><div class="bogeumjari-hero-text">DSR을 보지 않아요</div><div class="bogeumjari-hero-sub">소득이 적어도 많은 대출을 고정금리로 받을 수 있습니다.<br>총부채원리금상환비율(DSR) 규제 적용 제외 상품이에요.</div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상품 정보</div>'
        + '<div class="result-group" style="padding-top:0;padding-bottom:0"><div class="rate-limit-row">'
        + '<div class="info-pill"><span class="info-pill-label">기본 금리</span><span class="info-pill-val green">' + getBogeumRateLabel() + '</span></div>'
        + '<div class="info-pill"><span class="info-pill-label">예상 한도</span><span class="info-pill-val green">' + formatLimit(bFinalLimit) + '</span></div>'
        + '</div></div>'
        + '<div class="result-spacer-sm"></div>'
        + limitCardHtml('green', bLtvLimit, bMaxLimit, bFinalLimit, price, household, house, children, region, income)
        + bogeumDtiCardHtml('green_dti', income, price, region, house, bFinalLimit, getBogeumBaseRate(30) + getBogeumRegulationSurcharge(region), 30, otherLoanInterest)
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">충족 조건</div>'
        + '<div class="result-group"><div class="tag-section"><div class="tags">'
        + '<span class="tag pass">✓ 주택상황 (' + house + ')</span>'
        + '<span class="tag pass">✓ 주택가격 ' + price + '억 ≤ 6억</span>'
        + '<span class="tag pass">✓ 소득 ' + income.toLocaleString() + '만 ≤ ' + bIncomeLimit.toLocaleString() + '만</span>'
        + '</div></div></div>'
        + '<div class="result-spacer"></div>'
        + '<div class="group-label">상환방식</div>'
        + repayHtml('bogeumjari')
        + '</div>';
    }

    // 신생아 특례 미해당 사유 블록 (다른 상품은 해당되지만 신생아만 미해당인 경우)
    var nbFailBlock = '';
    if (!newbornOk) {
      var failNbTags = [];
      if (!nbHouseOk)  failNbTags.push('주택상황 (' + house + ') — 무주택·생애최초·1주택(대환 목적)만 해당');
      if (!nbIncomeOk) failNbTags.push('소득 ' + income.toLocaleString() + '만 > 20,000만 (2억)');
      if (!nbAssetOk)  failNbTags.push('순자산 ' + asset + '억 > 5.11억');
      if (!nbPriceOk)  failNbTags.push('주택가격 ' + price + '억 > 9억');
      var nbFailTagsHtml = failNbTags.map(function(r) { return '<span class="tag fail">✗ ' + r + '</span>'; }).join('');
      nbFailBlock = '<div class="result-spacer"></div>'
        + '<div class="group-label">신생아 특례 미해당 사유</div>'
        + '<div class="result-group"><div class="tag-section"><div class="tags">' + nbFailTagsHtml + '</div></div></div>';
    }

    return '<div class="result-header-area"><div class="result-badge-wrap">'
      + '<div class="result-icon" style="background:linear-gradient(135deg,#ff6b9d,#ff8c42);font-size:28px">👶</div>'
      + '<div><div class="result-option-label" style="color:#ff6b9d">신생아 특례 해당</div><div class="result-title">상품을 비교해 보세요</div></div>'
      + '</div></div>'
      + tabsHtml
      + paneNewborn + paneDidimdol + paneBogeumjari
      + nbFailBlock
      + '<div class="result-spacer"></div>'
      + noticeHtml()
      + '<div class="result-spacer-sm"></div>'
      + '<button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>';
  }

  // ── 상환 스케줄 카드 ──
  function scheduleCardHtml(uid, principal, colorCls) {
    const dotColor = colorCls === 'green' ? 'var(--green)' : colorCls === 'nb' ? '#ff6b9d' : 'var(--accent)';
    return `<div class="schedule-card" id="schedule-card-${uid}">
      <div class="schedule-card-head">
        <span class="schedule-card-title">월별 상환 스케줄</span>
        <span class="schedule-card-sub" id="schedule-sub-${uid}">—</span>
      </div>
      <div class="schedule-legend">
        <div class="schedule-legend-item"><div class="schedule-legend-dot" style="background:${dotColor}"></div>원금</div>
        <div class="schedule-legend-item"><div class="schedule-legend-dot" style="background:#ff9f0a"></div>이자</div>
      </div>
      <div class="schedule-table-wrap">
        <table class="schedule-table">
          <thead><tr><th>회차</th><th>원금</th><th>이자</th><th>납입액</th><th>잔액</th></tr></thead>
          <tbody id="schedule-body-${uid}"></tbody>
        </table>
      </div>
      <button class="schedule-expand-btn" id="schedule-expand-${uid}" onclick="toggleSchedule('${uid}')">
        <span id="schedule-expand-label-${uid}">전체 보기</span>
        <span id="schedule-expand-icon-${uid}">▾</span>
      </button>
      <div class="schedule-summary-row"><span>총 납입액</span><span id="schedule-total-${uid}">—</span></div>
      <div class="schedule-summary-row"><span>총 이자</span><span id="schedule-interest-${uid}" style="color:#ff9f0a">—</span></div>
    </div>`;
  }


  // ── 보금자리론 DTI 한도 계산 ──
  function getBogeumDtiLimit(region, house, income, price) {
    if (region !== '규제지역') return 60;
    // 규제지역이지만 예외 조건이면 60%
    const isFirstBuyer  = house === '생애최초';
    const isRealNeeds   = house === '무주택' && price <= 6 && income <= 7000; // 실수요자
    if (isFirstBuyer || isRealNeeds) return 60;
    return 50;
  }

  // 원리금균등 DTI 역산 대출원금
  function calcMaxLoanByDti(dtiLimit, annualIncome, otherInterestAnnual, annualRate, years) {
    const allowedAnnual = (dtiLimit / 100) * annualIncome - otherInterestAnnual;
    if (allowedAnnual <= 0) return 0;
    const r = annualRate / 12 / 100;
    const n = years * 12;
    // 월납 = P * r*(1+r)^n / ((1+r)^n - 1) → P 역산
    const factor = (r * Math.pow(1+r, n)) / (Math.pow(1+r, n) - 1);
    return (allowedAnnual / 12) / factor;
  }

  // 체증식 초기 평균 원리금 산출 (초기 10년 또는 5년 평균)
  function calcIncreasingAvgAnnual(principal, annualRate, years) {
    const r = annualRate / 12 / 100;
    const n = years * 12;
    const a = 2 * principal / (n * (n + 1));
    const avgMonths = years <= 10 ? 5 * 12 : 10 * 12;
    let total = 0;
    for (let i = 1; i <= avgMonths; i++) {
      const remaining = principal - a * (i - 1) * i / 2;
      total += a * i + remaining * r;
    }
    return (total / avgMonths) * 12;
  }

  // 원금균등 1회차 연간 원리금 (가장 높은 시점 = 보수적)
  function calcEqualPrincipalFirstAnnual(principal, annualRate, years) {
    const n = years * 12;
    const r = annualRate / 12 / 100;
    return ((principal / n) + principal * r) * 12;
  }

  // ── DTI 카드 HTML ──
  function bogeumDtiCardHtml(uid, income, price, region, house, finalLimit, annualRate, years, otherLoanInterest) {
    otherLoanInterest = otherLoanInterest || 0;
    const dtiLimit = getBogeumDtiLimit(region, house, income, price);
    const annualIncome = income * 10000;

    return `<div class="dti-card" id="dti-card-${uid}"
      data-annual-income="${annualIncome}"
      data-dti-limit="${dtiLimit}"
      data-annual-rate="${annualRate}"
      data-years="${years}"
      data-ltv-limit="${finalLimit}"
      data-other-loan="${otherLoanInterest}">
      <div class="dti-card-title">
        DTI 시뮬레이션
        <span class="dti-card-badge">참고용</span>
      </div>
      <div class="dti-rows" id="dti-rows-${uid}">
        <div class="dti-row">
          <span class="dti-row-label">DTI 한도</span>
          <span class="dti-row-val">${dtiLimit}%${region === '규제지역' && dtiLimit === 50 ? ' (규제지역)' : ''}</span>
        </div>
        <div class="dti-row">
          <span class="dti-row-label" id="dti-annual-label-${uid}">연간 원리금 (원리금균등 기준)</span>
          <span class="dti-row-val" id="dti-annual-${uid}">—</span>
        </div>
        <div class="dti-row">
          <span class="dti-row-label">기타대출 연간 이자</span>
          <span class="dti-row-val">${otherLoanInterest > 0 ? otherLoanInterest.toLocaleString() + '만원' : '없음'}</span>
        </div>
      </div>
      <hr class="dti-divider">
      <div class="dti-result-row">
        <span class="dti-result-label">현재 DTI</span>
        <span class="dti-result-val" id="dti-pct-${uid}">—</span>
      </div>
      <div class="dti-limit-row">
        <span>기준 한도 ${dtiLimit}%</span>
        <span id="dti-status-${uid}"></span>
      </div>
      <div class="dti-note">※ 상환방식·적용금리 기준 계산. 실제 DTI는 금융사 심사 결과에 따라 달라질 수 있습니다.</div>
    </div>`;
  }

  // ── DTI 재계산 — mc-amt 월납입 × 12 + 기타대출 이자 / 연소득 ──
  function recalcDti(uid) {
    const dtiCard = document.getElementById('dti-card-' + uid);
    if (!dtiCard) return;

    const annualIncome       = parseFloat(dtiCard.dataset.annualIncome || 0);
    const dtiLimit           = parseFloat(dtiCard.dataset.dtiLimit || 60);
    const otherLoanInterest  = parseFloat(dtiCard.dataset.otherLoan || 0) * 10000; // 만원→원

    if (annualIncome <= 0) return;

    // mc-amt에서 현재 월납입액 읽기 (recalcRate/selectRepayTab이 이미 계산해둠)
    const cardColor = uid.startsWith('blue_') ? 'blue' : uid.startsWith('nb_') ? 'nb' : 'green';
    const rateSection = document.querySelector('.rate-calc-section[data-color="' + cardColor + '"]');
    if (!rateSection) return;
    const card = rateSection.closest('.limit-detail-card');
    if (!card) return;
    const amtEl = card.querySelector('[id^="mc-amt-"]');
    if (!amtEl) return;

    // 월납입 텍스트에서 숫자 추출 (예: "960,605원" → 960605)
    const monthlyWon = parseInt((amtEl.textContent || '0').replace(/[^0-9]/g, '')) || 0;
    const annualPrincipal = monthlyWon * 12;

    const dtiPct     = ((annualPrincipal + otherLoanInterest) / annualIncome) * 100;
    const dtiRounded = Math.round(dtiPct * 10) / 10;
    const statusCls  = dtiRounded <= dtiLimit ? 'ok' : dtiRounded <= dtiLimit + 10 ? 'warn' : 'over';
    const statusText = dtiRounded <= dtiLimit ? '✅ 기준 이내' : '⚠️ 기준 초과';

    const annualEl  = document.getElementById('dti-annual-' + uid);
    const pctEl     = document.getElementById('dti-pct-' + uid);
    const statusEl  = document.getElementById('dti-status-' + uid);
    if (annualEl)  annualEl.textContent  = Math.round(annualPrincipal / 10000).toLocaleString() + '만원';
    if (pctEl)     { pctEl.textContent = dtiRounded + '%'; pctEl.className = 'dti-result-val ' + statusCls; }
    if (statusEl)  statusEl.textContent = statusText;
  }


  // ── 디딤돌 금리 범위 (household·house 기반) ──
  function getDidimdolRateLabel(household, house) {
    if (household === '신혼' || house === '생애최초') return '2.55~3.85%';
    return '2.85~4.15%';
  }

  // ── LTV 계산 헬퍼 ──
  // region: '규제지역' | '수도권' | '지방'
  // house: '생애최초' | 기타
  function getFundLtvRate(region, house, product) {
    const isFirstBuyer = house === '생애최초';
    const safeRegion   = region || '지방'; // null 방어
    const isMetroOrReg = safeRegion === '규제지역' || safeRegion === '수도권';

    if (product === 'bogeumjari') {
      if (isFirstBuyer) return isMetroOrReg ? 0.70 : 0.80; // 생애최초: 비수도권·비규제 80%, 수도권·규제 70%
      return safeRegion === '규제지역' ? 0.60 : 0.70;       // 일반: 규제지역 60%, 그외 70%
    }
    if (product === 'didimdol' || product === 'newborn') {
      if (isFirstBuyer) return isMetroOrReg ? 0.70 : 0.80;
      return 0.70;
    }
    return 0.70;
  }

  function renderResult(income, price, asset, otherLoanInterest) {
    otherLoanInterest = otherLoanInterest || 0;
    const { household, house, children, region } = answers;

    // 신생아 여부
    const isNewborn = children === '신생아';

    // 신생아 특례 자격
    const nbHouseOk  = house === '무주택' || house === '생애최초' || house === '1주택(대환)';
    const nbIncomeOk = income <= 20000;
    const nbAssetOk  = asset <= 5.11;
    const nbPriceOk  = price <= 9;
    const newbornOk  = isNewborn && nbHouseOk && nbIncomeOk && nbAssetOk && nbPriceOk;

    // 신생아 특례 한도
    const nbLtvRate    = getFundLtvRate(region, house, 'newborn');
    const nbLtvLimit   = price * nbLtvRate;
    const nbMaxLimit   = 4.0;
    const nbFinalLimit = Math.min(nbLtvLimit, nbMaxLimit);
    const nbRate       = isNewborn ? getNewbornRate(income) : null;

    // 디딤돌 자격 (신생아도 디딤돌 조건 동시 체크)
    const dHouseOk = house === '무주택' || house === '생애최초';
    const dAssetOk = asset <= 5.11;
    let dIncomeLimit = 6000;
    if (house === '생애최초' || children === '2명이상' || isNewborn) dIncomeLimit = 7000;
    if (household === '신혼') dIncomeLimit = 8500;
    const dIncomeOk = income <= dIncomeLimit;
    let dPriceLimit = 5;
    if (household === '신혼' || children === '2명이상' || isNewborn) dPriceLimit = 6;
    const dPriceOk  = price <= dPriceLimit;
    const didimdolOk = dHouseOk && dAssetOk && dIncomeOk && dPriceOk;

    // 디딤돌 한도
    let dMaxLimit = 2.0;
    if (household === '신혼' || children === '2명이상' || isNewborn) dMaxLimit = 3.2;
    else if (house === '생애최초') dMaxLimit = 2.4;
    const dLtvRate    = getFundLtvRate(region, house, 'didimdol');
    const dLtvLimit   = price * dLtvRate;
    const dFinalLimit = Math.min(dLtvLimit, dMaxLimit);
    const dDisplayLimit = getRoomDeductionState('didimdol', dFinalLimit, income, price, house, region).finalLimit;

    // 보금자리론 자격
    const bHouseOk = house !== '1주택이상';
    let bIncomeLimit = 7000;
    if (household === '신혼') bIncomeLimit = 8500;
    if (children === '1명') bIncomeLimit = Math.max(bIncomeLimit, 9000);
    if (children === '2명이상') bIncomeLimit = 10000;
    const bIncomeOk    = income <= bIncomeLimit;
    const bPriceOk     = price <= 6;
    const bogeumjariOk = bHouseOk && bIncomeOk && bPriceOk;

    // 보금자리론 한도
    let bMaxLimit = 3.6;
    if (house === '생애최초') bMaxLimit = 4.2;
    else if (children === '2명이상' || isNewborn) bMaxLimit = 4.0;
    const bLtvRate    = getFundLtvRate(region, house, 'bogeumjari');
    const bLtvLimit   = price * bLtvRate;
    const bFinalLimit = Math.min(bLtvLimit, bMaxLimit);

    let html = '';

    // ══ 케이스 N: 신생아 ══
    if (isNewborn) {
      if (newbornOk || didimdolOk || bogeumjariOk) {
        html = buildNewbornHtml({
          newbornOk, didimdolOk, bogeumjariOk,
          income, price, asset, household, house, children, region, otherLoanInterest,
          nbRate, nbLtvLimit, nbMaxLimit, nbFinalLimit,
          nbHouseOk, nbIncomeOk, nbAssetOk, nbPriceOk,
          dLtvLimit, dMaxLimit, dFinalLimit, dIncomeLimit, dPriceLimit,
          bLtvLimit, bMaxLimit, bFinalLimit, bIncomeLimit
        });
      } else {
        html = buildNewbornFailHtml(income, asset, price, house, nbHouseOk, nbIncomeOk, nbAssetOk, nbPriceOk, false,
          dHouseOk, dAssetOk, dIncomeOk, dPriceOk, dIncomeLimit, dPriceLimit,
          bHouseOk, bIncomeOk, bPriceOk, bIncomeLimit);
      }

    // ══ 케이스 A: 둘 다 해당 ══
    } else if (didimdolOk && bogeumjariOk) {
      html = `
        <!-- 상단 안내 -->
        <div class="result-header-area">
          <div class="result-badge-wrap">
            <div class="result-icon blue">🎉</div>
            <div>
              <div class="result-option-label blue">두 상품 모두 해당</div>
              <div class="result-title">비교해 보세요</div>
            </div>
          </div>
        </div>

        <!-- 탭 -->
        <div class="result-tabs">
          <button class="result-tab active-blue" onclick="switchTab('didimdol')">
            <span class="result-tab-badge blue">금리 최저</span>
            <span class="result-tab-name">디딤돌 대출</span>
            <span class="result-tab-limit"><span data-room-sync="didimdol">${formatLimit(dDisplayLimit)}</span></span>
          </button>
          <button class="result-tab" onclick="switchTab('bogeumjari')">
            <span class="result-tab-badge green">한도 우위</span>
            <span class="result-tab-name">보금자리론</span>
            <span class="result-tab-limit">${formatLimit(bFinalLimit)}</span>
          </button>
        </div>

        <!-- 디딤돌 패널 -->
        <div class="tab-pane active" id="pane-didimdol">
          <div class="didimdol-hero"><div class="didimdol-hero-badge">✨ 디딤돌 핵심 혜택</div><div class="didimdol-hero-text">시중 어디에서도 볼 수 없는 파격적인 금리예요</div><div class="didimdol-hero-sub">정부 지원 정책 상품으로 시중 주담대보다 훨씬 낮은 금리를 받을 수 있습니다.</div></div>
          <div class="result-spacer"></div>
          <div class="group-label">상품 정보</div>
          <div class="result-group">
            <div class="rate-limit-row">
              <div class="info-pill">
                <span class="info-pill-label">적용 금리</span>
                <span class="info-pill-val blue">${getDidimdolRateLabel(household, house)}</span>
              </div>
              <div class="info-pill">
                <span class="info-pill-label">예상 한도</span>
                <span class="info-pill-val blue" data-room-sync="didimdol">${formatLimit(dDisplayLimit)}</span>
              </div>
            </div>
          </div>
          <div class="result-spacer-sm"></div>
          ${limitCardHtml('blue', dLtvLimit, dMaxLimit, dFinalLimit, price, household, house, children, region, income)}
          ${bogeumDtiCardHtml('blue_dti', income, price, region, house, dFinalLimit, getDidimdolBaseRate(income, household, 30), 30, otherLoanInterest, 60)}
          <div class="result-spacer"></div>
          <div class="group-label">충족 조건</div>
          <div class="result-group">
            <div class="tags">
                <span class="tag pass">✓ 주택상황 (${house})</span>
                <span class="tag pass">✓ 순자산 ${asset}억 ≤ 5.11억</span>
                <span class="tag pass">✓ 소득 ${income.toLocaleString()}만 ≤ ${dIncomeLimit.toLocaleString()}만</span>
                <span class="tag pass">✓ 주택가격 ${price}억 ≤ ${dPriceLimit}억</span>
            </div>
          </div>
        </div>


        <!-- 보금자리론 패널 -->
        <div class="tab-pane" id="pane-bogeumjari">
          <div class="bogeumjari-hero">
  <div class="bogeumjari-hero-badge">✨ 보금자리론 핵심 혜택</div>
  <div class="bogeumjari-hero-text">DSR을 보지 않아요</div>
  <div class="bogeumjari-hero-sub">소득이 적어도 많은 대출을 고정금리로 받을 수 있습니다.<br>총부채원리금상환비율(DSR) 규제 적용 제외 상품이에요.</div>
</div>
          <div class="result-spacer"></div>
          <div class="group-label">상품 정보</div>
          <div class="result-group">
            <div class="rate-limit-row">
              <div class="info-pill">
                <span class="info-pill-label">기본 금리</span>
                <span class="info-pill-val green">${getBogeumRateLabel()}</span>
              </div>
              <div class="info-pill">
                <span class="info-pill-label">예상 한도</span>
                <span class="info-pill-val green">${formatLimit(bFinalLimit)}</span>
              </div>
            </div>
          </div>
          <div class="result-spacer-sm"></div>
          ${limitCardHtml('green', bLtvLimit, bMaxLimit, bFinalLimit, price, household, house, children, region, income)}
          ${bogeumDtiCardHtml('green_dti', income, price, region, house, bFinalLimit, getBogeumBaseRate(30) + getBogeumRegulationSurcharge(region), 30, otherLoanInterest)}
          <div class="result-spacer"></div>
          <div class="group-label">충족 조건</div>
          <div class="result-group">
            <div class="tags">
                <span class="tag pass">✓ 주택상황 (${house})</span>
                <span class="tag pass">✓ 주택가격 ${price}억 ≤ 6억</span>
                <span class="tag pass">✓ 소득 ${income.toLocaleString()}만 ≤ ${bIncomeLimit.toLocaleString()}만</span>
            </div>
          </div>
        </div>

        <div class="result-spacer"></div>
        <div class="group-label">상환방식</div>
        ${repayHtml('bogeumjari')}

        <!-- 공통 하단 -->
        <div class="result-spacer"></div>
        ${faqHtml()}
        <div class="result-spacer"></div>
        ${noticeHtml()}
        <div class="result-spacer"></div>
        <div class="result-spacer-sm"></div>
        <button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>`;

    // ══ 케이스 B: 디딤돌만 해당 ══
    } else if (didimdolOk) {
      html = `
        <div class="result-header-area">
          <div class="result-badge-wrap">
            <div class="result-icon blue">🏠</div>
            <div>
              <div class="result-option-label blue">BEST OPTION</div>
              <div class="result-title">디딤돌 대출</div>
            </div>
          </div>
        </div>
        <div class="didimdol-hero"><div class="didimdol-hero-badge">✨ 디딤돌 핵심 혜택</div><div class="didimdol-hero-text">시중 어디에서도 볼 수 없는 파격적인 금리예요</div><div class="didimdol-hero-sub">정부 지원 정책 상품으로 시중 주담대보다 훨씬 낮은 금리를 받을 수 있습니다.</div></div>
        <div class="result-spacer"></div>
        <div class="group-label">상품 정보</div>
        <div class="result-group">
          <div class="rate-limit-row">
            <div class="info-pill">
              <span class="info-pill-label">적용 금리</span>
              <span class="info-pill-val blue">${getDidimdolRateLabel(household, house)}</span>
            </div>
            <div class="info-pill">
              <span class="info-pill-label">예상 한도</span>
              <span class="info-pill-val blue" data-room-sync="didimdol">${formatLimit(dDisplayLimit)}</span>
            </div>
          </div>
        </div>
        <div class="result-spacer-sm"></div>
        ${limitCardHtml('blue', dLtvLimit, dMaxLimit, dFinalLimit, price, household, house, children, region, income)}
        ${bogeumDtiCardHtml('blue_dti', income, price, region, house, dFinalLimit, getDidimdolBaseRate(income, household, 30), 30, otherLoanInterest, 60)}
        <div class="result-spacer"></div>
        <div class="group-label">충족 조건</div>
        <div class="result-group">
          <div class="tags">
              <span class="tag pass">✓ 주택상황 (${house})</span>
              <span class="tag pass">✓ 순자산 ${asset}억 ≤ 5.11억</span>
              <span class="tag pass">✓ 소득 ${income.toLocaleString()}만 ≤ ${dIncomeLimit.toLocaleString()}만</span>
              <span class="tag pass">✓ 주택가격 ${price}억 ≤ ${dPriceLimit}억</span>
          </div>
        </div>
        <div class="result-spacer"></div>
        <div class="group-label">상환방식</div>
        ${repayHtml('didimdol')}
        <div class="result-spacer"></div>
        ${faqHtml()}
        <div class="result-spacer"></div>
        ${noticeHtml()}
        <div class="result-spacer"></div>
        <div class="result-spacer-sm"></div>
        <button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>`;

    // ══ 케이스 C: 보금자리론만 해당 ══
    } else if (bogeumjariOk) {
      const failD = buildFailD(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house);
      html = `
        <div class="result-header-area">
          <div class="result-badge-wrap">
            <div class="result-icon green">🏡</div>
            <div>
              <div class="result-option-label green">RECOMMENDED</div>
              <div class="result-title">보금자리론</div>
            </div>
          </div>
        </div>
        <div class="bogeumjari-hero">
  <div class="bogeumjari-hero-badge">✨ 보금자리론 핵심 혜택</div>
  <div class="bogeumjari-hero-text">DSR을 보지 않아요</div>
  <div class="bogeumjari-hero-sub">소득이 적어도 많은 대출을 고정금리로 받을 수 있습니다.<br>총부채원리금상환비율(DSR) 규제 적용 제외 상품이에요.</div>
</div>
        <div class="result-spacer"></div>
        <div class="group-label">상품 정보</div>
        <div class="result-group">
          <div class="rate-limit-row">
            <div class="info-pill">
              <span class="info-pill-label">기본 금리</span>
              <span class="info-pill-val green">${getBogeumRateLabel()}</span>
            </div>
            <div class="info-pill">
              <span class="info-pill-label">예상 한도</span>
              <span class="info-pill-val green">${formatLimit(bFinalLimit)}</span>
            </div>
          </div>
        </div>
        <div class="result-spacer-sm"></div>
        ${limitCardHtml('green', bLtvLimit, bMaxLimit, bFinalLimit, price, household, house, children, region, income)}
        ${bogeumDtiCardHtml('green_dti', income, price, region, house, bFinalLimit, getBogeumBaseRate(30) + getBogeumRegulationSurcharge(region), 30, otherLoanInterest)}
        <div class="result-spacer"></div>
        <div class="group-label">자격 검토</div>
        <div class="result-group">
          <div class="tag-section-label">디딤돌 미해당 사유</div>
          <div class="tags">${failD.map(r=>`<span class="tag fail">✗ ${r}</span>`).join('')}</div>
          <div style="height:10px"></div>
          <div class="tag-section-label">보금자리론 충족 조건</div>
          <div class="tags">
            <span class="tag pass">✓ 주택상황 (${house})</span>
            <span class="tag pass">✓ 주택가격 ${price}억 ≤ 6억</span>
            <span class="tag pass">✓ 소득 ${income.toLocaleString()}만 ≤ ${bIncomeLimit.toLocaleString()}만</span>
          </div>
        </div>
        <div class="result-spacer"></div>
        <div class="group-label">상환방식</div>
        ${repayHtml('bogeumjari')}
        <div class="result-spacer"></div>
        ${faqHtml()}
        <div class="result-spacer"></div>
        ${noticeHtml()}
        <div class="result-spacer"></div>
        <div class="result-spacer-sm"></div>
        <button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>`;

    // ══ 케이스 D: 해당 없음 ══
    } else {
      const failD = buildFailD(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house);
      const failB = [];
      if (!bHouseOk)  failB.push(`주택상황 (${house}) — 1주택 이상은 해당 없음`);
      if (!bIncomeOk) failB.push(`소득 ${income.toLocaleString()}만 > ${bIncomeLimit.toLocaleString()}만`);
      if (!bPriceOk)  failB.push(`주택가격 ${price}억 > 6억`);
      html = `
        <div class="result-header-area">
          <div class="result-badge-wrap">
            <div class="result-icon grey">🏦</div>
            <div>
              <div class="result-option-label grey">ALTERNATIVE</div>
              <div class="result-title">시중은행</div>
            </div>
          </div>
        </div>
        <div class="result-tagline grey-border">입력하신 조건은 주택기금 대출 요건을 충족하지 않습니다. 시중은행을 알아봐주세요.</div>
        <div class="result-spacer"></div>
        <div class="group-label">자격 검토</div>
        <div class="result-group">
          ${isNewborn ? `
          <div class="tag-section">
            <div class="tag-section-label">신생아 특례 미해당 사유</div>
            <div class="tags">${buildNewbornFailHtml(income, asset, price, house, nbHouseOk, nbIncomeOk, nbAssetOk, nbPriceOk, true)}</div>
          </div>` : ''}
          <div class="tag-section">
            <div class="tag-section-label">디딤돌 미해당 사유</div>
            <div class="tags">${failD.map(r=>`<span class="tag fail">✗ ${r}</span>`).join('')}</div>
          </div>
          <div class="tag-section">
            <div class="tag-section-label">보금자리론 미해당 사유</div>
            <div class="tags">${failB.map(r=>`<span class="tag fail">✗ ${r}</span>`).join('')}</div>
          </div>
        </div>
        <div class="result-spacer"></div>
        ${faqHtml()}
        <div class="result-spacer"></div>
        ${noticeHtml()}
        <div class="result-spacer"></div>
        <div class="result-spacer-sm"></div>
        <button class="btn-restart" onclick="confirmRestart()">↩ 처음부터 다시하기</button>`;
    }

    document.getElementById('resultContent').innerHTML = html;

    // 초기 우대금리 반영 (선택된 카드 기반 rate-summary 초기화)
    setTimeout(function() {
      document.querySelectorAll('.rate-calc-section[data-uid]').forEach(function(sec) {
        recalcRate(sec.dataset.uid);
      });
      setTimeout(function() { ['green_dti','blue_dti','nb_dti'].forEach(function(id){ if(document.getElementById('dti-card-'+id)) recalcDti(id); }); }, 50);
      setTimeout(function() {
        document.querySelectorAll('.rate-calc-section[data-uid]').forEach(function(sec) {
          renderSchedule(sec.dataset.uid);
        });
      }, 60);
    }, 0);

    // 결과 카드 순차 페이드인
    requestAnimationFrame(() => {
      const children = document.getElementById('resultContent')?.children;
      if (!children) return;
      Array.from(children).forEach((el, i) => {
        el.style.opacity = '0';
        el.style.animation = `cardFadeUp 0.32s cubic-bezier(0.4,0,0.2,1) ${i * 0.04}s forwards`;
      });
    });
  }

  function switchTab(tab) {
    const panes = document.querySelectorAll('.tab-pane');
    const tabs  = document.querySelectorAll('.result-tab');
    panes.forEach(p => p.classList.remove('active'));
    tabs.forEach(t  => t.classList.remove('active-blue', 'active-green'));

    if (tab === 'didimdol') {
      document.getElementById('pane-didimdol').classList.add('active');
      tabs[0].classList.add('active-blue');
    } else {
      document.getElementById('pane-bogeumjari').classList.add('active');
      tabs[1].classList.add('active-green');
    }
  }

  function switchTab3(tab) {
    document.querySelectorAll('.tab-pane3').forEach(function(p) { p.classList.remove('active'); });
    document.querySelectorAll('#tabs3-wrap .result-tab').forEach(function(t) {
      t.classList.remove('active-blue', 'active-green');
      t.removeAttribute('style');
    });
    var pane = document.getElementById('pane3-' + tab);
    if (pane) pane.classList.add('active');
    document.querySelectorAll('#tabs3-wrap .result-tab').forEach(function(t) {
      if (t.dataset.tab === tab) {
        if (tab === 'newborn') {
          t.style.cssText = 'background:rgba(255,107,157,0.15);border-color:#ff6b9d;color:#ff6b9d';
        } else if (tab === 'didimdol') {
          t.classList.add('active-blue');
        } else {
          t.classList.add('active-green');
        }
      }
    });
  }

    function buildFailD(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house) {
    const r = [];
    if (!dHouseOk) r.push(`주택상황 (${house}) — 무주택·생애최초만 해당`);
    if (!dAssetOk) r.push(`순자산 ${asset}억 > 5.11억`);
    if (!dIncomeOk) r.push(`소득 ${income.toLocaleString()}만 > ${dIncomeLimit.toLocaleString()}만`);
    if (!dPriceOk)  r.push(`주택가격 ${price}억 > ${dPriceLimit}억`);
    return r;
  }

  // ── 상환방식 HTML ──
  function repayHtml(type) {
    const isBogeumjari = type === 'bogeumjari';
    const tenure = isBogeumjari
      ? '10년, 15년, 20년, 30년, 40년, 50년'
        + '<div style="color:var(--label3);font-size:11px;margin-top:4px;line-height:1.6">'
        + '· 만기 <strong style="color:var(--label2)">40년</strong>: 만 40세 미만 또는 만 50세 미만 신혼가구<br>'
        + '· 만기 <strong style="color:var(--label2)">50년</strong>: 만 35세 미만 또는 만 40세 미만 신혼가구</div>'
      : '10년, 15년, 20년, 30년'
        + '<div style="color:var(--label3);font-size:11px;margin-top:4px;line-height:1.6">'
        + '· 체증식: 채무자가 접수일 현재 <strong style="color:var(--label2)">만 40세 미만 근로자</strong>이고 <strong style="color:var(--label2)">고정금리</strong>를 선택한 경우에만 허용</div>';
    const teungjeungNote = isBogeumjari
      ? '체증식은 만 40세 미만 채무자 및 공사가 사전심사한 경우에만 허용되며, 대출만기 50년 적용 불가'
      : '채무자가 접수일 현재 만 40세 미만 근로자이고 고정금리를 선택한 경우에만 허용';
    return `
      <div class="result-group">
          <div class="repay-item">
            <div class="repay-name">원리금균등분할상환</div>
            <div class="repay-desc">매월 납부액(원금+이자)이 일정 — 가계 계획 세우기 좋아요.</div>
          </div>
          <div class="repay-item">
            <div class="repay-name">원금균등분할상환 <span style="font-weight:400;font-size:11px;color:var(--label3)">체감식</span></div>
            <div class="repay-desc">매월 같은 원금을 갚고 이자는 점점 줄어요. 초반 부담은 크지만 총 이자가 가장 적어요.</div>
          </div>
          <div class="repay-item">
            <div class="repay-name">체증식 분할상환</div>
            <div class="repay-desc">초반엔 적게 내고 시간이 갈수록 상환액이 늘어요. ${teungjeungNote}.</div>
          </div>
        <div class="repay-tenure">
          <span class="repay-tenure-label">대출 만기</span>
          <span class="repay-tenure-val">${tenure}</span>
        </div>
      </div>`;
  }

  // ── 신생아 특례 FAQ HTML ──
  function newbornFaqHtml() {
    const faqs = [
      {
        q: '최대 얼마까지 빌릴 수 있나요?',
        a: '최대 4억 원 이내입니다. (단, 2025년 6월 27일 이전 계약 건은 기존처럼 5억 원까지 가능합니다.)<br><br>LTV(주택담보대출비율)는 기본 70%이며, 생애최초 주택구입자도 70%가 적용됩니다. 규제지역은 일반 60%, 생애최초 70%가 적용됩니다.<br><br>LTV 계산은 생애최초와 규제지역을 반영해 자동 계산되며, 보다 자세한 사항은 기금e든든에서 확인이 필요합니다.'
      },
      {
        q: '소득과 자산 기준은 어떻게 되나요?',
        a: '부부합산 연 소득 1.3억 원 이하(맞벌이 가구는 2억 원 이하)여야 하며, 합산 순자산 가액은 5.11억 원 이하(2026년 기준)여야 합니다.'
      },
      {
        q: '금리는 어떻게 적용되나요?',
        a: '소득 수준에 따라 <strong>연 1.8% ~ 4.5%</strong>의 특례 금리가 적용됩니다. 특례금리는 기본 5년 적용되며, 추가 출산 시 1명당 5년 연장(최장 15년)됩니다.'
      },
      {
        q: '어떤 집을 살 때 대출이 가능한가요?',
        a: '담보주택의 평가액이 9억 원 이하이고, 주거 전용면적이 85㎡ 이하(읍·면 지역은 100㎡ 이하)인 주택입니다.'
      },
      {
        q: '기존 대출을 이 상품으로 바꿀 수 있나요? (대환)',
        a: '네, 1주택자인 경우 기존 주택담보대출 상환 목적으로 신청이 가능합니다. 단, 대출 신청 시점에 다른 자격 요건(소득, 자녀 출산 등)을 모두 충족해야 합니다.'
      },
      {
        q: '신청은 언제, 어디서 하나요?',
        a: '소유권 이전 등기 전이나 등기 접수일로부터 3개월 이내에 신청해야 합니다. 온라인은 <strong>기금e든든 홈페이지</strong>, 오프라인은 수탁은행(우리, 국민, 농협, 신한, 하나)에서 가능합니다.'
      },
      {
        q: '중도상환수수료가 있나요?',
        a: '3년 이내 상환 시 최대 <strong>1.2%</strong>의 수수료가 발생합니다.'
      }
    ];
    const items = faqs.map(function(f, i) {
      return '<div class="faq-item" id="nbfaq-' + i + '">'
        + '<button class="faq-q" onclick="toggleNbFaq(' + i + ')">'
        + '<span class="faq-q-text">' + f.q + '</span>'
        + '<span class="faq-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>'
        + '</button>'
        + '<div class="faq-a"><div class="faq-a-text">' + f.a + '</div></div>'
        + '</div>';
    }).join('');
    return '<div class="group-label">자주 묻는 질문</div><div class="faq-section">' + items + '</div>';
  }

  function toggleNbFaq(idx) {
    const item = document.getElementById('nbfaq-' + idx);
    if (!item) return;
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(function(el) { el.classList.remove('open'); });
    if (!isOpen) item.classList.add('open');
  }

  // ── FAQ HTML ──
  function faqHtml() {
    const faqs = [
      {
        q: '미혼 단독세대주도 신청할 수 있나요?',
        a: `네, 가능합니다! 다만 단독세대주는 조건이 조금 더 까다로워요.<br><br>
<strong>디딤돌</strong>은 담보 주택 평가액 3억 이하, 대출한도 최대 1.5억원(생애최초는 2억원), 전용면적 60㎡(수도권 외 읍·면 지역은 70㎡) 이하인 경우에만 신청 가능해요.<br><br>
<strong>보금자리론</strong>은 적격 조건을 충족하면 무주택 최대 3.6억, 생애최초는 최대 4.2억까지 받을 수 있어요.`
      },
      {
        q: '조기 상환 수수료가 있나요?',
        a: `네, 있어요. 대출 실행 후 <strong>3년 이내</strong>에 원금을 갚으면 경과 일수에 따라 <strong>최대 0.6%</strong>의 중도상환수수료가 부과돼요. 3년이 지난 뒤에는 수수료 없이 자유롭게 상환할 수 있어요.`
      },
      {
        q: '계약 전에 정확한 대출 금액을 알 수 있나요?',
        a: `아쉽게도 계약 전에는 정확한 금액을 확인하기 어려워요. 최종 계약서를 기준으로 심사하기 때문에, 사전에 대출 가능 여부나 금액을 확정하기는 힘들어요.<br><br>
신청 전 <strong>기금e든든 홈페이지</strong> 또는 수탁은행에 사전 문의하시면 대략적인 가능 여부를 확인할 수 있어요.`
      },
      {
        q: '소득은 어떻게 증빙하나요?',
        a: `<strong>근로소득자</strong>는 일반적으로 상시소득으로 인정돼요. 단, 근로계약 기간이 1년 미만이면 상시소득에서 제외될 수 있어요.<br><br>
<strong>사업소득자</strong>는 소득 발생 시점부터 1년 이상 지속됐음을 증빙하면 상시소득으로 포괄 인정받을 수 있어요. 보험설계사, 시간강사, 기타 사업자 등도 동일하게 적용돼요.`
      },
      {
        q: '보금자리론으로 어떤 주택을 살 수 있나요?',
        a: `등기부등본 기준으로 <strong>실제 주거용</strong>으로 사용되는 아파트(주상복합 포함), 연립·다세대·단독주택만 가능해요.<br><br>
주거용 오피스텔, 근린생활시설, 숙박시설은 원칙적으로 불가하지만, 상가주택 등 복합용도 건물은 <strong>주택 면적이 절반 이상</strong>이면 대출받을 수 있어요.<br><br>
경매·가압류 등 법적 문제가 있는 집은 해당 문제가 해소(말소)된 이후에 신청할 수 있어요.`
      }
    ];

    const items = faqs.map((f, i) => `
      <div class="faq-item" id="faq-${i}">
        <button class="faq-q" onclick="toggleFaq(${i})">
          <span class="faq-q-text">${f.q}</span>
          <span class="faq-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        </button>
        <div class="faq-a">
          <div class="faq-a-text">${f.a}</div>
        </div>
      </div>`).join('');

    return `
      <div class="group-label">자주 묻는 질문</div>
      <div class="faq-section">${items}</div>`;
  }

  function toggleFaq(idx) {
    const item = document.getElementById('faq-' + idx);
    if (!item) return;
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  }

    function donateHtml() {
    return `
      <div class="donate-section">
        <div class="donate-main">서비스가 도움이 되셨나요?</div>
        <div class="donate-sub">커피 한 잔 후원해 주시면 서비스 운영에 큰 힘이 됩니다! ☕️</div>
        <a class="btn-donate" href="https://qr.kakaopay.com/Ej7mJd7EE" target="_blank" rel="noopener">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="#191919" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3C6.477 3 2 6.72 2 11.25c0 2.91 1.7 5.48 4.28 6.99L5.2 21.5l4.93-2.73c.6.1 1.23.16 1.87.16 5.523 0 10-3.72 10-8.25C22 6.72 17.523 3 12 3z"/>
          </svg>
          카카오페이로 후원하기
        </a>
      </div>`;
  }

  function confirmRestart() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function closeRestartConfirm() {
    const overlay = document.getElementById('restartConfirmOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
  }

  function restartApp(options = {}) {
    const { showDashboardAfterReset = true } = options;
    loanType = null;
    answers.household = null;
    answers.house = null;
    answers.children = null;
    answers.region = null;
    document.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
    ['income','price','asset','otherLoanPrincipal','otherLoanRate','otherLoanYears'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    var noneChk = document.getElementById('otherLoanNone');
    if (noneChk) { noneChk.checked = false; }
    var noneBox = document.getElementById('otherLoanNoneBox');
    if (noneBox) { noneBox.textContent = ''; noneBox.style.background = 'var(--bg2)'; noneBox.style.borderColor = 'var(--separator)'; }
    var noneLabel = document.getElementById('otherLoanNoneLabel');
    if (noneLabel) noneLabel.style.borderColor = 'var(--separator)';
    var wrap = document.getElementById('otherLoanInputWrap');
    if (wrap) wrap.style.opacity = '';
    var calc = document.getElementById('otherLoanCalcResult');
    if (calc) calc.style.display = 'none';
    ['incomeErr','priceErr','assetErr','otherLoanErr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });

    // 비교 상태 완전 초기화
    bankCompareSet.clear();
    bankAllProds = [];
    bankBangBanner = '';
    const bar = document.getElementById('compareBar');
    if (bar) { bar.style.transform = 'translateY(100%)'; bar.style.opacity = '0'; }
    const panel = document.getElementById('comparePanel');
    if (panel) { panel.classList.remove('open'); panel.style.display = 'none'; }
    const hint = document.getElementById('compareHint');
    if (hint) hint.classList.remove('visible');

    // 결과 슬라이드 초기화
    const resultSlide = document.querySelector('[data-slide="8"]');
    if (resultSlide) resultSlide.innerHTML = '<div id="resultContent"></div>';

    const allSlides = document.querySelectorAll('.slide');
    allSlides[current].classList.remove('active');
    current = 0;
    allSlides[0].classList.add('active');

    document.getElementById('bottomNav').style.display = 'flex';
    document.getElementById('progressWrap').style.display = 'block';
    setProgress(0);
    document.getElementById('btnBack').disabled = true;
    document.getElementById('btnNext').disabled = true;
    if (showDashboardAfterReset) showDashboard();
  }

  // ── 비밀번호 & 게스트 모드 ──
  const CORRECT_PW = 'egenhusband^^';
  let isGuestMode  = false;

  // 초기 진입 처리는 dashboard.js 로드 후 실행됨

  function submitPassword() {
    const val = document.getElementById('pwInput').value;
    if (val === CORRECT_PW) {
      isGuestMode = false;
      localStorage.setItem('authVerified', '1');
      document.getElementById('pwScreen').style.display = 'none';
      document.getElementById('pwErr').textContent = '';
      startCalculatorFlow();
      if (typeof preloadMarketBundle === 'function') preloadMarketBundle().catch(() => {});
    } else {
      document.getElementById('pwErr').textContent = '비밀번호가 올바르지 않아요.';
      document.getElementById('pwInput').value = '';
      document.getElementById('btnPwSubmit').disabled = true;
    }
  }

  function enterAsGuest() {
    isGuestMode = true;
    document.getElementById('pwScreen').style.display = 'none';
    // 이미 결과화면이 렌더링된 상태면 즉시 결제 팝업 노출
    const resultContent = document.getElementById('resultContent');
    const bankResultArea = document.getElementById('bankResultArea');
    const hasResult = (resultContent && resultContent.innerHTML.trim() !== '') ||
                      (bankResultArea && bankResultArea.innerHTML.trim() !== '');
    if (hasResult) setTimeout(showPayPopup, 200);
    else {
      startCalculatorFlow();
      if (typeof preloadMarketBundle === 'function') preloadMarketBundle().catch(() => {});
    }
  }

  // ── 결제 팝업 ──
  function showPayPopup() {
    if (!isGuestMode) return;
    const overlay = document.getElementById('payOverlay');
    overlay.classList.add('open');
  }

  function closePayAndShowPw() {
    document.getElementById('payOverlay').classList.remove('open');
    isGuestMode = false; // 결제 팝업 → 비번 화면 복귀 시 게스트 초기화
    const pwScreen = document.getElementById('pwScreen');
    pwScreen.style.display = 'flex';
    document.getElementById('pwInput').value = '';
    document.getElementById('btnPwSubmit').disabled = true;
    document.getElementById('pwErr').textContent = '';
  }

  // 기금대출 결과 진입 시 팝업 — goNext()에서 renderResult 호출 후 훅
  const _origRenderResult = renderResult;
  renderResult = function(income, price, asset, otherLoanInterest) {
    _origRenderResult(income, price, asset, otherLoanInterest);
    if (isGuestMode) setTimeout(showPayPopup, 400);
  };

  // 시중은행 조회 버튼 시 팝업 — searchBankLoans 래핑
  const _origSearchBankLoans = searchBankLoans;
  searchBankLoans = async function() {
    if (isGuestMode) { showPayPopup(); return; }
    return _origSearchBankLoans();
  };

  setProgress(0);
