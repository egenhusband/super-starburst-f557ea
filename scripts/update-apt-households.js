#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');
const { normalizeText, normalizeUmd, findBestCodeMapMatch } = require('./lib/apt-code-match');

loadEnvLocal(process.cwd());

const KEY = process.env.MOLIT_HOUSING_API_KEY || process.env.MOLIT_API_KEY;
const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || process.env.KAKAO_MAP_REST_KEY;
const BASIS_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4';
const DETAIL_URL = 'https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusDtlInfoV4';
const CODE_MAP_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');
const SUMMARY_PATH = path.join('data', 'apt-trades-summary.json');
const OUTPUT_PATH = process.env.APT_HOUSEHOLDS_OUTPUT || path.join('data', 'apt-households.json');
const SCHOOL_META_PATH = process.env.APT_SCHOOL_META_OUTPUT || path.join('data', 'apt-school-meta.json');
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.APT_HOUSEHOLDS_DELAY_MS || 120));
const FETCH_DETAIL = process.env.APT_HOUSEHOLDS_FETCH_DETAIL !== '0';
const SCOPE = process.env.APT_HOUSEHOLDS_SCOPE || 'capital';
const START_INDEX = Math.max(0, Number(process.env.APT_HOUSEHOLDS_START_INDEX || 0));
const LIMIT = Math.max(0, Number(process.env.APT_HOUSEHOLDS_LIMIT || 0));
const LOG_EVERY = Math.max(1, Number(process.env.APT_HOUSEHOLDS_LOG_EVERY || 100));
const REFRESH_EXISTING = process.env.APT_HOUSEHOLDS_REFRESH_EXISTING === '1';
const CHECKPOINT_EVERY = Math.max(1, Number(process.env.APT_HOUSEHOLDS_CHECKPOINT_EVERY || 50));
const LOCATION_ONLY = process.env.APT_HOUSEHOLDS_LOCATION_ONLY === '1';
const LOCATION_DELAY_MS = Math.max(0, Number(process.env.APT_HOUSEHOLDS_LOCATION_DELAY_MS || 120));
const ADDRESS_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const KEYWORD_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

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

