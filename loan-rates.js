/*
 * 정책대출 금리·공제 기준표 — 화면(calculator.js)과 서버(netlify/functions/calc-loan.js)가
 * 함께 쓰는 단일 소스입니다. 금리가 바뀌면 이 파일만 수정하세요.
 *
 * 브라우저: <script src="loan-rates.js"> → window.LoanRates
 * Node(서버 함수): require('../../loan-rates.js')
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoanRates = api;
}(typeof self !== 'undefined' ? self : this, function () {
  // 보금자리론 기한별 기본금리 — u/t(비대면·대면) 기준.
  // 아낌e(전자약정·전자등기)는 여기서 0.1%p 낮은 금리이며, 화면에서 우대 옵션으로 반영합니다.
  // 새 공시가 나오면 맨 아래에 effectiveFrom(시행일, 한국시간)과 함께 추가하세요.
  const BOGEUM_RATE_SCHEDULE = [
    {
      effectiveFrom: '2026-04-01',
      label: '2026년 4월 1일 기준',
      rates: { 10: 4.45, 15: 4.55, 20: 4.60, 30: 4.65, 40: 4.70, 50: 4.75 },
    },
    {
      effectiveFrom: '2026-05-01',
      label: '2026년 5월 1일 기준',
      rates: { 10: 4.60, 15: 4.70, 20: 4.75, 30: 4.80, 40: 4.85, 50: 4.90 },
    },
    {
      effectiveFrom: '2026-07-07',
      label: '2026년 7월 7일 기준',
      rates: { 10: 5.00, 15: 5.10, 20: 5.15, 30: 5.20, 40: 5.25, 50: 5.30 },
    },
    {
      // 공시 기준(아낌e): 10년 4.90 / 15년 5.00 / 20년 5.05 / 30년 5.10 / 40년 5.15 / 50년 5.20
      effectiveFrom: '2026-10-01',
      label: '2026년 10월 기준',
      rates: { 10: 5.00, 15: 5.10, 20: 5.15, 30: 5.20, 40: 5.25, 50: 5.30 },
    },
  ];

  // 규제지역 보금자리론 가산금리(%p)
  const BOGEUM_REGULATED_SURCHARGE = 0.2;

  // 디딤돌 소득(만원)·기한별 기본금리 — 일반/생애최초
  const DIDIMDOL_RATES_GENERAL = [
    { maxIncome: 2000, rates: { 10: 2.85, 15: 2.95, 20: 3.05, 30: 3.10 } },
    { maxIncome: 4000, rates: { 10: 3.20, 15: 3.30, 20: 3.40, 30: 3.45 } },
    { maxIncome: 7000, rates: { 10: 3.55, 15: 3.65, 20: 3.75, 30: 3.80 } },
    { maxIncome: 8500, rates: { 10: 3.90, 15: 4.00, 20: 4.10, 30: 4.15 } },
  ];

  // 디딤돌 소득(만원)·기한별 기본금리 — 신혼가구
  const DIDIMDOL_RATES_NEWLYWED = [
    { maxIncome: 2000, rates: { 10: 2.55, 15: 2.65, 20: 2.75, 30: 2.80 } },
    { maxIncome: 4000, rates: { 10: 2.90, 15: 3.00, 20: 3.10, 30: 3.15 } },
    { maxIncome: 7000, rates: { 10: 3.25, 15: 3.35, 20: 3.45, 30: 3.50 } },
    { maxIncome: 8500, rates: { 10: 3.60, 15: 3.70, 20: 3.80, 30: 3.85 } },
  ];

  // 신생아 특례 소득(만원)·기한별 금리
  const NEWBORN_RATE_TABLE = [
    { label: '~2천만원', r10: 1.80, r20: 2.00, r30: 2.05, maxIncome: 2000 },
    { label: '2천~4천만원', r10: 2.15, r20: 2.35, r30: 2.40, maxIncome: 4000 },
    { label: '4천~6천만원', r10: 2.40, r20: 2.60, r30: 2.65, maxIncome: 6000 },
    { label: '6천~8.5천만원', r10: 2.65, r20: 2.85, r30: 2.90, maxIncome: 8500 },
    { label: '8.5천~1억원', r10: 2.90, r20: 3.10, r30: 3.20, maxIncome: 10000 },
    { label: '1억~1.3억원', r10: 3.20, r20: 3.40, r30: 3.50, maxIncome: 13000 },
    { label: '(맞벌이)1.3~1.5억', r10: 3.50, r20: 3.70, r30: 3.80, maxIncome: 15000 },
    { label: '(맞벌이)1.5~1.7억', r10: 3.85, r20: 4.05, r30: 4.15, maxIncome: 17000 },
    { label: '(맞벌이)1.7~2억', r10: 4.20, r20: 4.40, r30: 4.50, maxIncome: Infinity },
  ];

  // 방공제(소액임차보증금) 금액, 억원
  const ROOM_DEDUCTION_AMOUNTS = { seoul: 0.55, metro: 0.48, city: 0.28, other: 0.25 };

  // 서버(UTC)에서도 한국 날짜 기준으로 시행일을 판단한다.
  function getKstDateKey(now) {
    const kst = new Date((now || new Date()).getTime() + 9 * 60 * 60 * 1000);
    return Number(String(kst.getUTCFullYear())
      + String(kst.getUTCMonth() + 1).padStart(2, '0')
      + String(kst.getUTCDate()).padStart(2, '0'));
  }

  function getCurrentBogeumRateSet(now) {
    const todayKey = getKstDateKey(now);
    let active = BOGEUM_RATE_SCHEDULE[0];
    BOGEUM_RATE_SCHEDULE.forEach(entry => {
      if (todayKey >= Number(entry.effectiveFrom.replace(/-/g, ''))) active = entry;
    });
    return active;
  }

  function getBogeumBaseRate(years, now) {
    const rateSet = getCurrentBogeumRateSet(now);
    return rateSet.rates[years] || rateSet.rates[30];
  }

  function getBogeumRegulationSurcharge(region) {
    return region === '규제지역' ? BOGEUM_REGULATED_SURCHARGE : 0;
  }

  function getBogeumRateLabel(now) {
    return `${getBogeumBaseRate(10, now).toFixed(2)}~${getBogeumBaseRate(50, now).toFixed(2)}%`;
  }

  function getDidimdolBaseRate(income, household, years) {
    const table = household === '신혼' ? DIDIMDOL_RATES_NEWLYWED : DIDIMDOL_RATES_GENERAL;
    const row = table.find(r => income <= r.maxIncome) || table[table.length - 1];
    return row.rates[years] || row.rates[30];
  }

  function getNewbornRate(income, years) {
    const row = NEWBORN_RATE_TABLE.find(r => income <= r.maxIncome) || NEWBORN_RATE_TABLE[NEWBORN_RATE_TABLE.length - 1];
    const y = years || 30;
    const rate = y <= 10 ? row.r10 : y <= 20 ? row.r20 : row.r30;
    return { min: row.r10, max: row.r30, max30: row.r30, rate, label: row.label };
  }

  return Object.freeze({
    BOGEUM_RATE_SCHEDULE,
    BOGEUM_REGULATED_SURCHARGE,
    DIDIMDOL_RATES_GENERAL,
    DIDIMDOL_RATES_NEWLYWED,
    NEWBORN_RATE_TABLE,
    ROOM_DEDUCTION_AMOUNTS,
    getCurrentBogeumRateSet,
    getBogeumBaseRate,
    getBogeumRegulationSurcharge,
    getBogeumRateLabel,
    getDidimdolBaseRate,
    getNewbornRate,
  });
}));
