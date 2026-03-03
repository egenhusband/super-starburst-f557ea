const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body);
    const eventType = payload.eventType;

    // 결제 완료 이벤트만 처리
    if (eventType !== 'checkout.completed') {
      return { statusCode: 200, body: 'OK' };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    const userId = payload.object?.metadata?.user_id;
    const subscriptionId = payload.object?.subscription?.id;
    const customerId = payload.object?.customer?.id;

    if (!userId) {
      return { statusCode: 400, body: 'No user_id in metadata' };
    }

    // Supabase subscriptions 테이블에 저장
    const { error } = await supabase
      .from('subscriptions')
      .upsert({
        user_id: userId,
        creem_subscription_id: subscriptionId,
        creem_customer_id: customerId,
        status: 'active',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) throw error;

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, body: err.message };
  }
};
