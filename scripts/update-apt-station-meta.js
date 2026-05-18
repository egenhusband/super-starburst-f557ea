#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || process.env.KAKAO_MAP_REST_KEY;
const CODE_MAP_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');
const HOUSEHOLDS_PATH = process.env.APT_HOUSEHOLDS_OUTPUT || path.join('data', 'apt-households.json');
const OUTPUT_PATH = process.env.APT_STATION_META_OUTPUT || path.join('data', 'apt-station-meta.json');
const SCOPE = process.env.APT_STATION_SCOPE || 'capital';
const SIGUNGU_FILTER = String(process.env.APT_STATION_SIGUNGU || '').trim();
const START_INDEX = Math.max(0, Number(process.env.APT_STATION_START_INDEX || 0));
const LIMIT = Math.max(0, Number(process.env.APT_STATION_LIMIT || 0));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.APT_STATION_DELAY_MS || 160));
const LOG_EVERY = Math.max(1, Number(process.env.APT_STATION_LOG_EVERY || 100));
const REFRESH_EXISTING = process.env.APT_STATION_REFRESH_EXISTING === '1';
const PLACE_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
const ADDRESS_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const CATEGORY_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/category.json';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/에스케이/giu, 'sk')
    .replace(/아파트$/u, '')
    .replace(/[()·.,\-_/]/g, '')
    .toLowerCase();
}

