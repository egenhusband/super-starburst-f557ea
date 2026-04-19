const KEY = '011e9c482bc2432198b0ac0a8cec2f1b';
const BASE_URL = 'https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do';
const PAGE_SIZE = 1000;
const START_MONTH_WINDOW = 14;

const STAT = {
  avgPrice: 'A_2024_00188',
  avgJeonse: 'A_2024_00192',
  jeonseSupply: 'A_2024_00077',
  priceIndex: 'A_2024_00178',
  tradeVolume: 'A_2024_00554',
};

const TRADE_REGION_ID_MAP = {
  500001: 500001,
  500004: 500002,
  500005: 500003,
  500006: 500004,
  500007: 500005,
  500008: 500006,
  500009: 500007,
  500010: 500008,
  500011: 500009,
  500012: 500010,
  500013: 500011,
  500014: 500012,
  500015: 500013,
  500016: 500014,
  500017: 500015,
  500018: 500016,
  500019: 500017,
  500020: 500019,
};

const JEONSE_SUPPLY_REGION_ID_MAP = {
  500001: 500001,
  500004: 500008,
  500012: 500009,
  500007: 500010,
  500005: 500011,
  500006: 500012,
  500008: 500013,
  500009: 500014,
  500010: 500015,
  500011: 500016,
  500013: 500017,
  500014: 500018,
  500015: 500019,
  500016: 500020,
  500017: 500021,
  500018: 500022,
  500019: 500023,
  500020: 500024,
};

function getStartDate(months) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  return `${start.getFullYear()}${String(start.getMonth() + 1).padStart(2, '0')}`;
}

function parseNumericValue(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function getRecentValidRows(rows, minValue = null) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => {
    const value = parseNumericValue(row?.DTA_VAL);
    if (value === null) return false;
    return minValue === null ? true : value > minValue;
  });
}

function prevMonthStr(yyyymm) {
  const y = parseInt(yyyymm.slice(0, 4), 10);
  const m = parseInt(yyyymm.slice(4, 6), 10);
  return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
}

function calcPriceChange(rows) {
  const validRows = getRecentValidRows(rows);
  if (validRows.length < 2) return null;
  const currRow = validRows[validRows.length - 1];
  const prevRow = validRows[validRows.length - 2];
  if (prevRow.WRTTIME_IDTFR_ID !== prevMonthStr(currRow.WRTTIME_IDTFR_ID)) return null;
  const prev = parseNumericValue(prevRow.DTA_VAL);
  const curr = parseNumericValue(currRow.DTA_VAL);
  if (prev === null || curr === null || prev === 0) return null;
  return Number(((curr - prev) / prev * 100).toFixed(2));
}

function calcTradeChange(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const currRow = rows[rows.length - 1];
  const prevRow = rows[rows.length - 2];
  if (prevRow.WRTTIME_IDTFR_ID !== prevMonthStr(currRow.WRTTIME_IDTFR_ID)) return null;
  const curr = parseNumericValue(currRow.DTA_VAL);
  const prev = parseNumericValue(prevRow.DTA_VAL);
  if (curr === null || prev === null || prev === 0) return null;
  return Number(((curr - prev) / prev * 100).toFixed(0));
}

