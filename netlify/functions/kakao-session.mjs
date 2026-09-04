import kakaoSupabase from './lib/kakao-supabase.js';

const {
  findEntitlement,
  findLatestCalculation,
  isSupabaseConfigured,
  markLogin,
  upsertLatestCalculation,
  verifyKakaoAccessToken,
} = kakaoSupabase;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function validateCalculation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const calculatorType = value.calculatorType;
  const inputPayload = value.inputPayload;
  const schemaVersion = Number(value.schemaVersion || 1);
  if (!['fund', 'bank'].includes(calculatorType)) return null;
  if (!inputPayload || typeof inputPayload !== 'object' || Array.isArray(inputPayload)) return null;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 100) return null;
  if (JSON.stringify(inputPayload).length > 20000) return null;
  return { calculatorType, inputPayload, schemaVersion };
}

export default async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POST만 지원해요.' }, 405);
  }

  try {
    if (!isSupabaseConfigured()) {
      return jsonResponse({
        ok: false,
        code: 'server_not_configured',
        error: 'Supabase 서버 저장소가 아직 설정되지 않았어요.',
      }, 501);
    }

    const body = await request.json().catch(() => ({}));
    const profile = await verifyKakaoAccessToken(body.accessToken);
    const entitlement = await findEntitlement(profile.kakaoUserId);
    if (!entitlement?.unlocked) {
      return jsonResponse({ ok: true, unlocked: false });
    }

    if (body.action === 'restore') {
      await markLogin(profile.kakaoUserId, profile.nickname);
      const latest = await findLatestCalculation(profile.kakaoUserId);
      return jsonResponse({
        ok: true,
        unlocked: true,
        nickname: entitlement.nickname || profile.nickname,
        latestCalculation: latest ? {
          calculatorType: latest.calculator_type,
          inputPayload: latest.input_payload,
          schemaVersion: latest.schema_version,
          updatedAt: latest.updated_at,
        } : null,
      });
    }

    if (body.action === 'save') {
      const calculation = validateCalculation(body.calculation);
      if (!calculation) {
        return jsonResponse({ ok: false, error: '저장할 계산 정보가 올바르지 않아요.' }, 400);
      }
      await upsertLatestCalculation(profile.kakaoUserId, calculation);
      return jsonResponse({ ok: true, saved: true });
    }

    return jsonResponse({ ok: false, error: '지원하지 않는 요청이에요.' }, 400);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error?.message || '카카오 계정 요청을 처리하지 못했어요.',
    }, error?.statusCode || 500);
  }
};

export const config = {
  path: '/api/kakao-session',
};
