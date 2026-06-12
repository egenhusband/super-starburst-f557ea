#!/usr/bin/env node
// 로컬 미리보기 서버 (super-starburst-f557ea-dev 루트)
//  · 정적 파일 서빙
//  · /api/<name> 및 /.netlify/functions/<name> → netlify/functions/<name>.js 핸들러로 라우팅
//    (netlify dev 없이도 analyze-apt, calc-loan 등 함수가 로컬에서 동작)
const http = require('http');
const fs = require('fs');
const path = require('path');
try { require('./lib/load-env-local').loadEnvLocal(path.join(__dirname, '..')); } catch (e) { /* optional */ }

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'netlify', 'functions');
const PORT = Number(process.env.PORT || 8200);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
  });
}

function resolveFunctionName(pathname) {
  let m = pathname.match(/^\/api\/([\w-]+)/);
  if (m) return m[1];
  m = pathname.match(/^\/\.netlify\/functions\/([\w-]+)/);
  if (m) return m[1];
  return null;
}

async function handleFunction(req, res, name, query) {
  const fnPath = path.join(FN_DIR, `${name}.js`);
  if (!fnPath.startsWith(FN_DIR) || !fs.existsSync(fnPath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `function not found: ${name}` }));
    return;
  }
  try {
    const mod = require(fnPath);
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : '';
    const event = {
      httpMethod: req.method,
      headers: req.headers,
      body,
      queryStringParameters: Object.fromEntries(new URLSearchParams(query || '')),
    };
    const result = await mod.handler(event, {});
    res.writeHead(result.statusCode || 200, result.headers || { 'Content-Type': 'application/json' });
    res.end(result.body || '');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

http.createServer(async (req, res) => {
  const [pathPart, query] = req.url.split('?');
  const pathname = decodeURIComponent(pathPart);

  // 함수 라우팅
  const fnName = resolveFunctionName(pathname);
  if (fnName) { await handleFunction(req, res, fnName, query); return; }

  // 정적 파일
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, path.normalize(rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`▶ 로컬 미리보기: http://localhost:${PORT}/index.html`);
  console.log(`  · 정적 + 함수(/api/*) 라우팅 활성화`);
});
