#!/usr/bin/env node

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INPUT_PATH = process.env.SUBWAY_SEOUL_CSV_INPUT
  || '/Users/deukgyunman/Desktop/서울교통공사 역간거리 및 소요시간_240810.csv';
const LINE_EXTENSION_INPUTS = [
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_수도권8호선_역간거리_20250630.csv',
    lineName: '8호선',
    minutesPerKm: 1.45,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_수도권9호선_역간거리_20250630.csv',
    lineName: '9호선',
    minutesPerKm: 1.8,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_신분당선_역간거리_20250630.csv',
    lineName: '신분당선',
    minutesPerKm: 1.25,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_분당선_역간거리_20250630.csv',
    lineName: '분당선',
    minutesPerKm: 1.4,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_경강선_역간거리_20250630.csv',
    lineName: '경강선',
    minutesPerKm: 1.45,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_경의중앙선_역간거리_20250630.csv',
    lineName: '경의중앙선',
    minutesPerKm: 1.35,
  },
  {
    path: '/Users/deukgyunman/Desktop/국가철도공단_공항철도_역간거리_20250630.csv',
    lineName: '공항철도',
    minutesPerKm: 1.3,
  },
];
const OUTPUT_PATH = process.env.SUBWAY_SEOUL_JSON_OUTPUT
  || path.join('data', 'subway-seoul-times.json');
const TRANSFER_MINUTES = Math.max(1, Number(process.env.SUBWAY_TRANSFER_MINUTES || 4));
const EXTENSION_LINE_COVERAGE = [
  { lineName: '8호선', purpose: '장자호수공원·별내 등 동북권 연장 구간 보강' },
  { lineName: '9호선', purpose: '여의도·마곡·강남축 보강' },
  { lineName: '신분당선', purpose: '강남·판교축 보강' },
  { lineName: '분당선', purpose: '이매·정자·선릉 등 분당/강남 접근 보강' },
  { lineName: '경강선', purpose: '이매·판교·경기 동남권 접근 보강' },
  { lineName: '경의중앙선', purpose: '용산·성수·도심 동서축 접근 보강' },
  { lineName: '공항철도', purpose: '서울역·홍대·마곡 공항축 접근 보강' },
];

