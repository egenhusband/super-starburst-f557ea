'use strict';

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

module.exports = { normalizeText, normalizeUmd, scoreCodeMapMatch, findBestCodeMapMatch };
