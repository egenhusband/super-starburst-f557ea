#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const KEY = process.env.MOLIT_HOUSING_API_KEY || process.env.MOLIT_API_KEY;
const BASIS_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4';
const DETAIL_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusDtlInfoV4';
const CODE_MAP_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');
const SUMMARY_PATH = path.join('data', 'apt-trades-summary.json');
const OUTPUT_PATH = process.env.APT_HOUSEHOLDS_OUTPUT || path.join('data', 'apt-households.json');
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.APT_HOUSEHOLDS_DELAY_MS || 120));

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/에스케이/giu, 'sk')
    .replace(/아파트$/u, '')
    .replace(/[()·.,-]/g, '')
    .toLowerCase();
}

function normalizeUmd(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function toArray(item) {
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`AptBasisInfoService failed: ${response.status} ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchJson(url, attempt + 1);
    }
    throw new Error(`AptBasisInfoService returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function buildBasisUrl(kaptCode) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    kaptCode,
    _type: 'json',
  });
  return `${BASIS_URL}?${params}`;
}

function buildDetailUrl(kaptCode) {
  const params = new URLSearchParams({
    serviceKey: KEY,
    kaptCode,
    _type: 'json',
  });
  return `${DETAIL_URL}?${params}`;
}

function extractTopTargets(summary) {
  const targetMap = new Map();

  Object.values(summary.sido || {}).forEach(region => {
    const top = Array.isArray(region?.popularComplexes) ? region.popularComplexes[0] : null;
    if (top?.aptName) {
      const key = [top.sigunguCode, top.umdName, top.aptName].join('|');
      if (!targetMap.has(key)) targetMap.set(key, top);
    }

    (region?.cityScopes || []).forEach(scope => {
      const cityTop = Array.isArray(scope?.popularComplexes) ? scope.popularComplexes[0] : null;
      if (cityTop?.aptName) {
        const key = [cityTop.sigunguCode, cityTop.umdName, cityTop.aptName].join('|');
        if (!targetMap.has(key)) targetMap.set(key, cityTop);
      }
    });
  });

  return [...targetMap.values()];
}

function scoreCodeMapMatch(target, entry) {
  let score = 0;

  if (String(entry.sigunguCode || '') === String(target.sigunguCode || '')) score += 5;

  const targetName = normalizeText(target.aptName);
  const entryName = normalizeText(entry.kaptName);
  if (targetName === entryName) score += 8;
  else if (entryName.includes(targetName) || targetName.includes(entryName)) score += 4;
  else return -1;

  const targetUmd = normalizeUmd(target.umdName);
  const entryUmd = normalizeUmd(entry.umdName);
  if (targetUmd && entryUmd) {
    if (targetUmd === entryUmd) score += 4;
    else if (targetUmd.includes(entryUmd) || entryUmd.includes(targetUmd)) score += 2;
  }

  const targetSigungu = normalizeText(target.sigunguName);
  const entrySigungu = normalizeText(entry.as2);
  if (targetSigungu && entrySigungu) {
    if (targetSigungu === entrySigungu) score += 2;
    else if (targetSigungu.includes(entrySigungu) || entrySigungu.includes(targetSigungu)) score += 1;
  }

  return score;
}

function findBestCodeMapMatch(target, codeMapItems) {
  let best = null;
  let bestScore = -1;

  codeMapItems.forEach(entry => {
    const score = scoreCodeMapMatch(target, entry);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  });

  return bestScore >= 8 ? best : null;
}

