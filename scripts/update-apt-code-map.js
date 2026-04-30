#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const KEY = process.env.MOLIT_HOUSING_API_KEY || process.env.MOLIT_API_KEY;
const BASE_URL = 'https://apis.data.go.kr/1613000/AptListService3/getTotalAptList3';
const PAGE_SIZE = Math.max(1, Number(process.env.APT_CODE_MAP_ROWS || 1000));
const OUTPUT_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');

function toArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`AptListService failed: ${response.status} ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`AptListService returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function buildUrl(pageNo) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
    _type: 'json',
  });
  return `${BASE_URL}?${params}`;
}

function normalizeEntry(item) {
  const bjdCode = String(item.bjdCode || '').trim();
  return {
    kaptCode: String(item.kaptCode || '').trim(),
    kaptName: String(item.kaptName || '').trim(),
    as1: String(item.as1 || '').trim(),
    as2: String(item.as2 || '').trim(),
    as3: String(item.as3 || '').trim(),
    as4: String(item.as4 || '').trim(),
    bjdCode,
    sigunguCode: bjdCode.slice(0, 5),
    umdName: [item.as3, item.as4].filter(Boolean).join(' ').trim(),
  };
}

function extractListItems(body) {
  return toArray(body?.items?.item || body?.items);
}

async function main() {
  if (!KEY) throw new Error('MOLIT_API_KEY or MOLIT_HOUSING_API_KEY is required.');

  const first = await fetchJson(buildUrl(1));
  const body = first?.response?.body || {};
  const totalCount = Number(body.totalCount || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const items = extractListItems(body).map(normalizeEntry);

  for (let pageNo = 2; pageNo <= totalPages; pageNo += 1) {
    const next = await fetchJson(buildUrl(pageNo));
    items.push(...extractListItems(next?.response?.body).map(normalizeEntry));
  }

  const payload = {
    meta: {
      source: 'MOLIT_APT_LIST_SERVICE3',
      generatedAt: new Date().toISOString(),
      totalCount,
      totalPages,
      pageSize: PAGE_SIZE,
    },
    items,
  };

  const outputPath = path.join(process.cwd(), OUTPUT_PATH);
  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
  console.log(`Apartments=${items.length}, pages=${totalPages}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
