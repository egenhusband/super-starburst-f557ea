const {
  isPasswordValid,
  isSupabaseConfigured,
  jsonResponse,
  parseBody,
  upsertEntitlement,
  verifyKakaoAccessToken,
} = require('./lib/kakao-supabase');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return jsonResponse(200, { ok: true });
  if (event.httpMethod !== 'POST') return jsonResponse(405, { ok: false, error: 'POST만 지원해요.' });

  try {
    if (!isSupabaseConfigured()) {
      return jsonResponse(501, {
        ok: false,
        code: 'server_not_configured',
        error: 'Supabase 서버 저장소가 아직 설정되지 않았어요.',
      });
    }

    const body = parseBody(event);
    if (!isPasswordValid(body.password)) {
      return jsonResponse(401, { ok: false, error: '비밀번호 인증이 필요해요.' });
    }

    const profile = await verifyKakaoAccessToken(body.accessToken);
    const entitlement = await upsertEntitlement(profile);

    return jsonResponse(200, {
      ok: true,
      unlocked: true,
      nickname: entitlement?.nickname || profile.nickname,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error?.message || '카카오 계정 저장에 실패했어요.',
    });
  }
};
