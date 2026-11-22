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

// ── 내 저장 (user_saved_items) ──
const SAVED_KINDS = new Set(['calculation', 'apartment', 'commute']);
const SAVED_LIMITS = { calculation: 30, apartment: 200, commute: 1 };

function isMissingTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(error?.message || '');
}

function validateSavedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const kind = String(item.kind || '');
  const key = String(item.key || '').slice(0, 120);
  if (!SAVED_KINDS.has(kind) || !key) return null;
  const payload = item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {};
  if (JSON.stringify(payload).length > 20000) return null;
  const updatedAt = Number.isFinite(Date.parse(item.updatedAt)) ? new Date(item.updatedAt).toISOString() : new Date().toISOString();
  return { kind, key, payload, updatedAt };
}

async function listSavedItems(kakaoUserId) {
  const query = new URLSearchParams({
    kakao_user_id: `eq.${kakaoUserId}`,
    select: 'kind,item_key,payload,updated_at',
    order: 'updated_at.desc',
    limit: '500',
  });
  const rows = await supabaseFetch(`user_saved_items?${query.toString()}`, { method: 'GET' });
  return (Array.isArray(rows) ? rows : []).map(row => ({
    kind: row.kind,
    key: row.item_key,
    payload: row.payload || {},
    updatedAt: row.updated_at,
  }));
}

async function upsertSavedItems(kakaoUserId, items) {
  if (!items.length) return [];
  const rows = await supabaseFetch('user_saved_items?on_conflict=kakao_user_id,kind,item_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(items.map(item => ({
      kakao_user_id: kakaoUserId,
      kind: item.kind,
      item_key: item.key,
      payload: item.payload,
      updated_at: item.updatedAt,
    }))),
  });
  return rows || [];
}

async function deleteSavedItems(kakaoUserId, items) {
  for (const item of items) {
    const query = new URLSearchParams({
      kakao_user_id: `eq.${kakaoUserId}`,
      kind: `eq.${item.kind}`,
      item_key: `eq.${item.key}`,
    });
    await supabaseFetch(`user_saved_items?${query.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
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
  SAVED_LIMITS,
  isMissingTableError,
  validateSavedItem,
  listSavedItems,
  upsertSavedItems,
  deleteSavedItems,
};
