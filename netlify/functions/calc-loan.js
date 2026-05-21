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
];

const DIDIMDOL_RATES_GENERAL = [
  { maxIncome: 2000, rates: { 10: 2.85, 15: 2.95, 20: 3.05, 30: 3.10 } },
  { maxIncome: 4000, rates: { 10: 3.20, 15: 3.30, 20: 3.40, 30: 3.45 } },
  { maxIncome: 7000, rates: { 10: 3.55, 15: 3.65, 20: 3.75, 30: 3.80 } },
  { maxIncome: 8500, rates: { 10: 3.90, 15: 4.00, 20: 4.10, 30: 4.15 } },
];

const DIDIMDOL_RATES_NEWLYWED = [
  { maxIncome: 2000, rates: { 10: 2.55, 15: 2.65, 20: 2.75, 30: 2.80 } },
  { maxIncome: 4000, rates: { 10: 2.90, 15: 3.00, 20: 3.10, 30: 3.15 } },
  { maxIncome: 7000, rates: { 10: 3.25, 15: 3.35, 20: 3.45, 30: 3.50 } },
  { maxIncome: 8500, rates: { 10: 3.60, 15: 3.70, 20: 3.80, 30: 3.85 } },
];

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

const ROOM_DEDUCTION_AMOUNTS = {
  seoul: 0.55,
  metro: 0.48,
  city: 0.28,
  other: 0.25,
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

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

function getDidimdolBaseRate(income, household, years) {
  const table = household === '신혼' ? DIDIMDOL_RATES_NEWLYWED : DIDIMDOL_RATES_GENERAL;
  const row = table.find(item => income <= item.maxIncome) || table[table.length - 1];
  return row.rates[years] || row.rates[30];
}

function getNewbornRate(income, years) {
  const row = NEWBORN_RATE_TABLE.find(item => income <= item.maxIncome) || NEWBORN_RATE_TABLE[NEWBORN_RATE_TABLE.length - 1];
  const y = years || 30;
  const rate = y <= 10 ? row.r10 : y <= 20 ? row.r20 : row.r30;
  return { min: row.r10, max: row.r30, max30: row.r30, rate, label: row.label };
}

function calcIncreasingAvgAnnual(principal, annualRate, years) {
  const r = annualRate / 12 / 100;
  const n = years * 12;
  const a = 2 * principal / (n * (n + 1));
  const avgMonths = years <= 10 ? 5 * 12 : 10 * 12;
  let total = 0;
  for (let i = 1; i <= avgMonths; i += 1) {
    const remaining = principal - a * (i - 1) * i / 2;
    total += a * i + remaining * r;
  }
  return (total / avgMonths) * 12;
}

function getBogeumDtiLimit(region, house, income, price) {
  if (region !== '규제지역') return 60;
  const isFirstBuyer = house === '생애최초';
  const isRealNeeds = house === '무주택' && price <= 6 && income <= 7000;
  if (isFirstBuyer || isRealNeeds) return 60;
  return 50;
}

function calcMaxLoanByDti(dtiLimit, annualIncome, otherInterestAnnual, annualRate, years, method) {
  const allowedAnnual = (dtiLimit / 100) * annualIncome - otherInterestAnnual;
  if (allowedAnnual <= 0) return 0;
  if (annualIncome <= 0) return Infinity;
  const r = annualRate / 12 / 100;
  const n = years * 12;
  const repayMethod = method || 'annuity';
  if (repayMethod === 'equal-principal') {
    const factor = ((1 / n) + r) * 12;
    return factor > 0 ? allowedAnnual / factor : 0;
  }
  if (repayMethod === 'increasing') {
    const unitAnnual = calcIncreasingAvgAnnual(1, annualRate, years);
    return unitAnnual > 0 ? allowedAnnual / unitAnnual : 0;
  }
  if (r <= 0) return (allowedAnnual / 12) * n;
  const factor = (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return (allowedAnnual / 12) / factor;
}

function getBogeumDtiLoanLimitEok(income, price, region, house, otherLoanInterest, annualRate, years, method) {
  const annualIncome = income * 10000;
  if (annualIncome <= 0) return Infinity;
  const dtiLimit = getBogeumDtiLimit(region, house, income, price);
  const principalWon = calcMaxLoanByDti(dtiLimit, annualIncome, (otherLoanInterest || 0) * 10000, annualRate, years, method);
  if (!Number.isFinite(principalWon)) return Infinity;
  return Math.max(0, principalWon / 100000000);
}

function getDidimdolDtiLoanLimitEok(income, otherLoanInterest, annualRate, years, method) {
  const annualIncome = income * 10000;
  if (annualIncome <= 0) return Infinity;
  const principalWon = calcMaxLoanByDti(60, annualIncome, (otherLoanInterest || 0) * 10000, annualRate, years, method);
  if (!Number.isFinite(principalWon)) return Infinity;
  return Math.max(0, principalWon / 100000000);
}

function getNewbornDtiLoanLimitEok(income, otherLoanInterest, annualRate, years, method) {
  return getDidimdolDtiLoanLimitEok(income, otherLoanInterest, annualRate, years, method);
}

function getFundLtvRate(region, house, product) {
  const isFirstBuyer = house === '생애최초';
  const safeRegion = region || '지방';
  const isMetroOrReg = safeRegion === '규제지역' || safeRegion === '수도권';
  if (product === 'bogeumjari') {
    if (isFirstBuyer) return isMetroOrReg ? 0.70 : 0.80;
    return safeRegion === '규제지역' ? 0.60 : 0.70;
  }
  if (product === 'didimdol' || product === 'newborn') {
    if (isFirstBuyer) return isMetroOrReg ? 0.70 : 0.80;
    return 0.70;
  }
  return 0.70;
}

function getDefaultRoomRegionKey(region) {
  if (region === '규제지역') return 'seoul';
  if (region === '수도권') return 'metro';
  return 'other';
}

function getRoomDeductionState(product, baseLimit, income, price, house, region, regionKey, desiredOn, household) {
  const key = regionKey || getDefaultRoomRegionKey(region);
  const rawDeduction = Math.min(ROOM_DEDUCTION_AMOUNTS[key] || 0, price * 0.5);
  const group = household || '';
  let checked = true;
  let locked = true;
  let toggleVisible = false;
  let note = '';

  if (product === 'didimdol') {
    const specialHousehold = group === '신혼' || group === '2자녀이상';
    const canWaive = price <= 3 || (house === '생애최초' && price <= (specialHousehold ? 6 : 5));
    toggleVisible = canWaive;
    locked = !canWaive;
    checked = canWaive ? !!desiredOn : true;
    note = canWaive
      ? (checked
        ? '방공제를 적용한 예상 한도예요. 보증 가능 조건을 가정해 제외했을 때의 차이는 토글로 확인할 수 있어요.'
        : '보증 가능 조건을 가정해 방공제를 제외한 예상 한도예요. 실제 실행 가능 여부는 보증 심사와 조건에 따라 달라질 수 있어요.')
      : '현재 조건에서는 방공제가 기본 적용되는 것으로 계산했어요. 디딤돌은 가격·생애최초·가구유형에 따라 일부 보증 가능 구간에서만 제외 가능성을 반영합니다.';
  } else if (product === 'newborn') {
    const canWaive = house === '생애최초' && price <= 6;
    toggleVisible = canWaive;
    locked = !canWaive;
    checked = canWaive ? !!desiredOn : true;
    note = canWaive
      ? (checked
        ? '실거주 목적 기준으로 단순화해 방공제를 적용한 예상 한도예요. 생애최초·6억 이하 조건에서는 제외했을 때의 차이를 토글로 확인할 수 있어요.'
        : '실거주 목적 기준으로 단순화해 방공제를 제외한 예상 한도예요. 실제 보증 가능 여부와 실행 조건에 따라 달라질 수 있어요.')
      : '현재 조건에서는 방공제를 적용한 예상 한도로 계산했어요. 신생아 특례는 생애최초이면서 주택가격 6억원 이하인 경우에만 방공제 제외 가능성을 반영합니다.';
  }

  const deduction = checked ? rawDeduction : 0;
  return {
    key,
    checked,
    locked,
    toggleVisible,
    rawDeduction,
    deduction,
    finalLimit: Math.max(0, baseLimit - deduction),
    note,
  };
}

function failDReasons(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house) {
  const reasons = [];
  if (!dHouseOk) reasons.push(`주택상황 (${house}) — 무주택·생애최초만 해당`);
  if (!dAssetOk) reasons.push(`순자산 ${asset}억 > 5.11억`);
  if (!dIncomeOk) reasons.push(`소득 ${income.toLocaleString()}만 > ${dIncomeLimit.toLocaleString()}만`);
  if (!dPriceOk) reasons.push(`주택가격 ${price}억 > ${dPriceLimit}억`);
  return reasons;
}

function productResponse(key, eligible, values, failReasons = []) {
  const roomState = values.roomState || null;
  return {
    key,
    eligible,
    failReasons,
    finalLimit: values.finalLimit,
    displayLimit: roomState ? roomState.finalLimit : values.finalLimit,
    ltvLimit: values.ltvLimit,
    maxLimit: values.maxLimit,
    dtiLimit: values.dtiLimit,
    roomDeductionApplied: roomState ? roomState.checked : false,
    roomDeduction: roomState ? {
      defaultApplied: roomState.checked,
      canToggle: roomState.toggleVisible,
      on: getRoomDeductionState(key, values.finalLimit, values.income, values.price, values.house, values.region, null, true, values.household),
      off: roomState.toggleVisible ? getRoomDeductionState(key, values.finalLimit, values.income, values.price, values.house, values.region, null, false, values.household) : null,
    } : null,
    rate: values.rate,
    limitNote: values.limitNote || '',
    loanRatioBar: values.price > 0 ? Math.round(((roomState ? roomState.finalLimit : values.finalLimit) / values.price) * 100) : 0,
    warnings: [],
    notes: [],
  };
}

function calculateFundLoan(input) {
  const income = Number(input.income || 0);
  const price = Number(input.price || 0);
  const asset = Number(input.asset || 0);
  const otherLoanInterest = Number(input.otherLoanInterest || 0);
  const household = input.household || '';
  const house = input.house || '';
  const children = input.children || '';
  const region = input.region || '';
  const isNewborn = children === '신생아';

  const nbHouseOk = house === '무주택' || house === '생애최초' || house === '1주택(대환)';
  const nbIncomeOk = income <= 20000;
  const nbAssetOk = asset <= 5.11;
  const nbPriceOk = price <= 9;
  const newbornOk = isNewborn && nbHouseOk && nbIncomeOk && nbAssetOk && nbPriceOk;

  const nbLtvRate = getFundLtvRate(region, house, 'newborn');
  const nbLtvLimit = price * nbLtvRate;
  const nbMaxLimit = 4.0;
  const nbRate = isNewborn ? getNewbornRate(income) : null;
  const nbDefaultRate = nbRate ? nbRate.rate : getNewbornRate(income, 30).rate;
  const nbDtiLimit = getNewbornDtiLoanLimitEok(income, otherLoanInterest, nbDefaultRate, 30, 'annuity');
  const nbFinalLimit = Math.min(nbLtvLimit, nbMaxLimit, Number.isFinite(nbDtiLimit) ? nbDtiLimit : Infinity);
  const nbRoomState = getRoomDeductionState('newborn', nbFinalLimit, income, price, house, region, null, true, household);

  const dHouseOk = house === '무주택' || house === '생애최초';
  const dAssetOk = asset <= 5.11;
  let dIncomeLimit = 6000;
  if (house === '생애최초' || children === '2명이상' || isNewborn) dIncomeLimit = 7000;
  if (household === '신혼') dIncomeLimit = 8500;
  const dIncomeOk = income <= dIncomeLimit;
  let dPriceLimit = 5;
  if (household === '신혼' || children === '2명이상' || isNewborn) dPriceLimit = 6;
  const dPriceOk = price <= dPriceLimit;
  const didimdolOk = dHouseOk && dAssetOk && dIncomeOk && dPriceOk;

  let dMaxLimit = 2.0;
  if (household === '신혼' || children === '2명이상' || isNewborn) dMaxLimit = 3.2;
  else if (house === '생애최초') dMaxLimit = 2.4;
  const dLtvRate = getFundLtvRate(region, house, 'didimdol');
  const dLtvLimit = price * dLtvRate;
  const dBaseRate = getDidimdolBaseRate(income, household, 30);
  const dDtiLimit = getDidimdolDtiLoanLimitEok(income, otherLoanInterest, dBaseRate, 30, 'annuity');
  const dFinalLimit = Math.min(dLtvLimit, dMaxLimit, Number.isFinite(dDtiLimit) ? dDtiLimit : Infinity);
  const dRoomState = getRoomDeductionState('didimdol', dFinalLimit, income, price, house, region, null, true, household);

  const bHouseOk = house !== '1주택이상';
  let bIncomeLimit = 7000;
  if (household === '신혼') bIncomeLimit = 8500;
  if (children === '1명') bIncomeLimit = Math.max(bIncomeLimit, 9000);
  if (children === '2명이상') bIncomeLimit = 10000;
  const bIncomeOk = income <= bIncomeLimit;
  const bPriceOk = price <= 6;
  const bogeumjariOk = bHouseOk && bIncomeOk && bPriceOk;

  let bMaxLimit = 3.6;
  if (house === '생애최초') bMaxLimit = 4.2;
  else if (children === '2명이상' || isNewborn) bMaxLimit = 4.0;
  const bLtvRate = getFundLtvRate(region, house, 'bogeumjari');
  const bLtvLimit = price * bLtvRate;
  const bDefaultRate = getBogeumBaseRate(30) + getBogeumRegulationSurcharge(region);
  const bDtiLimit = getBogeumDtiLoanLimitEok(income, price, region, house, otherLoanInterest, bDefaultRate, 30, 'annuity');
  const bFinalLimit = Math.min(bLtvLimit, bMaxLimit, Number.isFinite(bDtiLimit) ? bDtiLimit : Infinity);

  const failNb = [];
  if (!nbHouseOk) failNb.push(`주택상황 (${house}) — 무주택·생애최초·1주택(대환 목적)만 해당`);
  if (!nbIncomeOk) failNb.push(`소득 ${income.toLocaleString()}만 > 20,000만 (2억)`);
  if (!nbAssetOk) failNb.push(`순자산 ${asset}억 > 5.11억`);
  if (!nbPriceOk) failNb.push(`주택가격 ${price}억 > 9억`);
  const failD = failDReasons(dHouseOk, dAssetOk, dIncomeOk, dPriceOk, asset, income, dIncomeLimit, price, dPriceLimit, house);
  const failB = [];
  if (!bHouseOk) failB.push(`주택상황 (${house}) — 1주택 이상은 해당 없음`);
  if (!bIncomeOk) failB.push(`소득 ${income.toLocaleString()}만 > ${bIncomeLimit.toLocaleString()}만`);
  if (!bPriceOk) failB.push(`주택가격 ${price}억 > 6억`);

  return {
    ok: true,
    loanType: 'fund',
    inputs: { income, price, asset, otherLoanInterest, household, house, children, region },
    eligibility: {
      isNewborn,
      newbornOk,
      didimdolOk,
      bogeumjariOk,
      nbHouseOk,
      nbIncomeOk,
      nbAssetOk,
      nbPriceOk,
      dHouseOk,
      dAssetOk,
      dIncomeOk,
      dPriceOk,
      dIncomeLimit,
      dPriceLimit,
      bHouseOk,
      bIncomeOk,
      bPriceOk,
      bIncomeLimit,
    },
    products: {
      newborn: productResponse('newborn', newbornOk, {
        finalLimit: nbFinalLimit,
        ltvLimit: nbLtvLimit,
        maxLimit: nbMaxLimit,
        dtiLimit: nbDtiLimit,
        roomState: nbRoomState,
        income,
        price,
        house,
        region,
        household,
        rate: {
          default: nbDefaultRate,
          min: nbRate ? nbRate.min : getNewbornRate(income).min,
          max: nbRate ? nbRate.max : getNewbornRate(income).max,
          label: nbRate ? nbRate.label : getNewbornRate(income).label,
          candidates: [],
          cap: { minRate: 1.2 },
        },
      }, failNb),
      didimdol: productResponse('didimdol', didimdolOk, {
        finalLimit: dFinalLimit,
        ltvLimit: dLtvLimit,
        maxLimit: dMaxLimit,
        dtiLimit: dDtiLimit,
        roomState: dRoomState,
        income,
        price,
        house,
        region,
        household,
        rate: {
          default: dBaseRate,
          candidates: [],
          cap: { minRate: 1.2, maxDiscount: 0.5 },
        },
      }, failD),
      bogeumjari: productResponse('bogeumjari', bogeumjariOk, {
        finalLimit: bFinalLimit,
        ltvLimit: bLtvLimit,
        maxLimit: bMaxLimit,
        dtiLimit: bDtiLimit,
        roomState: null,
        income,
        price,
        house,
        region,
        household,
        rate: {
          default: bDefaultRate,
          candidates: [],
          cap: { minRate: 1.2, maxDiscount: 1.0 },
        },
      }, failB),
    },
    legacy: {
      newbornOk,
      didimdolOk,
      bogeumjariOk,
      nbRate,
      nbLtvLimit,
      nbMaxLimit,
      nbFinalLimit,
      nbDtiLimit,
      nbHouseOk,
      nbIncomeOk,
      nbAssetOk,
      nbPriceOk,
      dLtvLimit,
      dMaxLimit,
      dFinalLimit,
      dDtiLimit,
      dIncomeLimit,
      dPriceLimit,
      bLtvLimit,
      bMaxLimit,
      bFinalLimit,
      bIncomeLimit,
      bDtiLimit,
    },
    failReasons: {
      newborn: failNb,
      didimdol: failD,
      bogeumjari: failB,
    },
    summary: {
      maxFinalLimit: Math.max(
        newbornOk ? nbRoomState.finalLimit : 0,
        didimdolOk ? dRoomState.finalLimit : 0,
        bogeumjariOk ? bFinalLimit : 0,
      ),
    },
    warnings: [],
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(204, {});
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' });

  try {
    const payload = JSON.parse(event.body || '{}');
    return jsonResponse(200, calculateFundLoan(payload));
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error?.message || 'Loan calculation failed.' });
  }
};

exports._private = { calculateFundLoan };
