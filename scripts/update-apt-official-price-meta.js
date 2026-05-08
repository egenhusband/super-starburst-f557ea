#!/usr/bin/env node

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const ROOT = process.cwd();
const CODE_MAP_PATH = path.join(ROOT, process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json'));
const OUTPUT_PATH = path.join(ROOT, process.env.APT_OFFICIAL_PRICE_META_OUTPUT || path.join('data', 'apt-official-price-meta.json'));
const SOURCE_PATH = process.env.APT_OFFICIAL_PRICE_SOURCE_PATH
  || '/Users/deukgyunman/Desktop/국토교통부_주택 공시가격 정보_20250626/국토교통부_주택 공시가격 정보(2025).csv';
const SCOPE = process.env.APT_OFFICIAL_PRICE_SCOPE || 'capital';
const LOG_EVERY = Math.max(10000, Number(process.env.APT_OFFICIAL_PRICE_LOG_EVERY || 50000));
const CHECKPOINT_EVERY = Math.max(LOG_EVERY, Number(process.env.APT_OFFICIAL_PRICE_CHECKPOINT_EVERY || 200000));

function normalizePlaceToken(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/[()[\]{}.,·ㆍ'"`~!@#$%^&*_=+|\\/:;<>?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeAptName(value = '') {
  return String(value)
    .normalize('NFKC')
    .replace(/에스케이/giu, 'sk')
    .replace(/이편한세상/giu, 'e편한세상')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/주상복합/giu, ' ')
    .replace(/아파트/giu, ' ')
    .replace(/임대/giu, ' ')
    .replace(/분양/giu, ' ')
    .replace(/[·ㆍ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildCompositeKey(sigunguName = '', umdName = '', aptName = '') {
  const sigungu = normalizePlaceToken(sigunguName);
  const umd = normalizePlaceToken(umdName);
  const apt = normalizePlaceToken(aptName);
  if (!sigungu || !apt) return '';
  return [sigungu, umd, apt].filter(Boolean).join('|');
}

function buildRelaxedCompositeKey(sigunguName = '', aptName = '') {
  const sigungu = normalizePlaceToken(sigunguName);
  const apt = normalizeAptName(aptName);
  if (!sigungu || !apt) return '';
  return `${sigungu}|${apt}`;
}

function isInScopeBySido(sidoName) {
  if (SCOPE === 'seoul') return sidoName === '서울특별시';
  if (SCOPE === 'gyeonggi') return sidoName === '경기도';
  if (SCOPE === 'capital') return sidoName === '서울특별시' || sidoName === '경기도';
  return true;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      result.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function computeMedian(sortedValues) {
  if (!sortedValues.length) return null;
  const mid = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 0) return Math.round((sortedValues[mid - 1] + sortedValues[mid]) / 2);
  return sortedValues[mid];
}

function buildEntriesFromAggregates(aggregates) {
  return Array.from(aggregates.values()).map(entry => {
    const officialPrices = entry.officialPrices.sort((a, b) => a - b);
    const officialPricePerPyeong = entry.officialPricePerPyeong.sort((a, b) => a - b);
    const minOfficialPrice = officialPrices[0] || null;
    const maxOfficialPrice = officialPrices[officialPrices.length - 1] || null;
    const avgOfficialPrice = officialPrices.length
      ? Math.round(officialPrices.reduce((sum, value) => sum + value, 0) / officialPrices.length)
      : null;

    return {
      kaptCode: entry.kaptCode,
      aptName: entry.aptName,
      sigunguName: entry.sigunguName,
      umdName: entry.umdName,
      basisYear: entry.basisYear,
      basisMonth: entry.basisMonth,
      sampleCount: officialPrices.length,
      minOfficialPrice,
      maxOfficialPrice,
      avgOfficialPrice,
      medianOfficialPrice: computeMedian(officialPrices),
      medianOfficialPricePerPyeong: computeMedian(officialPricePerPyeong),
    };
  });
}

async function writePayload({ outputPath, sourcePath, targetCount, aggregates, matchedRows, processed, complete }) {
  const entries = buildEntriesFromAggregates(aggregates);
  const payload = {
    meta: {
      source: path.basename(sourcePath),
      generatedAt: new Date().toISOString(),
      scope: SCOPE,
      targetCount,
      matchedComplexCount: entries.length,
      matchedRowCount: matchedRows,
      processedRowCount: processed,
      complete,
    },
    entries,
  };

  const tempPath = `${outputPath}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(payload)}\n`, 'utf8');
  await fsp.rename(tempPath, outputPath);
  return entries.length;
}

async function main() {
  const codeMapPayload = JSON.parse(await fsp.readFile(CODE_MAP_PATH, 'utf8'));
  const targets = new Map();
  const relaxedTargets = new Map();

  (Array.isArray(codeMapPayload?.items) ? codeMapPayload.items : []).forEach(item => {
    if (!isInScopeBySido(item?.as1)) return;
    const umdName = item.umdName || [item.as3, item.as4].filter(Boolean).join(' ').trim();
    const key = buildCompositeKey(item.as2, umdName, item.kaptName);
    if (!key) return;
    const target = {
      kaptCode: item.kaptCode || '',
      aptName: item.kaptName || '',
      sigunguName: item.as2 || '',
      umdName,
    };
    targets.set(key, target);

    const relaxedKey = buildRelaxedCompositeKey(item.as2, item.kaptName);
    if (!relaxedKey) return;
    const current = relaxedTargets.get(relaxedKey) || [];
    current.push(target);
    relaxedTargets.set(relaxedKey, current);
  });

  if (!fs.existsSync(SOURCE_PATH)) {
    throw new Error(`공시가격 CSV를 찾을 수 없습니다: ${SOURCE_PATH}`);
  }

  const aggregates = new Map();
  let processed = 0;
  let matchedRows = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let isHeader = true;
  for await (const line of rl) {
    if (!line) continue;
    if (isHeader) {
      isHeader = false;
      continue;
    }

    processed += 1;
    const row = parseCsvLine(line);
    if (row.length < 21) continue;

    const sidoName = row[4];
    if (!isInScopeBySido(sidoName)) continue;

    const sigunguName = row[5];
    const eupMyun = row[6];
    const dongRi = row[7];
    const aptName = row[12];
    const officialPriceWon = Number(row[16] || 0);
    if (!aptName || !sigunguName || !officialPriceWon) continue;

    const umdName = [eupMyun, dongRi].filter(Boolean).join(' ').trim();
    const key = buildCompositeKey(sigunguName, umdName, aptName);
    const relaxedKey = buildRelaxedCompositeKey(sigunguName, aptName);
    const relaxedMatches = relaxedTargets.get(relaxedKey) || [];
    const target = targets.get(key)
      || (relaxedMatches.length === 1 ? relaxedMatches[0] : null);
    if (!target) continue;

    const officialPriceManwon = Math.round(officialPriceWon / 10000);
    const area = Number(row[15] || 0) || null;
    const pricePerPyeong = area ? Math.round(officialPriceManwon / (area / 3.305785)) : null;

    const aggregateKey = target.kaptCode || key;
    let aggregate = aggregates.get(aggregateKey);
    if (!aggregate) {
      aggregate = {
        kaptCode: target.kaptCode,
        aptName: target.aptName,
        sigunguName: target.sigunguName,
        umdName: target.umdName,
        basisYear: row[0] || '',
        basisMonth: row[1] || '',
        officialPrices: [],
        officialPricePerPyeong: [],
      };
      aggregates.set(aggregateKey, aggregate);
    }

    aggregate.officialPrices.push(officialPriceManwon);
    if (pricePerPyeong) aggregate.officialPricePerPyeong.push(pricePerPyeong);
    matchedRows += 1;

    if (processed % CHECKPOINT_EVERY === 0) {
      const checkpointCount = await writePayload({
        outputPath: OUTPUT_PATH,
        sourcePath: SOURCE_PATH,
        targetCount: targets.size,
        aggregates,
        matchedRows,
        processed,
        complete: false,
      });
      console.log(`[apt-official-price-meta] checkpoint processed=${processed} matchedRows=${matchedRows} matchedComplexes=${checkpointCount}`);
    }

    if (processed % LOG_EVERY === 0) {
      console.log(`[apt-official-price-meta] processed=${processed} matchedRows=${matchedRows} matchedComplexes=${aggregates.size}`);
    }
  }

  const entryCount = await writePayload({
    outputPath: OUTPUT_PATH,
    sourcePath: SOURCE_PATH,
    targetCount: targets.size,
    aggregates,
    matchedRows,
    processed,
    complete: true,
  });
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Targets=${targets.size}, entries=${entryCount}, matchedRows=${matchedRows}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
