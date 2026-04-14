exports.handler = async function(event) {
  const params = new URLSearchParams({
    KEY: '011e9c482bc2432198b0ac0a8cec2f1b',
    Type: 'json',
    pIndex: event.queryStringParameters?.pIndex || '1',
    pSize:  event.queryStringParameters?.pSize  || '3',
    STATBL_ID:   event.queryStringParameters?.STATBL_ID   || 'A_2024_00016',
    DTACYCLE_CD: event.queryStringParameters?.DTACYCLE_CD || 'MM',
  });

  const url = `https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?${params}`;

  try {
    const res  = await fetch(url);
    const data = await res.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
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