async function fetchKakaoAddress(address, attempt = 1) {
  if (!KAKAO_KEY || !address) return null;
  const params = new URLSearchParams({ query: address, analyze_type: 'similar' });
  const response = await fetch(`${ADDRESS_SEARCH_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchKakaoAddress(address, attempt + 1);
    }
    throw new Error(`Kakao address search failed: ${response.status} ${text.slice(0, 160)}`);
  }
  const payload = JSON.parse(text);
  const match = Array.isArray(payload?.documents) ? payload.documents[0] : null;
  if (!match) return null;
  const lat = Number(match.y);
  const lng = Number(match.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

async function fetchKakaoKeyword(entry, attempt = 1) {
  if (!KAKAO_KEY) return null;
  const query = [entry.sigunguName, entry.umdName, entry.aptName].filter(Boolean).join(' ');
  if (!query) return null;
  const params = new URLSearchParams({ query, size: '5' });
  const response = await fetch(`${KEYWORD_SEARCH_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchKakaoKeyword(entry, attempt + 1);
    }
    return null;
  }
  const payload = JSON.parse(text);
  const match = Array.isArray(payload?.documents) ? payload.documents[0] : null;
  if (!match) return null;
  const lat = Number(match.y);
  const lng = Number(match.x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function hasLocation(entry) {
  return Number.isFinite(Number(entry?.lat)) && Number.isFinite(Number(entry?.lng));
}

async function backfillHouseholdLocations(entries, schoolEntries, targetCodes) {
  const schoolByCode = new Map(
    (schoolEntries || [])
      .filter(entry => entry?.kaptCode && hasLocation(entry))
      .map(entry => [String(entry.kaptCode), entry]),
  );
  let copied = 0;
  let geocoded = 0;
  let unresolved = 0;

  for (const entry of entries) {
    if (!targetCodes.has(String(entry.kaptCode)) || hasLocation(entry)) continue;
    const school = schoolByCode.get(String(entry.kaptCode));
    if (school) {
      entry.lat = Number(school.lat);
      entry.lng = Number(school.lng);
      copied += 1;
      continue;
    }
    const location = await fetchKakaoAddress(entry.doroJuso) || await fetchKakaoKeyword(entry);
    if (location) {
      entry.lat = location.lat;
      entry.lng = location.lng;
      geocoded += 1;
    } else {
      unresolved += 1;
    }
    if (LOCATION_DELAY_MS) await sleep(LOCATION_DELAY_MS);
  }

  return { copied, geocoded, unresolved };
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

function isInScope(entry) {
  if (!entry) return false;
  if (SCOPE === 'seoul') return entry.as1 === '서울특별시';
  if (SCOPE === 'gyeonggi') return entry.as1 === '경기도';
  if (SCOPE === 'capital') return entry.as1 === '서울특별시' || entry.as1 === '경기도';
  return true;
}

function extractTargetsFromCodeMap(codeMapItems) {
  return codeMapItems
    .filter(isInScope)
    .map(item => ({
      match: item,
      target: {
        kaptCode: item.kaptCode,
        aptName: item.kaptName,
        sigunguCode: item.sigunguCode,
        sigunguName: item.as2,
        umdName: item.umdName,
      },
    }));
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

function hasDetailFields(entry) {
  if (!entry) return false;
  return Boolean(
    String(entry.subwayStation || '').trim()
    || String(entry.subwayDistance || '').trim()
    || String(entry.busDistance || '').trim()
    || String(entry.convenientFacility || '').trim()
    || String(entry.educationFacility || '').trim(),
  );
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

async function writeCheckpoint({
  outputPath,
  summaryPath,
  summary,
  householdEntries,
  matchedTargets,
  fetchedCount,
  failedTargets,
}) {
  const householdMap = new Map(
    householdEntries.map(entry => [[entry.sigunguCode, entry.umdName, entry.aptName].join('|'), entry]),
  );

  const householdsPayload = {
    meta: {
      source: 'MOLIT_APT_BASIS_INFO_V4',
      generatedAt: new Date().toISOString(),
      startIndex: START_INDEX,
      limit: LIMIT || null,
      matchedTargetCount: matchedTargets.length,
      fetchedCount,
      scope: SCOPE,
      fetchDetail: FETCH_DETAIL,
      unmatchedTargetCount: failedTargets.length,
      householdCount: householdEntries.length,
      checkpointEvery: CHECKPOINT_EVERY,
    },
    unmatchedTargets: failedTargets,
    entries: householdEntries,
  };

  const mergedSummary = mergeHouseholdsIntoSummary(summary, householdMap);

  await Promise.all([
    fs.writeFile(outputPath, `${JSON.stringify(householdsPayload)}\n`, 'utf8'),
    fs.writeFile(summaryPath, `${JSON.stringify(mergedSummary)}\n`, 'utf8'),
  ]);
}

async function main() {
  if (!LOCATION_ONLY && !KEY) throw new Error('MOLIT_API_KEY or MOLIT_HOUSING_API_KEY is required.');
  if (!KAKAO_KEY) throw new Error('KAKAO_REST_API_KEY or KAKAO_API_KEY is required for apartment locations.');

  const root = process.cwd();
  const summaryPath = path.join(root, SUMMARY_PATH);
  const codeMapPath = path.join(root, CODE_MAP_PATH);
  const outputPath = path.join(root, OUTPUT_PATH);

  const [summary, codeMapPayload, existingPayload, schoolMetaPayload] = await Promise.all([
    readJson(summaryPath),
    readJson(codeMapPath),
    readJson(outputPath).catch(() => ({ entries: [] })),
    readJson(path.join(root, SCHOOL_META_PATH)).catch(() => ({ entries: [] })),
  ]);

  const codeMapItems = Array.isArray(codeMapPayload?.items) ? codeMapPayload.items : [];
  const allTargets = extractTargetsFromCodeMap(codeMapItems);
  const matchedTargets = LIMIT > 0
    ? allTargets.slice(START_INDEX, START_INDEX + LIMIT)
    : allTargets.slice(START_INDEX);
  const existingEntries = Array.isArray(existingPayload?.entries) ? existingPayload.entries : [];
  const locationResult = await backfillHouseholdLocations(
    existingEntries,
    schoolMetaPayload?.entries || [],
    new Set(allTargets.map(({ match }) => String(match.kaptCode))),
  );
  const existingByKaptCode = new Map(
    existingEntries
      .filter(entry => entry?.kaptCode)
      .map(entry => [String(entry.kaptCode), entry]),
  );

  const householdEntries = [...existingEntries];
  const householdIndexByKaptCode = new Map(
    householdEntries
      .filter(entry => entry?.kaptCode)
      .map((entry, index) => [String(entry.kaptCode), index]),
  );

  let fetchedCount = 0;
  const failedTargets = [];
  if (LOCATION_ONLY) {
    await writeCheckpoint({
      outputPath,
      summaryPath,
      summary,
      householdEntries,
      matchedTargets,
      fetchedCount,
      failedTargets,
    });
    console.log(`Backfilled apartment locations: copied=${locationResult.copied}, geocoded=${locationResult.geocoded}, unresolved=${locationResult.unresolved}`);
    return;
  }
  for (let index = 0; index < matchedTargets.length; index += 1) {
    const { target, match } = matchedTargets[index];
    const existingEntry = existingByKaptCode.get(String(match.kaptCode)) || null;
    const shouldSkip = existingEntry
      && !REFRESH_EXISTING
      && (!FETCH_DETAIL || hasDetailFields(existingEntry));
    if (shouldSkip) continue;

    try {
      const basisPayload = await fetchJson(buildBasisUrl(match.kaptCode));
      const detailPayload = FETCH_DETAIL
        ? await fetchJson(buildDetailUrl(match.kaptCode))
        : null;
      const item = basisPayload?.response?.body?.item || null;
      const detailItem = detailPayload?.response?.body?.item || null;
      if (item) {
        const entry = {
          ...(existingEntry || {}),
          ...parseHouseholdItem(item, detailItem, match),
          sigunguCode: target.sigunguCode,
          sigunguName: target.sigunguName,
          umdName: target.umdName,
          aptName: target.aptName,
        };
        const existingIndex = householdIndexByKaptCode.get(String(entry.kaptCode));
        if (Number.isInteger(existingIndex)) householdEntries[existingIndex] = entry;
        else {
          householdIndexByKaptCode.set(String(entry.kaptCode), householdEntries.length);
          householdEntries.push(entry);
        }
        fetchedCount += 1;
      } else {
        failedTargets.push({
          kaptCode: match.kaptCode,
          aptName: target.aptName,
          sigunguName: target.sigunguName,
          umdName: target.umdName,
          reason: 'basis_item_missing',
        });
      }
    } catch (error) {
      failedTargets.push({
        kaptCode: match.kaptCode,
        aptName: target.aptName,
        sigunguName: target.sigunguName,
        umdName: target.umdName,
        reason: error.message,
      });
      console.warn(
        `[apt-households] skip ${target.sigunguName} ${target.umdName} ${target.aptName}: ${error.message}`,
      );
    }

    const processed = index + 1;
    if (processed % LOG_EVERY === 0 || processed === matchedTargets.length) {
      console.log(
        `[apt-households] processed=${processed}/${matchedTargets.length} fetched=${fetchedCount} scope=${SCOPE} start=${START_INDEX} limit=${LIMIT || 'all'}`,
      );
    }

    if (processed % CHECKPOINT_EVERY === 0 || processed === matchedTargets.length) {
      await writeCheckpoint({
        outputPath,
        summaryPath,
        summary,
        householdEntries,
        matchedTargets,
        fetchedCount,
        failedTargets,
      });
    }

    if (index < matchedTargets.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`Wrote ${outputPath}`);
  console.log(`Merged ${householdEntries.length} household entries into ${summaryPath}`);
  console.log(`Scope=${SCOPE}, Matched=${matchedTargets.length}, Fetched=${fetchedCount}, Failed=${failedTargets.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