function filterByRegion(rows, clsId) {
  const clsIdStr = String(clsId);
  return rows
    .filter(row => String(row.CLS_ID) === clsIdStr)
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function filterTradeByRegion(rows, clsId) {
  const tradeClsId = String(TRADE_REGION_ID_MAP[clsId] || clsId);
  return rows
    .filter(row => String(row.CLS_ID) === tradeClsId && String(row.ITM_ID) === '100001')
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function filterJeonseSupplyByRegion(rows, clsId) {
  const supplyClsId = String(JEONSE_SUPPLY_REGION_ID_MAP[clsId] || clsId);
  return rows
    .filter(row => String(row.CLS_ID) === supplyClsId && String(row.ITM_ID) === '100001')
    .sort((a, b) => a.WRTTIME_IDTFR_ID.localeCompare(b.WRTTIME_IDTFR_ID));
}

function getLatestCommonMonthId(rowGroups) {
  const monthSets = rowGroups
    .map(rows => new Set(getRecentValidRows(rows).map(row => row.WRTTIME_IDTFR_ID)))
    .filter(set => set.size > 0);

  if (monthSets.length !== rowGroups.length) return null;

  const [firstSet, ...restSets] = monthSets;
  const commonMonths = [...firstSet]
    .filter(monthId => restSets.every(set => set.has(monthId)))
    .sort();

  return commonMonths[commonMonths.length - 1] || null;
}

function clampRowsToMonth(rows, monthId) {
  if (!monthId) return rows;
  return rows.filter(row => row.WRTTIME_IDTFR_ID <= monthId);
}

function getMonthDesc(rows, monthId) {
  if (!monthId) return '';
  const row = rows.find(entry => entry.WRTTIME_IDTFR_ID === monthId);
  return row?.WRTTIME_DESC || '';
}

async function fetchStatPage(statblId, start, pIndex) {
  const params = new URLSearchParams({
    KEY,
    Type: 'json',
    pIndex: String(pIndex),
    pSize: String(PAGE_SIZE),
    STATBL_ID: statblId,
    DTACYCLE_CD: 'MM',
    START_WRTTIME: start,
  });

  const res = await fetch(`${BASE_URL}?${params}`);
  if (!res.ok) throw new Error(`REB API 호출 실패: ${statblId}`);
  const data = await res.json();
  if (!data?.SttsApiTblData) throw new Error(`REB API 데이터 오류: ${statblId}`);
  return data;
}

async function fetchAllRows(statblId, start) {
  const page1 = await fetchStatPage(statblId, start, 1);
  const rows = page1?.SttsApiTblData?.[1]?.row || [];
  const total = page1?.SttsApiTblData?.[0]?.head?.[0]?.list_total_count || 0;
  if (rows.length >= total) return rows;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const mergedRows = [...rows];

  for (let page = 2; page <= totalPages; page += 1) {
    const nextPage = await fetchStatPage(statblId, start, page);
    const nextRows = nextPage?.SttsApiTblData?.[1]?.row || [];
    mergedRows.push(...nextRows);
  }

  return mergedRows;
}

function buildSummary(detail) {
  const nationalPriceRows = filterByRegion(detail.priceData, 500001);
  const nationalJeonseRows = filterByRegion(detail.jeonseData, 500001);
  const nationalIndexRows = filterByRegion(detail.indexData, 500001);
  const nationalTradeRows = filterTradeByRegion(detail.tradeData, 500001);
  const nationalJeonseSupplyRows = filterJeonseSupplyByRegion(detail.jeonseSupplyData, 500001);
  const latestCommonMonthId = getLatestCommonMonthId([
    nationalPriceRows,
    nationalJeonseRows,
    nationalIndexRows,
    nationalTradeRows,
    nationalJeonseSupplyRows,
  ]);
  const validPriceRows = getRecentValidRows(clampRowsToMonth(nationalPriceRows, latestCommonMonthId), 0);
  const validIndexRows = clampRowsToMonth(nationalIndexRows, latestCommonMonthId);
  const validTradeRows = clampRowsToMonth(nationalTradeRows, latestCommonMonthId);
  const latestPriceRow = validPriceRows[validPriceRows.length - 1] || null;
  const latestTradeRow = validTradeRows[validTradeRows.length - 1] || null;

  return {
    national: {
      regionName: '전국',
      latestMonth: getMonthDesc(validPriceRows, latestCommonMonthId) || latestPriceRow?.WRTTIME_DESC || '',
      avgBuyPrice: latestPriceRow ? parseNumericValue(latestPriceRow.DTA_VAL) : null,
      priceChange: calcPriceChange(validIndexRows),
      tradeVolume: latestTradeRow ? parseNumericValue(latestTradeRow.DTA_VAL) : null,
      tradeChange: calcTradeChange(validTradeRows),
    }
  };
}

exports.handler = async function() {
  try {
    const start = getStartDate(START_MONTH_WINDOW);
    const [priceData, jeonseData, jeonseSupplyData, indexData, tradeData] = await Promise.all([
      fetchAllRows(STAT.avgPrice, start),
      fetchAllRows(STAT.avgJeonse, start),
      fetchAllRows(STAT.jeonseSupply, start),
      fetchAllRows(STAT.priceIndex, start),
      fetchAllRows(STAT.tradeVolume, start),
    ]);

    const detail = { priceData, jeonseData, jeonseSupplyData, indexData, tradeData };
    const payload = {
      meta: {
        source: 'REB',
        cachedAt: new Date().toISOString(),
        ttlHours: 168,
      },
      summary: buildSummary(detail),
      detail,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'CDN-Cache-Control': `public, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_TTL_SECONDS}`,
        'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_TTL_SECONDS}`,
      },
      body: JSON.stringify(payload),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const STALE_TTL_SECONDS = 24 * 60 * 60;
