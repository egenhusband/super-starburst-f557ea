(function () {
  const WON_PER_EOK = 100000000;
  const PROPERTY_TAX_FAIR_MARKET_RATIO = 0.6;
  const ONE_HOME_PROPERTY_TAX_RATIOS = {
    under3: 0.43,
    under6: 0.44,
    over6: 0.45,
  };
  const DEFAULT_OFFICIAL_PRICE_RATIO = 0.65;
  const ONE_HOUSE_JONGBOO_DEDUCTION_EOK = 12;
  const GENERAL_JONGBOO_DEDUCTION_EOK = 9;

  function toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundWon(value) {
    return Math.round(toNumber(value, 0));
  }

  function getStandardAcquisitionRate(priceEok) {
    if (priceEok <= 6) return 0.01;
    if (priceEok <= 9) {
      const ratePercent = (priceEok * 2 / 3) - 3;
      return clamp(ratePercent / 100, 0.01, 0.03);
    }
    return 0.03;
  }

  function getAcquisitionProfile(options = {}) {
    const priceEok = toNumber(options.priceEok, 0);
    const homeCount = Math.max(1, Math.floor(toNumber(options.homeCount, 1)));
    const isCorporate = options.isCorporate === true;
    const isRegulatedArea = options.isRegulatedArea === true;

    if (isCorporate) return { rate: 0.12, educationRate: 0.004, ruralRate: 0.01, label: '법인 중과' };
    if (isRegulatedArea && homeCount >= 3) return { rate: 0.12, educationRate: 0.004, ruralRate: 0.01, label: '다주택 중과' };
    if (isRegulatedArea && homeCount >= 2) return { rate: 0.08, educationRate: 0.004, ruralRate: 0.006, label: '2주택 중과' };
    if (!isRegulatedArea && homeCount >= 4) return { rate: 0.12, educationRate: 0.004, ruralRate: 0.01, label: '다주택 중과' };
    if (!isRegulatedArea && homeCount >= 3) return { rate: 0.08, educationRate: 0.004, ruralRate: 0.006, label: '3주택 중과' };

    const rate = getStandardAcquisitionRate(priceEok);
    return { rate, educationRate: rate * 0.1, ruralRate: 0.002, label: '일반세율' };
  }

  function calculateAcquisitionTax(options = {}) {
    const priceEok = Math.max(0, toNumber(options.priceEok, 0));
    const taxableWon = priceEok * WON_PER_EOK;
    const isOver85 = options.isOver85 === true;
    const profile = getAcquisitionProfile(options);
    const acquisitionTax = roundWon(taxableWon * profile.rate);
    const localEducationTax = roundWon(taxableWon * profile.educationRate);
    const ruralSpecialTax = isOver85 ? roundWon(taxableWon * profile.ruralRate) : 0;
    const total = acquisitionTax + localEducationTax + ruralSpecialTax;

    return {
      priceEok,
      basisLabel: `${profile.label}${isOver85 ? ' · 전용 85㎡ 초과' : ' · 전용 85㎡ 이하'}`,
      acquisitionTax,
      localEducationTax,
      ruralSpecialTax,
      total,
      totalEok: total / WON_PER_EOK,
      effectiveRate: taxableWon > 0 ? total / taxableWon : 0,
    };
  }

  function calculatePropertyTax(options = {}) {
    const officialPriceEok = Math.max(0, toNumber(options.officialPriceEok, 0));
    const isOneHouseholdOneHome = options.isOneHouseholdOneHome === true;
    const fairMarketRatio = isOneHouseholdOneHome
      ? officialPriceEok <= 3
        ? ONE_HOME_PROPERTY_TAX_RATIOS.under3
        : officialPriceEok <= 6
          ? ONE_HOME_PROPERTY_TAX_RATIOS.under6
          : ONE_HOME_PROPERTY_TAX_RATIOS.over6
      : PROPERTY_TAX_FAIR_MARKET_RATIO;
    const taxableBaseWon = officialPriceEok * WON_PER_EOK * fairMarketRatio;
    const useOneHomeSpecialRate = isOneHouseholdOneHome && officialPriceEok <= 9;
    let propertyTax = 0;

    if (useOneHomeSpecialRate && taxableBaseWon <= 60000000) {
      propertyTax = taxableBaseWon * 0.0005;
    } else if (useOneHomeSpecialRate && taxableBaseWon <= 150000000) {
      propertyTax = 30000 + ((taxableBaseWon - 60000000) * 0.001);
    } else if (useOneHomeSpecialRate && taxableBaseWon <= 300000000) {
      propertyTax = 120000 + ((taxableBaseWon - 150000000) * 0.002);
    } else if (useOneHomeSpecialRate) {
      propertyTax = 420000 + ((taxableBaseWon - 300000000) * 0.0035);
    } else if (taxableBaseWon <= 60000000) {
      propertyTax = taxableBaseWon * 0.001;
    } else if (taxableBaseWon <= 150000000) {
      propertyTax = 60000 + ((taxableBaseWon - 60000000) * 0.0015);
    } else if (taxableBaseWon <= 300000000) {
      propertyTax = 195000 + ((taxableBaseWon - 150000000) * 0.0025);
    } else {
      propertyTax = 570000 + ((taxableBaseWon - 300000000) * 0.004);
    }

    const propertyTaxWon = roundWon(propertyTax);
    const localEducationTax = roundWon(propertyTaxWon * 0.2);
    const cityAreaTax = options.includeCityAreaTax === false ? 0 : roundWon(taxableBaseWon * 0.0014);
    const total = propertyTaxWon + localEducationTax + cityAreaTax;

    return {
      officialPriceEok,
      fairMarketRatio,
      oneHomeSpecialRateApplied: useOneHomeSpecialRate,
      taxableBaseWon: roundWon(taxableBaseWon),
      propertyTax: propertyTaxWon,
      localEducationTax,
      cityAreaTax,
      total,
      totalEok: total / WON_PER_EOK,
      basisLabel: (options.isEstimated ? '공시가격 추정' : '공시가격') + (isOneHouseholdOneHome ? ' · 1주택 특례' : '') + ' 기준',
    };
  }

  function getJongbooPossibility(options = {}) {
    const officialPriceEok = Math.max(0, toNumber(options.officialPriceEok, 0));
    const isOneHouseholdOneHome = options.isOneHouseholdOneHome !== false;
    const threshold = isOneHouseholdOneHome ? ONE_HOUSE_JONGBOO_DEDUCTION_EOK : GENERAL_JONGBOO_DEDUCTION_EOK;
    const overAmount = Math.max(0, officialPriceEok - threshold);

    if (!officialPriceEok) {
      return {
        status: 'unknown',
        label: '종부세 확인 필요',
        desc: '공시가격과 보유 주택 합산액에 따라 달라져요.',
        threshold,
      };
    }
    if (overAmount <= 0) {
      return {
        status: 'low',
        label: '종부세 가능성 낮음',
        desc: `${isOneHouseholdOneHome ? '1주택' : '일반'} 기준 공제금액 ${threshold}억 이하로 추정돼요.`,
        threshold,
      };
    }
    return {
      status: 'check',
      label: '종부세 확인 필요',
      desc: `공시가격 기준 ${threshold}억 초과분이 있어 보유 주택 합산 확인이 필요해요.`,
      threshold,
      overAmount,
    };
  }

  function estimateOfficialPriceEok(priceEok) {
    return Math.max(0, toNumber(priceEok, 0) * DEFAULT_OFFICIAL_PRICE_RATIO);
  }

  window.RealEstateTax = {
    constants: {
      propertyTaxFairMarketRatio: PROPERTY_TAX_FAIR_MARKET_RATIO,
      oneHomePropertyTaxRatios: ONE_HOME_PROPERTY_TAX_RATIOS,
      defaultOfficialPriceRatio: DEFAULT_OFFICIAL_PRICE_RATIO,
      oneHouseJongbooDeductionEok: ONE_HOUSE_JONGBOO_DEDUCTION_EOK,
      generalJongbooDeductionEok: GENERAL_JONGBOO_DEDUCTION_EOK,
    },
    calculateAcquisitionTax,
    calculatePropertyTax,
    getJongbooPossibility,
    estimateOfficialPriceEok,
  };
})();
