exports.handler = async function(event) {
  const key = process.env.REB_API_KEY;
  if (!key) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'REB_API_KEY is not configured.' }),
    };
  }

  const p = event.queryStringParameters || {};
  const params = new URLSearchParams({
    KEY: key,
    Type: 'json',
    pIndex: p.pIndex || '1',
    pSize:  p.pSize  || '500',
    STATBL_ID:   p.STATBL_ID   || 'A_2024_00016',
    DTACYCLE_CD: p.DTACYCLE_CD || 'MM',
  });

  if (p.START_WRTTIME) params.set('START_WRTTIME', p.START_WRTTIME);
  if (p.END_WRTTIME)   params.set('END_WRTTIME',   p.END_WRTTIME);

  const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?${params}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
