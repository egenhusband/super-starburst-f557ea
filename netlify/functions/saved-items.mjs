// 내 저장: 카카오 계정별 계산 결과 · 관심 단지 · 출근지 동기화
// POST /api/saved-items { action: 'sync', accessToken, upserts: [...], deletes: [{kind,key}] }
//   → 받은 변경을 반영한 뒤 서버의 전체 목록을 돌려준다.
import kakaoSupabase from './lib/kakao-supabase.js';

const {
  SAVED_LIMITS,
  deleteSavedItems,
  isMissingTableError,
  isSupabaseConfigured,
  listSavedItems,
  upsertSavedItems,
  validateSavedItem,
  verifyKakaoAccessToken,
} = kakaoSupabase;

function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export default async (request) => {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'POST만 지원해요.' }, 405);
  try {
    if (!isSupabaseConfigured()) {
      return jsonResponse({ ok: false, code: 'server_not_configured', error: '서버 저장소가 아직 설정되지 않았어요.' }, 501);
    }
    const body = await request.json().catch(() => ({}));
    if (body.action !== 'sync') return jsonResponse({ ok: false, error: '지원하지 않는 요청이에요.' }, 400);

    const profile = await verifyKakaoAccessToken(body.accessToken);
    const upserts = (Array.isArray(body.upserts) ? body.upserts : []).map(validateSavedItem).filter(Boolean).slice(0, 300);
    const deletes = (Array.isArray(body.deletes) ? body.deletes : []).map(validateSavedItem).filter(Boolean).slice(0, 300);

    await upsertSavedItems(profile.kakaoUserId, upserts);
    await deleteSavedItems(profile.kakaoUserId, deletes);
    let items = await listSavedItems(profile.kakaoUserId);

    // 종류별 개수 제한: 오래된 것부터 정리
    const overflow = [];
    Object.entries(SAVED_LIMITS).forEach(([kind, limit]) => {
      const ofKind = items.filter(item => item.kind === kind);
      if (ofKind.length > limit) overflow.push(...ofKind.slice(limit));
    });
    if (overflow.length) {
      await deleteSavedItems(profile.kakaoUserId, overflow);
      const drop = new Set(overflow.map(item => `${item.kind}:${item.key}`));
      items = items.filter(item => !drop.has(`${item.kind}:${item.key}`));
    }

    return jsonResponse({ ok: true, nickname: profile.nickname, kakaoUserId: profile.kakaoUserId, items });
  } catch (error) {
    if (isMissingTableError(error)) {
      return jsonResponse({ ok: false, code: 'table_missing', error: '저장 테이블이 아직 만들어지지 않았어요.' }, 501);
    }
    return jsonResponse({ ok: false, error: error?.message || '저장 요청을 처리하지 못했어요.' }, error?.statusCode || 500);
  }
};

export const config = { path: '/api/saved-items' };
