#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { loadEnvLocal } = require('./lib/load-env-local');

loadEnvLocal(process.cwd());

const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || process.env.KAKAO_API_KEY || process.env.KAKAO_MAP_REST_KEY;
const CODE_MAP_PATH = process.env.APT_CODE_MAP_OUTPUT || path.join('data', 'apt-code-map.json');
const HOUSEHOLDS_PATH = process.env.APT_HOUSEHOLDS_OUTPUT || path.join('data', 'apt-households.json');
const STATION_META_PATH = path.join('data', 'apt-station-meta.json');
const OUTPUT_PATH = process.env.APT_CONVENIENCE_META_OUTPUT || path.join('data', 'apt-convenience-meta.json');
const SCOPE = process.env.APT_CONVENIENCE_SCOPE || 'capital';
const SIGUNGU_FILTER = String(process.env.APT_CONVENIENCE_SIGUNGU || '').trim();
const START_INDEX = Math.max(0, Number(process.env.APT_CONVENIENCE_START_INDEX || 0));
const LIMIT = Math.max(0, Number(process.env.APT_CONVENIENCE_LIMIT || 0));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.APT_CONVENIENCE_DELAY_MS || 200));
const LOG_EVERY = Math.max(1, Number(process.env.APT_CONVENIENCE_LOG_EVERY || 100));
const SAVE_EVERY = Math.max(1, Number(process.env.APT_CONVENIENCE_SAVE_EVERY || 100));
const REFRESH_EXISTING = process.env.APT_CONVENIENCE_REFRESH_EXISTING === '1';
const SANITIZE_ONLY = process.env.APT_CONVENIENCE_SANITIZE_ONLY === '1';
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

function buildKeywordNearbyUrl(query, x, y, radius, size = 5) {
  const params = new URLSearchParams({
    query,
    x: String(x),
    y: String(y),
    radius: String(radius),
    sort: 'distance',
    size: String(size),
  });
  return `${PLACE_SEARCH_URL}?${params}`;
}

