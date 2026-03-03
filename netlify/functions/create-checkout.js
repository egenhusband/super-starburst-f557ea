exports.handler = async (event) => {
  console.log('=== create-checkout called ===');
  console.log('method:', event.httpMethod);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    console.log('userId:', body.userId, 'email:', body.email);

    const CREEM_API_KEY = process.env.CREEM_API_KEY;
    const CREEM_PRODUCT_ID = process.env.CREEM_PRODUCT_ID;
    const SITE_URL = 'https://dev--super-starburst-f557ea.netlify.app';

    console.log('API_KEY exists:', !!CREEM_API_KEY);
    console.log('PRODUCT_ID:', CREEM_PRODUCT_ID);

    const res = await fetch('https://test-api.creem.io/v1/checkouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CREEM_API_KEY
      },
      body: JSON.stringify({
        product_id: CREEM_PRODUCT_ID,
        success_url: `${SITE_URL}?payment=success`,
        customer: { email: body.email },
        metadata: { user_id: body.userId }
      })
    });

    console.log('creem status:', res.status);
    const text = await res.text();
    console.log('creem response:', text);

    const data = JSON.parse(text);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: data.checkout_url })
    };
  } catch (err) {
    console.error('error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