function normalizeStationName(value) {
  return String(value || '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .replace(/역$/u, '')
    .replace(/[()[\]{}.,·\-_/]/g, '')
    .toLowerCase();
}

function parseDurationMinutes(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return 0;
  const [mm, ss] = raw.split(':').map(Number);
  if (!Number.isFinite(mm) || !Number.isFinite(ss)) return 0;
  return mm + (ss >= 30 ? 1 : 0);
}

function ensureArrayMap(map, key, value) {
  const current = map.get(key) || [];
  current.push(value);
  map.set(key, current);
}

function addUniqueStation(stations, stationIds, stationNameMap, station) {
  if (stationIds.has(station.id)) return false;
  stations.push(station);
  stationIds.add(station.id);
  ensureArrayMap(stationNameMap, station.stationNameNormalized, station.id);
  return true;
}

function addUniqueRideEdge(rideEdges, rideEdgeIds, edge) {
  const directKey = `${edge.from}>${edge.to}:${edge.type}`;
  const reverseKey = `${edge.to}>${edge.from}:${edge.type}`;
  if (rideEdgeIds.has(directKey) || rideEdgeIds.has(reverseKey)) return false;
  rideEdges.push(edge);
  rideEdgeIds.add(directKey);
  return true;
}

async function main() {
  const stations = [];
  const rideEdges = [];
  const stationNameMap = new Map();
  const stationIds = new Set();
  const rideEdgeIds = new Set();
  let sourceLabel = 'SEOUL_METRO_INTERSTATION_TIME_CSV';
  let sourceInputPath = INPUT_PATH;

  if (fsSync.existsSync(INPUT_PATH)) {
    const csvText = execFileSync('iconv', ['-f', 'cp949', '-t', 'utf-8', INPUT_PATH], { encoding: 'utf8' });
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    const rows = lines.slice(1).map(line => line.split(','));
    const stationIdByLineOrder = new Map();

    rows.forEach((row, index) => {
      const lineName = `${String(row[1] || '').trim()}호선`;
      const stationName = String(row[2] || '').trim();
      if (!lineName || !stationName) return;

      const stationId = `${lineName}:${stationName}`;
      const station = {
        id: stationId,
        lineName,
        stationName,
        stationNameNormalized: normalizeStationName(stationName),
        cumulativeKm: Number(row[5] || 0) || 0,
      };

      if (addUniqueStation(stations, stationIds, stationNameMap, station)) {
        stationIdByLineOrder.set(index, stationId);
      }
    });

    rows.forEach((row, index) => {
      const currentId = stationIdByLineOrder.get(index);
      const nextId = stationIdByLineOrder.get(index + 1);
      const currentLine = `${String(row[1] || '').trim()}호선`;
      const nextLine = `${String((rows[index + 1] || [])[1] || '').trim()}호선`;
      if (!currentId || !nextId || currentLine !== nextLine) return;

      const minutes = parseDurationMinutes((rows[index + 1] || [])[3]);
      const distanceKm = Number((rows[index + 1] || [])[4] || 0) || 0;
      addUniqueRideEdge(rideEdges, rideEdgeIds, {
        from: currentId,
        to: nextId,
        minutes,
        distanceKm,
        type: 'ride',
      });
    });
  } else {
    const fallbackPath = path.join(process.cwd(), OUTPUT_PATH);
    const fallbackPayload = JSON.parse(await fs.readFile(fallbackPath, 'utf8'));
    sourceLabel = 'EXISTING_SUBWAY_GRAPH_PLUS_EXTENSION_LINES';
    sourceInputPath = fallbackPath;

    (fallbackPayload?.stations || []).forEach(station => {
      addUniqueStation(stations, stationIds, stationNameMap, {
        ...station,
        stationNameNormalized: normalizeStationName(station.stationNameNormalized || station.stationName),
      });
    });

    (fallbackPayload?.edges || [])
      .filter(edge => edge?.type === 'ride')
      .forEach(edge => {
        addUniqueRideEdge(rideEdges, rideEdgeIds, edge);
      });
  }

  for (const extension of LINE_EXTENSION_INPUTS) {
    try {
      const extensionCsvText = execFileSync('iconv', ['-f', 'cp949', '-t', 'utf-8', extension.path], { encoding: 'utf8' });
      const extensionLines = extensionCsvText.split(/\r?\n/).filter(Boolean);
      const extensionRows = extensionLines.slice(1).map(line => line.split(','));

      const extensionStationIds = [];
      extensionRows.forEach(row => {
        const stationName = String(row[2] || '').trim();
        if (!stationName) return;
        const stationId = `${extension.lineName}:${stationName}`;
        const station = {
          id: stationId,
          lineName: extension.lineName,
          stationName,
          stationNameNormalized: normalizeStationName(stationName),
          cumulativeKm: Number(row[3] || 0) || 0,
        };
        if (addUniqueStation(stations, stationIds, stationNameMap, station)) {
          extensionStationIds.push(stationId);
        } else {
          extensionStationIds.push(stationId);
        }
      });

      extensionRows.forEach((row, index) => {
        const currentId = extensionStationIds[index];
        const nextId = extensionStationIds[index + 1];
        if (!currentId || !nextId) return;
        const distanceKm = Number((extensionRows[index + 1] || [])[3] || 0)
          || Number((extensionRows[index] || [])[4] || 0)
          || 0;
        const minutes = Math.max(1, Math.round(distanceKm * extension.minutesPerKm));
        addUniqueRideEdge(rideEdges, rideEdgeIds, {
          from: currentId,
          to: nextId,
          minutes,
          distanceKm,
          type: 'ride',
        });
      });
    } catch (error) {
      console.warn(`Skipped extension line file: ${extension.path}`);
    }
  }

  const transferEdges = [];
  stationNameMap.forEach(stationIds => {
    if (stationIds.length < 2) return;
    for (let i = 0; i < stationIds.length; i += 1) {
      for (let j = i + 1; j < stationIds.length; j += 1) {
        transferEdges.push({
          from: stationIds[i],
          to: stationIds[j],
          minutes: TRANSFER_MINUTES,
          distanceKm: 0,
          type: 'transfer',
        });
      }
    }
  });

  const payload = {
    meta: {
      source: sourceLabel,
      generatedAt: new Date().toISOString(),
      inputPath: sourceInputPath,
      transferMinutes: TRANSFER_MINUTES,
      extensionLineCoverage: EXTENSION_LINE_COVERAGE,
      stationCount: stations.length,
      rideEdgeCount: rideEdges.length,
      transferEdgeCount: transferEdges.length,
    },
    stations,
    edges: [...rideEdges, ...transferEdges],
  };

  const outputPath = path.join(process.cwd(), OUTPUT_PATH);
  await fs.writeFile(outputPath, JSON.stringify(payload));
  console.log(`Saved ${payload.stations.length} stations and ${payload.edges.length} edges to ${outputPath}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
