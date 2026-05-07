#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || process.env.KAKAO_MAP_REST_KEY;
const CODE_MAP_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');
const OUTPUT_PATH = process.env.APT_SCHOOL_META_OUTPUT || path.join('data', 'apt-school-meta.json');
const SCOPE = process.env.APT_SCHOOL_SCOPE || 'capital';
const START_INDEX = Math.max(0, Number(process.env.APT_SCHOOL_START_INDEX || 0));
const LIMIT = Math.max(0, Number(process.env.APT_SCHOOL_LIMIT || 0));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.APT_SCHOOL_DELAY_MS || 160));
const LOG_EVERY = Math.max(1, Number(process.env.APT_SCHOOL_LOG_EVERY || 100));
const PLACE_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/keyword.json';
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
    headers: {
      Authorization: `KakaoAK ${KAKAO_KEY}`,
    },
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

function buildPlaceSearchQuery(target) {
  return [target.sigunguName, target.umdName, target.aptName].filter(Boolean).join(' ');
}

function buildPlaceSearchUrl(query) {
  const params = new URLSearchParams({
    query,
    size: '8',
    page: '1',
  });
  return `${PLACE_SEARCH_URL}?${params}`;
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

function buildSchoolSearchUrl(x, y) {
  const params = new URLSearchParams({
    category_group_code: 'SC4',
    x: String(x),
    y: String(y),
    radius: '2000',
    sort: 'distance',
    page: '1',
    size: '15',
  });
  return `${CATEGORY_SEARCH_URL}?${params}`;
}

function pickNearestElementarySchool(docs) {
  const candidates = docs.filter(doc => {
    const category = String(doc.category_name || '');
    const placeName = String(doc.place_name || '');
    return category.includes('초등학교') || placeName.includes('초등학교');
  });
  return candidates[0] || null;
}

function normalizeSchoolEntry(target, place, school) {
  return {
    kaptCode: String(target.kaptCode || '').trim(),
    aptName: String(target.aptName || '').trim(),
    sigunguName: String(target.sigunguName || '').trim(),
    umdName: String(target.umdName || '').trim(),
    lat: Number(place.y) || null,
    lng: Number(place.x) || null,
    schoolName: String(school.place_name || '').trim(),
    schoolDistance: Number(school.distance || 0) || null,
    schoolRoadAddress: String(school.road_address_name || school.address_name || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

async function main() {
  if (!KAKAO_KEY) throw new Error('KAKAO_REST_API_KEY or KAKAO_API_KEY is required.');

  const root = process.cwd();
  const codeMapPath = path.join(root, CODE_MAP_PATH);
  const outputPath = path.join(root, OUTPUT_PATH);
  const [codeMapPayload, existingPayload] = await Promise.all([
    readJson(codeMapPath),
    readJson(outputPath).catch(() => ({ entries: [] })),
  ]);

  const targets = (Array.isArray(codeMapPayload?.items) ? codeMapPayload.items : [])
    .filter(isInScope)
    .map(item => ({
      kaptCode: item.kaptCode,
      aptName: item.kaptName,
      sigunguName: item.as2,
      umdName: item.umdName || [item.as3, item.as4].filter(Boolean).join(' ').trim(),
    }));

  const scopedTargets = LIMIT > 0
    ? targets.slice(START_INDEX, START_INDEX + LIMIT)
    : targets.slice(START_INDEX);

  const entries = Array.isArray(existingPayload?.entries) ? [...existingPayload.entries] : [];
  const indexByKaptCode = new Map(
    entries.filter(entry => entry?.kaptCode).map((entry, index) => [String(entry.kaptCode), index]),
  );

  let processed = 0;
  let saved = 0;
  let skipped = 0;
  for (const target of scopedTargets) {
    processed += 1;
    try {
      const query = buildPlaceSearchQuery(target);
      const placeResponse = await fetchKakaoJson(buildPlaceSearchUrl(query));
      const place = pickBestPlace(target, Array.isArray(placeResponse?.documents) ? placeResponse.documents : []);
      if (!place) {
        skipped += 1;
        continue;
      }

      await sleep(REQUEST_DELAY_MS);
      const schoolResponse = await fetchKakaoJson(buildSchoolSearchUrl(place.x, place.y));
      const school = pickNearestElementarySchool(Array.isArray(schoolResponse?.documents) ? schoolResponse.documents : []);
      if (!school) {
        skipped += 1;
        continue;
      }

      const entry = normalizeSchoolEntry(target, place, school);
      const existingIndex = indexByKaptCode.get(String(entry.kaptCode));
      if (Number.isInteger(existingIndex)) entries[existingIndex] = entry;
      else {
        indexByKaptCode.set(String(entry.kaptCode), entries.length);
        entries.push(entry);
      }
      saved += 1;

      if (processed % LOG_EVERY === 0) {
        console.log(`[apt-school-meta] processed=${processed}/${scopedTargets.length} saved=${saved} skipped=${skipped} scope=${SCOPE}`);
      }
      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      skipped += 1;
      console.warn(`[apt-school-meta] skip ${target.sigunguName} ${target.umdName} ${target.aptName}: ${error.message}`);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const payload = {
    meta: {
      source: 'KAKAO_LOCAL_CATEGORY_SC4',
      generatedAt: new Date().toISOString(),
      scope: SCOPE,
      startIndex: START_INDEX,
      limit: LIMIT || null,
      count: entries.length,
    },
    entries,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`Wrote ${outputPath}`);
  console.log(`Entries=${entries.length}, saved=${saved}, skipped=${skipped}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
