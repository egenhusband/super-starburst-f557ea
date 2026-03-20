const https = require('https');
const http  = require('http');

exports.handler = async function(event) {
  const API_KEY = process.env.FSS_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  const params = event.queryStringParameters || {};
  const sector = params.sector || '020000';
  const page   = parseInt(params.page || '1', 10);

  try {
    const data   = await fetchPage(API_KEY, sector, page);
    const result = data.result || {};

    // FSS API는 max_page_no를 result 루트 또는 baseList[0] 안에 넣는 경우가 있음
    const baseList   = result.baseList   || [];
    const optionList = result.optionList || [];

    const rawMaxPage =
      result.max_page_no ||
      (baseList[0] && baseList[0].max_page_no) ||
      '1';
    const maxPage = parseInt(rawMaxPage, 10) || 1;
    const hasMore = page < maxPage;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ baseList, optionList, hasMore, page, maxPage })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

function fetchPage(auth, topFinGrpNo, pageNo) {
  const urlHttp  = `http://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${auth}&topFinGrpNo=${topFinGrpNo}&pageNo=${pageNo}`;
  const urlHttps = urlHttp.replace('http://', 'https://');

  return new Promise((resolve, reject) => {
    function tryFetch(mod, url, fallback) {
      mod.get(url, (res) => {
        // HTTP 301/302 리다이렉트 처리
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc     = res.headers.location;
          const nextMod = loc.startsWith('https') ? https : http;
          return tryFetch(nextMod, loc, fallback);
        }
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('JSON parse error: ' + body.slice(0, 200))); }
        });
      }).on('error', (err) => {
        if (fallback) fallback();
        else reject(err);
      });
    }

    // https 먼저, 실패하면 http 폴백
    tryFetch(https, urlHttps, () => {
      tryFetch(http, urlHttp, null);
    });
  });
}

