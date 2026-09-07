const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://dvkztssdytyduxeicomy.supabase.co').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PAYWALL_PASSWORD = process.env.PAYWALL_PASSWORD || 'egenhusband^^';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (error) {
    return {};
  }
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function isPasswordValid(password) {
  return typeof password === 'string' && password === PAYWALL_PASSWORD;
}

function getNickname(me) {
  return me?.properties?.nickname
    || me?.kakao_account?.profile?.nickname
    || '카카오 계정';
}

async function verifyKakaoAccessToken(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') {
    const error = new Error('카카오 인증 정보가 없어요.');
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = new Error('카카오 계정을 확인하지 못했어요.');
    error.statusCode = 401;
    throw error;
  }

  const me = await response.json();
  const kakaoUserId = me?.id ? String(me.id) : '';
  if (!kakaoUserId) {
    const error = new Error('카카오 사용자 ID를 확인하지 못했어요.');
    error.statusCode = 401;
    throw error;
  }

  return {
    kakaoUserId,
    nickname: getNickname(me),
  };
}

async function supabaseFetch(path, options = {}) {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase 서버 저장소가 아직 설정되지 않았어요.');
    error.statusCode = 501;
    throw error;
  }

  const isOpaqueApiKey = SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_');
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
    ...(isOpaqueApiKey ? {} : { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }),
    ...(options.headers || {}),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...options, headers });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }

    if (response.ok) return data;
    const isFutureJwt = response.status === 401
      && (data?.code === 'PGRST303' || /jwt issued at future/i.test(data?.message || text));
    if (isFutureJwt && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, 650));
      continue;
    }
    const error = new Error(data?.message || 'Supabase 요청에 실패했어요.');
    error.code = data?.code || '';
    error.statusCode = response.status;
    throw error;
  }
}

async function findEntitlement(kakaoUserId) {
  const query = new URLSearchParams({
    kakao_user_id: `eq.${kakaoUserId}`,
    select: 'kakao_user_id,nickname,unlocked,unlocked_at,last_login_at',
    limit: '1',
  });
  const rows = await supabaseFetch(`kakao_entitlements?${query.toString()}`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertEntitlement(profile) {
  const rows = await supabaseFetch('kakao_entitlements?on_conflict=kakao_user_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      kakao_user_id: profile.kakaoUserId,
      nickname: profile.nickname,
      unlocked: true,
      unlocked_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function markLogin(kakaoUserId, nickname) {
  await supabaseFetch(`kakao_entitlements?kakao_user_id=eq.${encodeURIComponent(kakaoUserId)}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      nickname,
      last_login_at: new Date().toISOString(),
    }),
  });
}

async function findLatestCalculation(kakaoUserId) {
  const query = new URLSearchParams({
    kakao_user_id: `eq.${kakaoUserId}`,
    select: 'calculator_type,input_payload,schema_version,updated_at',
    limit: '1',
  });
  const rows = await supabaseFetch(`loan_calculation_latest?${query.toString()}`, {
    method: 'GET',
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function upsertLatestCalculation(kakaoUserId, calculation) {
  const rows = await supabaseFetch('loan_calculation_latest?on_conflict=kakao_user_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      kakao_user_id: kakaoUserId,
      calculator_type: calculation.calculatorType,
      input_payload: calculation.inputPayload,
      schema_version: calculation.schemaVersion,
      updated_at: new Date().toISOString(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

module.exports = {
  findLatestCalculation,
  findEntitlement,
  isPasswordValid,
  isSupabaseConfigured,
  jsonResponse,
  markLogin,
  parseBody,
  upsertEntitlement,
  upsertLatestCalculation,
  verifyKakaoAccessToken,
};
