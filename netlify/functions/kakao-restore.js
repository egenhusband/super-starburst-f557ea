const {
  findEntitlement,
  isSupabaseConfigured,
  jsonResponse,
  markLogin,
  parseBody,
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
    const profile = await verifyKakaoAccessToken(body.accessToken);
    const entitlement = await findEntitlement(profile.kakaoUserId);
    const unlocked = Boolean(entitlement?.unlocked);

    if (unlocked) await markLogin(profile.kakaoUserId, profile.nickname);

    return jsonResponse(200, {
      ok: true,
      unlocked,
      nickname: entitlement?.nickname || profile.nickname,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, {
      ok: false,
      error: error?.message || '카카오 자동 입장에 실패했어요.',
    });
  }
};