function buildCategoryNearbyUrl(categoryCode, x, y, radius, size = 5) {
  const params = new URLSearchParams({
    category_group_code: categoryCode,
    x: String(x),
    y: String(y),
    radius: String(radius),
    sort: 'distance',
    size: String(size),
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
  return { x, y };
}

async function resolveCoords(target, stationMeta) {
  if (stationMeta && Number.isFinite(stationMeta.lat) && Number.isFinite(stationMeta.lng)) {
    return { x: stationMeta.lng, y: stationMeta.lat };
  }
  const placeQuery = [target.sigunguName, target.umdName, target.aptName].filter(Boolean).join(' ');
  const placePayload = await fetchKakaoJson(buildPlaceSearchUrl(placeQuery));
  const place = pickBestPlace(target, Array.isArray(placePayload?.documents) ? placePayload.documents : []);
  if (place) return { x: Number(place.x), y: Number(place.y) };
  if (!target.doroJuso) return null;
  const addressPayload = await fetchKakaoJson(buildAddressSearchUrl(target.doroJuso));
  return normalizeAddressResult(addressPayload?.documents?.[0]);
}

function normalizeConvenienceName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function hasAnyToken(value, tokens) {
  const normalized = normalizeConvenienceName(value);
  return tokens.some(token => normalized.includes(normalizeConvenienceName(token)));
}

function sanitizeHospital(item) {
  if (!item?.name) return null;
  const normalized = normalizeConvenienceName(item.name);
  if (
    /동물.*병원/u.test(normalized)
    || /병원.*동물/u.test(normalized)
    || /나무.*병원/u.test(normalized)
    || /수목.*병원/u.test(normalized)
    || /pc.*병원/u.test(normalized)
    || /병원.*pc/u.test(normalized)
    || /컴.*병원/u.test(normalized)
    || /병원.*컴/u.test(normalized)
    || /카.*종합병원/u.test(normalized)
  ) return null;
  if (hasAnyToken(item.name, [
    '동물',
    '동물병원',
    '종합동물병원',
    '동물종합병원',
    '반려동물',
    '애견',
    '펫',
    '고양이',
    '나무병원',
    '수목병원',
    'pc병원',
    'pc종합병원',
    '컴퓨터병원',
    '컴퓨터종합병원',
  ])) return null;
  if (!hasAnyToken(item.name, ['병원', '의료원', '대학병원', '메디컬센터'])) return null;
  return item;
}

function normalizeDepartmentStoreName(name) {
  const normalized = normalizeConvenienceName(name);
  const brands = [
    ['롯데백화점', '롯데백화점'],
    ['현대백화점', '현대백화점'],
    ['신세계백화점', '신세계백화점'],
    ['갤러리아백화점', '갤러리아백화점'],
    ['ak플라자', 'AK플라자'],
    ['akplaza', 'AK플라자'],
    ['nc백화점', 'NC백화점'],
    ['뉴코아백화점', '뉴코아백화점'],
    ['스타필드', '스타필드'],
    ['타임스퀘어', '타임스퀘어'],
  ];
  const match = brands.find(([token]) => normalized.includes(token));
  return match ? match[1] : '';
}

function sanitizeDepartmentStore(item) {
  if (!item?.name) return null;
  if (hasAnyToken(item.name, [
    '고기백화점',
    '정육백화점',
    '축산물',
    '열쇠',
    '철물',
    '공구',
    '주류백화점',
    '휴대폰',
    '이불',
    '신발',
    '생활용품',
    '미용재료',
    '기독교',
    '반찬',
    '보험백화점',
    '정수기백화점',
    '방수자재',
    '학생백화점',
    '하이파킹',
    '주차장',
  ])) return null;
  const canonicalName = normalizeDepartmentStoreName(item.name);
  if (!canonicalName) return null;
  return { ...item, name: canonicalName };
}

function extractConvenientFacilityValue(text, label) {
  const source = String(text || '');
  const match = source.match(new RegExp(`${label}\\(([^)]*)\\)`, 'u'));
  return match ? match[1].trim() : '';
}

function getHouseholdDepartmentStoreFallback(household) {
  const value = extractConvenientFacilityValue(household?.convenientFacility, '백화점');
  const dept = sanitizeDepartmentStore({ name: value, distance: null, source: 'household' });
  return dept ? { ...dept, source: 'household' } : null;
}

function sanitizeMart(item) {
  if (!item?.name) return null;
  if (hasAnyToken(item.name, ['편의점', '마트주차장', '주차장'])) return null;
  return item;
}

function sanitizePark(item) {
  if (!item?.name) return null;
  if (hasAnyToken(item.name, ['주차장', '관리사무소'])) return null;
  if (!hasAnyToken(item.name, ['공원', '마당', '숲', '광장'])) return null;
  return item;
}

function sanitizeConvenienceEntry(entry, household = null) {
  if (!entry || typeof entry !== 'object') return null;
  const dept = sanitizeDepartmentStore(entry.dept) || getHouseholdDepartmentStoreFallback(household);
  return {
    hospital: sanitizeHospital(entry.hospital),
    mart: sanitizeMart(entry.mart),
    dept,
    park: sanitizePark(entry.park),
  };
}

async function searchNearbyItem(url, sanitizeItem = item => item) {
  try {
    const payload = await fetchKakaoJson(url);
    const docs = Array.isArray(payload?.documents) ? payload.documents : [];
    for (const doc of docs) {
      const item = sanitizeItem({
        name: String(doc.place_name || '').trim(),
        distance: Number(doc.distance || 0) || null,
      });
      if (item) return item;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  if (!KAKAO_KEY && !SANITIZE_ONLY) throw new Error('KAKAO_REST_API_KEY or KAKAO_API_KEY is required.');
  const root = process.cwd();

  const [codeMapPayload, householdsPayload, stationMetaPayload, existingData] = await Promise.all([
    readJson(path.join(root, CODE_MAP_PATH)),
    readJson(path.join(root, HOUSEHOLDS_PATH)).catch(() => ({ entries: [] })),
    readJson(path.join(root, STATION_META_PATH)).catch(() => ({ entries: [] })),
    readJson(path.join(root, OUTPUT_PATH)).catch(() => ({})),
  ]);

  const householdByKaptCode = new Map(
    (Array.isArray(householdsPayload?.entries) ? householdsPayload.entries : [])
      .filter(entry => entry?.kaptCode)
      .map(entry => [String(entry.kaptCode), entry]),
  );
  const stationByKaptCode = new Map(
    (Array.isArray(stationMetaPayload?.entries) ? stationMetaPayload.entries : [])
      .filter(entry => entry?.kaptCode)
      .map(entry => [String(entry.kaptCode), entry]),
  );

  const result = {};
  if (typeof existingData === 'object' && existingData !== null && !Array.isArray(existingData)) {
    Object.entries(existingData).forEach(([code, entry]) => {
      result[code] = sanitizeConvenienceEntry(entry, householdByKaptCode.get(String(code)));
    });
  }

  if (SANITIZE_ONLY) {
    const tempPath = `${path.join(root, OUTPUT_PATH)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(result)}\n`, 'utf8');
    await fs.rename(tempPath, path.join(root, OUTPUT_PATH));
    console.log(`Sanitized ${Object.keys(result).length} entries in ${path.join(root, OUTPUT_PATH)}`);
    return;
  }

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

  let processed = 0;
  let saved = 0;
  let skipped = 0;

  for (const target of scopedTargets) {
    processed += 1;
    const code = String(target.kaptCode);
    if (!REFRESH_EXISTING && Object.prototype.hasOwnProperty.call(result, code)) {
      skipped += 1;
      continue;
    }

    try {
      const stationMeta = stationByKaptCode.get(code);
      const coords = await resolveCoords(target, stationMeta);
      if (!coords) {
        skipped += 1;
        continue;
      }

      const { x, y } = coords;
      const [hospital, mart, dept, park] = await Promise.all([
        searchNearbyItem(buildCategoryNearbyUrl('HP8', x, y, 2000, 10), sanitizeHospital),
        searchNearbyItem(buildCategoryNearbyUrl('MT1', x, y, 700, 10), sanitizeMart),
        searchNearbyItem(buildKeywordNearbyUrl('백화점', x, y, 2000, 15), sanitizeDepartmentStore),
        searchNearbyItem(buildKeywordNearbyUrl('공원', x, y, 1000, 10), sanitizePark),
      ]);

      result[code] = {
        hospital,
        mart,
        dept: dept || getHouseholdDepartmentStoreFallback(householdByKaptCode.get(code)),
        park,
      };
      saved += 1;
    } catch (error) {
      skipped += 1;
      console.warn(`[apt-convenience-meta] skip ${target.sigunguName} ${target.umdName} ${target.aptName}: ${error.message}`);
    }

    if (processed % LOG_EVERY === 0) {
      console.log(`[apt-convenience-meta] processed=${processed}/${scopedTargets.length} saved=${saved} skipped=${skipped} scope=${SCOPE}${SIGUNGU_FILTER ? ` sigungu=${SIGUNGU_FILTER}` : ''}`);
    }
    if (processed % SAVE_EVERY === 0) {
      const tempPath = `${path.join(root, OUTPUT_PATH)}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(result)}\n`, 'utf8');
      await fs.rename(tempPath, path.join(root, OUTPUT_PATH));
      console.log(`[apt-convenience-meta] checkpoint saved at ${processed}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const tempPath = `${path.join(root, OUTPUT_PATH)}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(result)}\n`, 'utf8');
  await fs.rename(tempPath, path.join(root, OUTPUT_PATH));

  console.log(`Wrote ${path.join(root, OUTPUT_PATH)}`);
  console.log(`Targets=${scopedTargets.length}, saved=${saved}, skipped=${skipped}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
