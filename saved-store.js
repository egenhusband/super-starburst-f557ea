/*
 * 내 저장 — 계산 결과 · 관심 단지 · 출근지
 *
 * 1) 항상 이 기기(localStorage)에 먼저 저장한다. 로그인 없이도 바로 동작.
 * 2) 이용권 구매 후 카카오를 연결한 계정이면 /api/saved-items 로 동기화해서 다른 기기에서도 보인다.
 *    서버가 아직 준비 안 됐거나(테이블 없음 등) 토큰이 없으면 조용히 이 기기 저장만 유지한다.
 * 3) 삭제는 동기화될 때까지 tombstone으로 남겨 다른 기기에서 되살아나지 않게 한다.
 */
(function () {
  const STORAGE_ITEMS = 'savedItems_v1';
  const KINDS = ['calculation', 'apartment', 'commute'];
  const LIMITS = { calculation: 30, apartment: 200, commute: 1 };
  let syncTimer = null;
  let syncing = null;
  let lastSyncError = '';

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // { 'kind:key': { kind, key, payload, updatedAt, deleted?, dirty? } }
  function readAll() { return readJson(STORAGE_ITEMS, {}); }
  function writeAll(map) {
    writeJson(STORAGE_ITEMS, map);
    window.dispatchEvent(new CustomEvent('saved-items-changed'));
  }

  function id(kind, key) { return `${kind}:${key}`; }

  function list(kind) {
    return Object.values(readAll())
      .filter(item => item.kind === kind && !item.deleted)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function get(kind, key) {
    const item = readAll()[id(kind, key)];
    return item && !item.deleted ? item : null;
  }

  function has(kind, key) { return Boolean(get(kind, key)); }

  function trim(map, kind) {
    const alive = Object.values(map).filter(item => item.kind === kind && !item.deleted)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    alive.slice(LIMITS[kind] || 999).forEach(item => {
      map[id(kind, item.key)] = { ...item, deleted: true, dirty: true, updatedAt: new Date().toISOString() };
    });
  }

  function upsert(kind, key, payload) {
    if (!KINDS.includes(kind) || !key) return null;
    const map = readAll();
    const item = { kind, key: String(key), payload: payload || {}, updatedAt: new Date().toISOString(), dirty: true };
    map[id(kind, key)] = item;
    trim(map, kind);
    writeAll(map);
    scheduleSync();
    return item;
  }

  function remove(kind, key) {
    const map = readAll();
    const existing = map[id(kind, key)];
    if (!existing || existing.deleted) return;
    map[id(kind, key)] = { ...existing, deleted: true, dirty: true, updatedAt: new Date().toISOString() };
    writeAll(map);
    scheduleSync();
  }

  function toggle(kind, key, payload) {
    if (has(kind, key)) { remove(kind, key); return false; }
    upsert(kind, key, payload);
    return true;
  }

  // ── 카카오 계정: 이용권 구매 후 카카오를 연결한 계정만 (결제 흐름의 연결 정보를 그대로 쓴다) ──
  function getAccount() {
    return window.KakaoAuthBridge?.getLinkedPaidAccount?.() || null;
  }

  function isPaid() {
    try { return window.PaywallController?.isUnlocked?.() || localStorage.getItem('authVerified') === '1' || localStorage.getItem('paywallUnlocked') === '1'; }
    catch (_) { return false; }
  }

  // 다른 기기에서 이미 연결한 구매자: 카카오로 다시 입장하면 연결 정보가 생기고 동기화된다
  async function connectKakao() {
    const bridge = window.KakaoAuthBridge;
    if (!bridge?.restoreWithKakao) throw new Error('카카오 로그인을 불러오지 못했어요.');
    const restored = await bridge.restoreWithKakao();
    if (!restored || !getAccount()) {
      const error = new Error('이 카카오 계정에는 이용권이 연결돼 있지 않아요.');
      error.code = 'not_entitled';
      throw error;
    }
    window.dispatchEvent(new CustomEvent('saved-items-changed'));
    await syncNow();
    return getAccount();
  }

  function scheduleSync() {
    if (!getAccount()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 800);
  }

  // 서버와 합치기: 같은 항목이면 더 최근에 바뀐 쪽을 따른다
  function mergeServerItems(serverItems) {
    const map = readAll();
    const serverIds = new Set();
    (serverItems || []).forEach(item => {
      const key = id(item.kind, item.key);
      serverIds.add(key);
      const local = map[key];
      if (!local || (!local.dirty && String(item.updatedAt) >= String(local.updatedAt)) || String(item.updatedAt) > String(local.updatedAt)) {
        map[key] = { kind: item.kind, key: item.key, payload: item.payload || {}, updatedAt: item.updatedAt };
      }
    });
    Object.entries(map).forEach(([key, item]) => {
      if (item.dirty) return;
      if (item.deleted) { delete map[key]; return; }
      // 서버에서 지워진 항목(다른 기기에서 삭제) — 이미 한 번 동기화된 적 있는 항목만 지운다
      if (item.synced && !serverIds.has(key)) delete map[key];
    });
    Object.values(map).forEach(item => { if (!item.dirty && !item.deleted) item.synced = true; });
    writeAll(map);
  }

  async function syncNow() {
    if (syncing) return syncing;
    const account = getAccount();
    const bridge = window.KakaoAuthBridge;
    const token = bridge?.getAccessTokenSafe?.();
    if (!account || !token || !bridge?.postAuthFunction) return false;
    const map = readAll();
    const dirty = Object.values(map).filter(item => item.dirty);
    const upserts = dirty.filter(item => !item.deleted).map(({ kind, key, payload, updatedAt }) => ({ kind, key, payload, updatedAt }));
    const deletes = dirty.filter(item => item.deleted).map(({ kind, key }) => ({ kind, key }));
    syncing = bridge.postAuthFunction('/api/saved-items', { action: 'sync', accessToken: token, upserts, deletes })
      .then(data => {
        // 보낸 항목은 dirty 해제 (보내는 사이 다시 바뀐 항목은 그대로 둔다)
        const now = readAll();
        dirty.forEach(item => {
          const current = now[id(item.kind, item.key)];
          if (current && current.updatedAt === item.updatedAt) {
            if (current.deleted) delete now[id(item.kind, item.key)];
            else { delete current.dirty; current.synced = true; }
          }
        });
        writeJson(STORAGE_ITEMS, now);
        mergeServerItems(data?.items || []);
        lastSyncError = '';
        return true;
      })
      .catch(error => {
        lastSyncError = error?.code === 'not_entitled' || error?.statusCode === 403
          ? '이용권이 확인되지 않아 이 기기에만 저장돼요'
          : error?.code === 'table_missing' || error?.statusCode === 501 || error?.statusCode === 404
            ? '지금은 이 기기에만 저장돼요'
            : '카카오 동기화를 못 했어요. 다시 시도해 주세요';
        window.dispatchEvent(new CustomEvent('saved-items-changed'));
        return false;
      })
      .finally(() => { syncing = null; });
    return syncing;
  }

  function getSyncStatus() {
    if (!getAccount()) return '';
    if (syncing) return '동기화 중';
    return lastSyncError || '카카오 계정에 저장 중';
  }

  window.SavedStore = { list, get, has, upsert, remove, toggle, getAccount, isPaid, connectKakao, syncNow, getSyncStatus };
  window.addEventListener('load', () => { setTimeout(() => { syncNow().catch(() => {}); }, 1200); }, { once: true });
})();
