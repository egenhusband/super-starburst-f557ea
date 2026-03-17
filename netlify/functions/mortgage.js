const https = require('https');

exports.handler = async function(event) {
  const API_KEY = process.env.FSS_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  const params = event.queryStringParameters || {};
  const sector = params.sector || '020000';
  const page   = parseInt(params.page || '1', 10);

  try {
    const data = await fetchPage(API_KEY, sector, page);
    const result = data.result || {};
    const maxPage  = parseInt(result.max_page_no || '1', 10);
    const hasMore  = page < maxPage;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        baseList:    result.baseList    || [],
        optionList:  result.optionList  || [],
        hasMore,
        page,
        maxPage
      })
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

function fetchPage(auth, topFinGrpNo, pageNo) {
  return new Promise((resolve, reject) => {
    const url = `http://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${auth}&topFinGrpNo=${topFinGrpNo}&pageNo=${pageNo}`;
    // http → https 시도, 실패하면 http 폴백
    const reqUrl = url.replace('http://', 'https://');
    const mod = require('https');
    mod.get(reqUrl, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', () => {
      // https 실패 시 http로 재시도
      require('http').get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch(e) { reject(new Error('JSON parse error')); }
        });
      }).on('error', reject);
    });
  });
}
