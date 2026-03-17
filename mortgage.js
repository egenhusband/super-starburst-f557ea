const https = require('https');

exports.handler = async function(event) {
  const API_KEY = process.env.FSS_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  // 권역코드: 은행(020000), 저축은행(030300)
  const sectors = ['020000'];
  const allBase = [];
  const allOptions = [];

  try {
    for (const topFinGrpNo of sectors) {
      // 1페이지로 최대 100건 조회 (은행권은 충분)
      const data = await fetchPage(API_KEY, topFinGrpNo, 1);
      if (data.result && data.result.baseList) {
        allBase.push(...data.result.baseList);
        allOptions.push(...data.result.optionList);
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ baseList: allBase, optionList: allOptions })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

function fetchPage(auth, topFinGrpNo, pageNo) {
  return new Promise((resolve, reject) => {
    const url = `http://finlife.fss.or.kr/finlifeapi/mortgageLoanProductsSearch.json?auth=${auth}&topFinGrpNo=${topFinGrpNo}&pageNo=${pageNo}`;
    https.get(url.replace('http://', 'https://'), (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}