function normalizeUmd(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function isInScope(entry) {
  if (!entry) return false;
  if (SCOPE === 'seoul') return entry.as1 === '서울특별시';
  if (SCOPE === 'gyeonggi') return entry.as1 === '경기도';
  if (SCOPE === 'capital') return entry.as1 === '서울특별시' || entry.as1 === '경기도';
  return true;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function fetchKakaoJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
  });
  const text = await response.text();
  if (!response.ok) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchKakaoJson(url, attempt + 1);
    }
    throw new Error(`Kakao Local API failed: ${response.status} ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 3) {
      await sleep(300 * attempt);
      return fetchKakaoJson(url, attempt + 1);
    }
    throw new Error(`Kakao Local API returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function buildPlaceSearchUrl(query) {
  const params = new URLSearchParams({ query, size: '8', page: '1' });
  return `${PLACE_SEARCH_URL}?${params}`;
}

function buildAddressSearchUrl(query) {
  const params = new URLSearchParams({ query, size: '5', page: '1' });
  return `${ADDRESS_SEARCH_URL}?${params}`;
}

function buildStationSearchUrl(x, y) {
  const params = new URLSearchParams({
    category_group_code: 'SW8',
    x: String(x),
    y: String(y),
    radius: '2000',
    sort: 'distance',
    page: '1',
    size: '5',
  });
  return `${CATEGORY_SEARCH_URL}?${params}`;
}

function scorePlaceMatch(target, doc) {
  let score = 0;
  const targetName = normalizeText(target.aptName);
  const placeName = normalizeText(doc.place_name);
  if (targetName === placeName) score += 8;
  else if (placeName.includes(targetName) || targetName.includes(placeName)) score += 5;
  else return -1;

  const roadAddress = String(doc.road_address_name || '');
  const address = String(doc.address_name || '');
  const targetSigungu = normalizeText(target.sigunguName);
  const targetUmd = normalizeUmd(target.umdName);
  if (normalizeText(roadAddress).includes(targetSigungu) || normalizeText(address).includes(targetSigungu)) score += 2;
  if (normalizeUmd(roadAddress).includes(targetUmd) || normalizeUmd(address).includes(targetUmd)) score += 3;
  return score;
}

function pickBestPlace(target, docs) {
  let best = null;
  let bestScore = -1;
  docs.forEach(doc => {
    const score = scorePlaceMatch(target, doc);
    if (score > bestScore) {
      best = doc;
      bestScore = score;
    }
  });
  return bestScore >= 5 ? best : null;
}

function normalizeAddressResult(doc) {
  if (!doc) return null;
  const roadAddress = doc.road_address || {};
  const address = doc.address || {};
  const x = Number(roadAddress.x || address.x || 0);
  const y = Number(roadAddress.y || address.y || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 || y === 0) return null;
  return {
    x,
    y,
    place_name: roadAddress.building_name || address.address_name || '',
    road_address_name: roadAddress.address_name || '',
    address_name: address.address_name || '',
  };
}

function normalizeStationEntry(target, place, station) {
  return {
    kaptCode: String(target.kaptCode || '').trim(),
    aptName: String(target.aptName || '').trim(),
    sigunguName: String(target.sigunguName || '').trim(),
    umdName: String(target.umdName || '').trim(),
    lat: Number(place.y) || null,
    lng: Number(place.x) || null,
    stationName: String(station.place_name || '').trim(),
    stationDistance: Number(station.distance || 0) || null,
    stationRoadAddress: String(station.road_address_name || station.address_name || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

function hasStationFields(entry) {
  if (!entry) return false;
  return Boolean(String(entry.stationName || '').trim() && Number(entry.stationDistance || 0) > 0);
}

async function writePayload({ outputPath, entries, processed, saved, skipped, totalTargets, complete }) {
  const payload = {
    meta: {
      source: 'KAKAO_LOCAL_CATEGORY_SW8',
      generatedAt: new Date().toISOString(),
      scope: SCOPE,
      sigunguFilter: SIGUNGU_FILTER || null,
      startIndex: START_INDEX,
      limit: LIMIT || null,
      count: entries.length,
      processedTargetCount: processed,
      savedCount: saved,
      skippedCount: skipped,
      totalTargetCount: totalTargets,
      refreshExisting: REFRESH_EXISTING,
      complete,
    },
    entries,
  };
  const tempPath = `${outputPath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload)}\n`, 'utf8');
  await fs.rename(tempPath, outputPath);
}

async function main() {
  if (!KAKAO_KEY) throw new Error('KAKAO_REST_API_KEY or KAKAO_API_KEY is required.');
  const root = process.cwd();
  const [codeMapPayload, existingPayload] = await Promise.all([
    readJson(path.join(root, CODE_MAP_PATH)),
    readJson(path.join(root, OUTPUT_PATH)).catch(() => ({ entries: [] })),
  ]);
  const householdsPayload = await readJson(path.join(root, HOUSEHOLDS_PATH)).catch(() => ({ entries: [] }));
  const householdByKaptCode = new Map(
    (Array.isArray(householdsPayload?.entries) ? householdsPayload.entries : [])
      .filter(entry => entry?.kaptCode)
      .map(entry => [String(entry.kaptCode), entry]),
  );

  const targets = (Array.isArray(codeMapPayload?.items) ? codeMapPayload.items : [])
    .filter(isInScope)
    .map(item => ({
      kaptCode: item.kaptCode,
      aptName: item.kaptName,
      sigunguName: item.as2,
      umdName: item.umdName || [item.as3, item.as4].filter(Boolean).join(' ').trim(),
      doroJuso: String(householdByKaptCode.get(String(item.kaptCode))?.doroJuso || '').trim(),
    }))
    .filter(target => !SIGUNGU_FILTER || target.sigunguName === SIGUNGU_FILTER);

  const scopedTargets = LIMIT > 0
    ? targets.slice(START_INDEX, START_INDEX + LIMIT)
    : targets.slice(START_INDEX);

  const entries = Array.isArray(existingPayload?.entries) ? [...existingPayload.entries] : [];
  const indexByKaptCode = new Map(entries.filter(e => e?.kaptCode).map((e, i) => [String(e.kaptCode), i]));
  const existingByKaptCode = new Map(entries.filter(e => e?.kaptCode).map(e => [String(e.kaptCode), e]));

  let processed = 0;
  let saved = 0;
  let skipped = 0;

  for (const target of scopedTargets) {
    processed += 1;
    const existing = existingByKaptCode.get(String(target.kaptCode));
    if (!REFRESH_EXISTING && hasStationFields(existing)) {
      skipped += 1;
      continue;
    }

    try {
      const placeQuery = [target.sigunguName, target.umdName, target.aptName].filter(Boolean).join(' ');
      const placePayload = await fetchKakaoJson(buildPlaceSearchUrl(placeQuery));
      let place = pickBestPlace(target, Array.isArray(placePayload?.documents) ? placePayload.documents : []);

      if (!place && target.doroJuso) {
        const addressPayload = await fetchKakaoJson(buildAddressSearchUrl(target.doroJuso));
        place = normalizeAddressResult(addressPayload?.documents?.[0]);
      }

      if (!place) {
        skipped += 1;
        continue;
      }

      const stationPayload = await fetchKakaoJson(buildStationSearchUrl(place.x, place.y));
      const station = Array.isArray(stationPayload?.documents) ? stationPayload.documents[0] : null;
      if (!station) {
        skipped += 1;
        continue;
      }

      const normalized = normalizeStationEntry(target, place, station);
      const existingIndex = indexByKaptCode.get(String(target.kaptCode));
      if (Number.isInteger(existingIndex)) entries[existingIndex] = normalized;
      else {
        indexByKaptCode.set(String(target.kaptCode), entries.length);
        entries.push(normalized);
      }
      existingByKaptCode.set(String(target.kaptCode), normalized);
      saved += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`[apt-station-meta] skip ${target.sigunguName} ${target.umdName} ${target.aptName}: ${error.message}`);
    }

    if (processed % LOG_EVERY === 0) {
      console.log(`[apt-station-meta] processed=${processed}/${scopedTargets.length} saved=${saved} skipped=${skipped} scope=${SCOPE}${SIGUNGU_FILTER ? ` sigungu=${SIGUNGU_FILTER}` : ''}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  entries.sort((a, b) => String(a.kaptCode || '').localeCompare(String(b.kaptCode || ''), 'ko'));
  await writePayload({
    outputPath: path.join(root, OUTPUT_PATH),
    entries,
    processed,
    saved,
    skipped,
    totalTargets: scopedTargets.length,
    complete: true,
  });

  console.log(`Wrote ${path.join(root, OUTPUT_PATH)}`);
  console.log(`Targets=${scopedTargets.length}, saved=${saved}, skipped=${skipped}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