function parseHouseholdItem(item, detailItem, match) {
  return {
    kaptCode: String(item.kaptCode || match.kaptCode || '').trim(),
    aptName: String(item.kaptName || match.kaptName || '').trim(),
    sigunguCode: String(match.sigunguCode || '').trim(),
    sigunguName: String(match.as2 || '').trim(),
    umdName: [item.kaptAddr, item.doroJuso].filter(Boolean)[0] ? match.umdName : match.umdName,
    householdCount: Number(item.kaptdaCnt || 0) || null,
    dongCount: Number(item.kaptDongCnt || 0) || null,
    bjdCode: String(item.bjdCode || match.bjdCode || '').trim(),
    doroJuso: String(item.doroJuso || '').trim(),
    kaptUsedate: String(item.kaptUsedate || '').trim(),
    subwayLine: String(detailItem?.subwayLine || '').trim(),
    subwayStation: String(detailItem?.subwayStation || '').trim(),
    subwayDistance: String(detailItem?.kaptdWtimesub || '').trim(),
    busDistance: String(detailItem?.kaptdWtimebus || '').trim(),
    convenientFacility: String(detailItem?.convenientFacility || '').trim(),
    welfareFacility: String(detailItem?.welfareFacility || '').trim(),
    educationFacility: String(detailItem?.educationFacility || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

function mergeHouseholdsIntoSummary(summary, householdMap) {
  function mergeComplex(complex) {
    const key = [complex.sigunguCode, complex.umdName, complex.aptName].join('|');
    const household = householdMap.get(key);
    if (!household) return complex;
    return {
      ...complex,
      householdCount: household.householdCount,
      kaptCode: household.kaptCode,
      dongCount: household.dongCount,
      subwayLine: household.subwayLine || '',
      subwayStation: household.subwayStation || '',
      subwayDistance: household.subwayDistance || '',
      busDistance: household.busDistance || '',
      convenientFacility: household.convenientFacility || '',
      welfareFacility: household.welfareFacility || '',
      educationFacility: household.educationFacility || '',
    };
  }

  const nextSummary = JSON.parse(JSON.stringify(summary));

  Object.values(nextSummary.sido || {}).forEach(region => {
    region.popularComplexes = (region.popularComplexes || []).map(mergeComplex);
    region.cityScopes = (region.cityScopes || []).map(scope => ({
      ...scope,
      popularComplexes: (scope.popularComplexes || []).map(mergeComplex),
    }));
  });

  Object.values(nextSummary.sigungu || {}).forEach(region => {
    region.popularComplexes = (region.popularComplexes || []).map(mergeComplex);
    region.cityScopes = (region.cityScopes || []).map(scope => ({
      ...scope,
      popularComplexes: (scope.popularComplexes || []).map(mergeComplex),
    }));
  });

  nextSummary.meta = {
    ...(nextSummary.meta || {}),
    householdsMergedAt: new Date().toISOString(),
    householdTargetCount: householdMap.size,
  };

  return nextSummary;
}

async function main() {
  if (!KEY) throw new Error('MOLIT_API_KEY or MOLIT_HOUSING_API_KEY is required.');

  const root = process.cwd();
  const summaryPath = path.join(root, SUMMARY_PATH);
  const codeMapPath = path.join(root, CODE_MAP_PATH);
  const outputPath = path.join(root, OUTPUT_PATH);

  const [summary, codeMapPayload] = await Promise.all([
    readJson(summaryPath),
    readJson(codeMapPath),
  ]);

  const codeMapItems = Array.isArray(codeMapPayload?.items) ? codeMapPayload.items : [];
  const targets = extractTopTargets(summary);
  const matchedTargets = [];
  const unmatchedTargets = [];

  targets.forEach(target => {
    const match = findBestCodeMapMatch(target, codeMapItems);
    if (match) matchedTargets.push({ target, match });
    else unmatchedTargets.push(target);
  });

  const householdEntries = [];
  for (let index = 0; index < matchedTargets.length; index += 1) {
    const { target, match } = matchedTargets[index];
    const [basisPayload, detailPayload] = await Promise.all([
      fetchJson(buildBasisUrl(match.kaptCode)),
      fetchJson(buildDetailUrl(match.kaptCode)),
    ]);
    const item = basisPayload?.response?.body?.item || null;
    const detailItem = detailPayload?.response?.body?.item || null;
    if (item) {
      householdEntries.push({
        ...parseHouseholdItem(item, detailItem, match),
        sigunguCode: target.sigunguCode,
        sigunguName: target.sigunguName,
        umdName: target.umdName,
        aptName: target.aptName,
      });
    }

    if (index < matchedTargets.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const householdMap = new Map(
    householdEntries.map(entry => [[entry.sigunguCode, entry.umdName, entry.aptName].join('|'), entry]),
  );

  const householdsPayload = {
    meta: {
      source: 'MOLIT_APT_BASIS_INFO_V4',
      generatedAt: new Date().toISOString(),
      matchedTargetCount: matchedTargets.length,
      unmatchedTargetCount: unmatchedTargets.length,
      householdCount: householdEntries.length,
    },
    unmatchedTargets,
    entries: householdEntries,
  };

  const mergedSummary = mergeHouseholdsIntoSummary(summary, householdMap);

  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(householdsPayload)}\n`, 'utf8'),
    fs.writeFile(summaryPath, `${JSON.stringify(mergedSummary)}\n`, 'utf8'),
  ]);

  console.log(`Wrote ${outputPath}`);
  console.log(`Merged ${householdEntries.length} household entries into ${summaryPath}`);
  console.log(`Matched=${matchedTargets.length}, Unmatched=${unmatchedTargets.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
