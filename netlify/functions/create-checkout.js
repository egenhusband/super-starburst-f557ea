exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, email } = JSON.parse(event.body);
    const CREEM_API_KEY = process.env.CREEM_API_KEY;
    const CREEM_PRODUCT_ID = process.env.CREEM_PRODUCT_ID;
    const SITE_URL = process.env.URL || 'https://super-starburst-f557ea.netlify.app';

    const res = await fetch('https://test-api.creem.io/v1/checkouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CREEM_API_KEY
      },
      body: JSON.stringify({
        product_id: CREEM_PRODUCT_ID,
        success_url: `${SITE_URL}?payment=success`,
        customer_email: email,
        metadata: { user_id: userId }
      })
    });

    const data = await res.json();
    return {
      statusCode: 200,
      body: JSON.stringify({ url: data.checkout_url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
