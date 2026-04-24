#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const KEY = process.env.MOLIT_API_KEY;
const BASE_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
const PAGE_SIZE = 1000;
const MONTH_WINDOW = Number(process.env.MOLIT_MONTH_WINDOW || 3);
const CONCURRENCY = Number(process.env.MOLIT_CONCURRENCY || 8);
const RECENT_DEAL_LIMIT = 12;
const POPULAR_COMPLEX_LIMIT = 12;

function getRecentMonths(count) {
  const now = new Date();
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function getCurrentMonthId() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseAmount(value) {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(num) ? num : null;
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function pctChange(curr, prev) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  return Number(((curr - prev) / prev * 100).toFixed(2));
}

function median(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

function average(values) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return null;
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`MOLIT API failed: ${res.status} ${text.slice(0, 120)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`MOLIT API returned non-JSON: ${text.slice(0, 120)}`);
  }
}

function buildUrl({ lawdCd, month, pageNo }) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    LAWD_CD: lawdCd,
    DEAL_YMD: month,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    _type: 'json',
  });
  return `${BASE_URL}?${params}`;
}

async function fetchTradeRows(lawdCd, month) {
  const first = await fetchJson(buildUrl({ lawdCd, month, pageNo: 1 }));
  const body = first?.response?.body || {};
  const totalCount = Number(body.totalCount || 0);
  const rows = toArray(body.items?.item);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
    const next = await fetchJson(buildUrl({ lawdCd, month, pageNo }));
    rows.push(...toArray(next?.response?.body?.items?.item));
  }

  return rows;
}

function normalizeTrade(row, sigungu) {
  const price = parseAmount(row.dealAmount);
  const area = parseNumber(row.excluUseAr);
  const year = Number(row.dealYear);
  const month = Number(row.dealMonth);
  const day = Number(row.dealDay);
  const canceled = String(row.cdealType || '').trim() !== '';

  if (!price || !year || !month || !day || canceled) return null;

  const dealMonth = `${year}${String(month).padStart(2, '0')}`;
  const dealDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const pricePerPyeong = area ? Math.round(price / (area / 3.3058)) : null;

  return {
    aptName: String(row.aptNm || '').trim(),
    sidoId: sigungu.sidoId,
    sidoName: sigungu.sidoName,
    sigunguCode: sigungu.code,
    sigunguName: sigungu.sigunguName,
    umdName: String(row.umdNm || '').trim(),
    area,
    price,
    pricePerPyeong,
    floor: parseNumber(row.floor),
    buildYear: parseNumber(row.buildYear),
    dealDate,
    dealMonth,
  };
}

async function runLimited(tasks, limit) {
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await tasks[current]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function summarizeRegion(regionName, deals, months, summaryMonth) {
  const monthly = months.map(month => {
    const monthDeals = deals.filter(deal => deal.dealMonth === month);
    return {
      month,
      count: monthDeals.length,
      medianPrice: median(monthDeals.map(deal => deal.price)),
      avgPrice: average(monthDeals.map(deal => deal.price)),
      medianPricePerPyeong: median(monthDeals.map(deal => deal.pricePerPyeong)),
    };
  });

  const summaryMonthIndex = Math.max(0, months.indexOf(summaryMonth));
  const completedMonthly = monthly.slice(0, summaryMonthIndex + 1);
  const latestWithData = [...completedMonthly].reverse().find(entry => entry.count > 0) || completedMonthly[completedMonthly.length - 1] || monthly[monthly.length - 1];
  const latestIndex = monthly.findIndex(entry => entry.month === latestWithData?.month);
  const prev = latestIndex > 0 ? monthly[latestIndex - 1] : null;
  const sortedDeals = [...deals].sort((a, b) => {
    if (a.dealDate !== b.dealDate) return b.dealDate.localeCompare(a.dealDate);
    return b.price - a.price;
  });
  const popularComplexes = getPopularComplexes(
    deals.filter(deal => deal.dealMonth === latestWithData?.month),
    POPULAR_COMPLEX_LIMIT,
  );
  const cityScopes = getCityScopes(
    deals.filter(deal => deal.dealMonth === latestWithData?.month),
    POPULAR_COMPLEX_LIMIT,
  );

  return {
    regionName,
    totalTradeCount: deals.length,
    tradeCount: latestWithData?.count || 0,
    medianPrice: latestWithData?.medianPrice || null,
    avgPrice: latestWithData?.avgPrice || null,
    medianPricePerPyeong: latestWithData?.medianPricePerPyeong || null,
    latestDealMonth: latestWithData?.month || '',
    latestDealDate: sortedDeals[0]?.dealDate || '',
    recentDeals: sortedDeals.slice(0, RECENT_DEAL_LIMIT),
    popularComplexes,
    cityScopes,
    monthly,
    signals: {
      countChangePct: pctChange(latestWithData?.count, prev?.count),
      medianChangePct: pctChange(latestWithData?.medianPrice, prev?.medianPrice),
      pricePerPyeongChangePct: pctChange(latestWithData?.medianPricePerPyeong, prev?.medianPricePerPyeong),
    },
  };
}

function getCityLabel(deal) {
  const sigunguName = String(deal.sigunguName || '').trim();
  const cityMatch = sigunguName.match(/([가-힣]+시)/);
  if (cityMatch) return cityMatch[1];
  const districtMatch = sigunguName.match(/([가-힣]+구)/);
  return districtMatch ? districtMatch[1] : null;
}

function getCityScopes(deals, complexLimit) {
  const grouped = new Map();

  for (const deal of deals) {
    const cityName = getCityLabel(deal);
    if (!cityName) continue;
    const existing = grouped.get(cityName) || [];
    existing.push(deal);
    grouped.set(cityName, existing);
  }

  return [...grouped.entries()]
    .map(([name, cityDeals]) => ({
      name,
      tradeCount: cityDeals.length,
      popularComplexes: getPopularComplexes(cityDeals, complexLimit),
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount);
}

function getPopularComplexes(deals, limit) {
  const groups = new Map();

  for (const deal of deals) {
    if (!deal.aptName) continue;
    const key = [deal.sigunguCode, deal.umdName, deal.aptName].join('|');
    const existing = groups.get(key) || {
      aptName: deal.aptName,
      sigunguCode: deal.sigunguCode,
      sigunguName: deal.sigunguName,
      umdName: deal.umdName,
      tradeCount: 0,
      prices: [],
      areas: [],
      latestDealDate: '',
      latestTradePrice: null,
      latestTradeArea: null,
    };

    existing.tradeCount += 1;
    if (Number.isFinite(deal.price)) existing.prices.push(deal.price);
    if (Number.isFinite(deal.area)) existing.areas.push(deal.area);
    if (!existing.latestDealDate || deal.dealDate > existing.latestDealDate) {
      existing.latestDealDate = deal.dealDate;
      existing.latestTradePrice = deal.price;
      existing.latestTradeArea = deal.area;
    } else if (deal.dealDate === existing.latestDealDate && Number.isFinite(deal.price)) {
      existing.latestTradePrice = deal.price;
      existing.latestTradeArea = deal.area;
    }
    groups.set(key, existing);
  }

  return [...groups.values()]
    .map(group => ({
      aptName: group.aptName,
      sigunguCode: group.sigunguCode,
      sigunguName: group.sigunguName,
      umdName: group.umdName,
      tradeCount: group.tradeCount,
      medianPrice: median(group.prices),
      avgPrice: average(group.prices),
      avgArea: average(group.areas),
      latestDealDate: group.latestDealDate,
      latestTradePrice: group.latestTradePrice,
      latestTradeArea: group.latestTradeArea,
    }))
    .sort((a, b) => {
      if (a.tradeCount !== b.tradeCount) return b.tradeCount - a.tradeCount;
      if (a.latestDealDate !== b.latestDealDate) return b.latestDealDate.localeCompare(a.latestDealDate);
      return (b.medianPrice || 0) - (a.medianPrice || 0);
    })
    .slice(0, limit);
}

async function main() {
  if (!KEY) throw new Error('MOLIT_API_KEY is required.');

  const root = process.cwd();
  const sigunguPath = path.join(root, 'data', 'sigungu-codes.json');
  const sigunguData = JSON.parse(await fs.readFile(sigunguPath, 'utf8'));
  const sigunguCodes = sigunguData.codes || [];
  const months = getRecentMonths(MONTH_WINDOW);
  const currentMonth = getCurrentMonthId();
  const summaryMonth = months.filter(month => month !== currentMonth).slice(-1)[0] || months[months.length - 1];
  const tasks = [];
  let callCount = 0;

  console.log(`Updating MOLIT apartment trades: ${sigunguCodes.length} regions x ${months.length} months`);

  for (const sigungu of sigunguCodes) {
    for (const month of months) {
      tasks.push(async () => {
        const rows = await fetchTradeRows(sigungu.code, month);
        callCount += 1;
        return rows
          .map(row => normalizeTrade(row, sigungu))
          .filter(Boolean);
      });
    }
  }

  const chunks = await runLimited(tasks, CONCURRENCY);
  const allDeals = chunks.flat();
  const bySido = {};
  const bySigungu = {};

  for (const deal of allDeals) {
    const sidoKey = String(deal.sidoId);
    if (!bySido[sidoKey]) bySido[sidoKey] = [];
    bySido[sidoKey].push(deal);
    if (!bySigungu[deal.sigunguCode]) bySigungu[deal.sigunguCode] = [];
    bySigungu[deal.sigunguCode].push(deal);
  }

  const sido = {
    500001: summarizeRegion('전국', allDeals, months, summaryMonth),
  };
  const sigungu = {};
  const sidoNames = new Map(sigunguCodes.map(code => [String(code.sidoId), code.sidoName]));
  for (const [sidoId, deals] of Object.entries(bySido)) {
    sido[sidoId] = summarizeRegion(sidoNames.get(sidoId) || sidoId, deals, months, summaryMonth);
  }
  for (const code of sigunguCodes) {
    sigungu[code.code] = {
      sidoId: code.sidoId,
      sidoName: code.sidoName,
      sigunguName: code.sigunguName,
      ...summarizeRegion(code.sigunguName, bySigungu[code.code] || [], months, summaryMonth),
    };
  }

  const payload = {
    meta: {
      source: 'MOLIT_RTMS_APT_TRADE',
      generatedAt: new Date().toISOString(),
      scope: 'national',
      months,
      summaryMonth,
      sigunguCount: sigunguCodes.length,
      dealCount: allDeals.length,
      callCount,
    },
    sido,
    sigungu,
  };

  const outputPath = path.join(root, 'data', 'apt-trades-summary.json');
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
  console.log(`Deals=${allDeals.length}, calls=${callCount}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
