(function () {
  const KAKAO_JS_KEY = 'd8d6691b19d2ac9e50014fd9ebc79367';
  const STORAGE_LINKED_USER = 'kakaoLinkedUserId';
  const STORAGE_LAST_NICKNAME = 'kakaoLastNickname';
  const STORAGE_LINK_PASSWORD = 'kakaoLinkPassword';
  const STORAGE_LINK_PASSWORD_EXPIRES = 'kakaoLinkPasswordExpiresAt';
  const LINK_PASSWORD_TTL_MS = 3 * 60 * 1000;
  let latestCalculation = null;
  let latestSavePromise = null;
  let latestRestoreStarted = false;

  function getKakaoSdk() {
    return window.Kakao && typeof window.Kakao.init === 'function' ? window.Kakao : null;
  }

  function ensureKakaoReady() {
    const kakao = getKakaoSdk();
    if (!kakao) throw new Error('카카오 SDK를 불러오지 못했어요.');
    if (!kakao.isInitialized()) kakao.init(KAKAO_JS_KEY);
    return kakao;
  }

  function setPayMessage(message, isError = false) {
    const target = document.getElementById('pwErr');
    if (!target) return;
    target.textContent = message || '';
    target.classList.toggle('is-info', Boolean(message && !isError));
  }

  function setKakaoLinkMessage(message, isError = false) {
    const target = document.getElementById('kakaoLinkMessage');
    if (!target) return;
    target.textContent = message || '';
    target.classList.toggle('is-error', Boolean(message && isError));
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.disabled = Boolean(isLoading);
    button.classList.toggle('is-loading', Boolean(isLoading));
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  function buildProfile(me) {
    const id = me?.id ? String(me.id) : '';
    const nickname = me?.properties?.nickname
      || me?.kakao_account?.profile?.nickname
      || '카카오 계정';
    return { id, nickname };
  }

  function hasLinkedKakaoAccount() {
    return Boolean(localStorage.getItem(STORAGE_LINKED_USER));
  }

  function getAccessToken() {
    const kakao = ensureKakaoReady();
    const token = typeof kakao.Auth.getAccessToken === 'function'
      ? kakao.Auth.getAccessToken()
      : '';
    if (!token) throw new Error('카카오 인증 토큰을 확인하지 못했어요.');
    return token;
  }

  async function postAuthFunction(path, payload) {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error || '서버 인증 요청에 실패했어요.');
      error.code = data?.code || '';
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  function canUseLocalFallback(error) {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || window.location.protocol === 'file:';
    return isLocal
      && (error?.code === 'server_not_configured' || error?.statusCode === 404 || error?.statusCode === 501 || !error?.statusCode);
  }

  function rememberPasswordForLink(password) {
    if (!password) return;
    sessionStorage.setItem(STORAGE_LINK_PASSWORD, password);
    sessionStorage.setItem(STORAGE_LINK_PASSWORD_EXPIRES, String(Date.now() + LINK_PASSWORD_TTL_MS));
  }

  function takePasswordForLink() {
    const expiresAt = Number(sessionStorage.getItem(STORAGE_LINK_PASSWORD_EXPIRES) || 0);
    const password = sessionStorage.getItem(STORAGE_LINK_PASSWORD) || '';
    sessionStorage.removeItem(STORAGE_LINK_PASSWORD);
    sessionStorage.removeItem(STORAGE_LINK_PASSWORD_EXPIRES);
    if (!password || !expiresAt || expiresAt < Date.now()) return '';
    return password;
  }

  function requestKakaoLogin() {
    const kakao = ensureKakaoReady();
    return new Promise((resolve, reject) => {
      kakao.Auth.login({
        success() {
          kakao.API.request({
            url: '/v2/user/me',
            success: resolve,
            fail: reject,
          });
        },
        fail: reject,
      });
    });
  }

  function openKakaoLinkSheet() {
    if (hasLinkedKakaoAccount()) return;
    const overlay = document.getElementById('kakaoLinkOverlay');
    if (!overlay) return;
    setKakaoLinkMessage('');
    overlay.classList.remove('is-closing');
    overlay.classList.add('open');
  }

  function closeKakaoLinkSheet() {
    const overlay = document.getElementById('kakaoLinkOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.classList.remove('is-closing'), 220);
  }

  async function linkKakaoAfterPassword() {
    const button = document.getElementById('btnKakaoLink');
    setButtonLoading(button, true);
    setKakaoLinkMessage('카카오 계정에 사용 권한을 저장하고 있어요.');
    try {
      const profile = buildProfile(await requestKakaoLogin());
      if (!profile.id) throw new Error('카카오 계정 정보를 확인하지 못했어요.');
      const accessToken = getAccessToken();
      const password = takePasswordForLink();
      if (!password) throw new Error('비밀번호 인증 시간이 지나 다시 입력이 필요해요.');
      try {
        const data = await postAuthFunction('/.netlify/functions/kakao-link', { accessToken, password });
        if (!data?.unlocked) throw new Error('카카오 계정 저장이 완료되지 않았어요.');
      } catch (error) {
        if (!canUseLocalFallback(error)) throw error;
      }
      localStorage.setItem(STORAGE_LINKED_USER, profile.id);
      localStorage.setItem(STORAGE_LAST_NICKNAME, profile.nickname);
      setKakaoLinkMessage('저장됐어요. 다음부터 카카오로 자동 입장할 수 있어요.');
      closeKakaoLinkSheet();
    } catch (error) {
      setKakaoLinkMessage(error?.message || '카카오 로그인을 완료하지 못했어요.', true);
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function restoreWithKakao() {
    const profile = buildProfile(await requestKakaoLogin());
    const accessToken = getAccessToken();
    latestRestoreStarted = true;
    try {
      const data = await postAuthFunction('/api/kakao-session', { action: 'restore', accessToken });
      if (!data?.unlocked) return false;
      latestCalculation = data.latestCalculation || null;
      localStorage.setItem('authVerified', '1');
      localStorage.setItem(STORAGE_LINKED_USER, profile.id);
      localStorage.setItem(STORAGE_LAST_NICKNAME, data.nickname || profile.nickname);
      return true;
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
    }

    const linkedUserId = localStorage.getItem(STORAGE_LINKED_USER);
    if (!profile.id || linkedUserId !== profile.id) return false;
    localStorage.setItem('authVerified', '1');
    localStorage.setItem(STORAGE_LAST_NICKNAME, profile.nickname);
    return true;
  }

  async function restoreWithKakaoFromPaySheet() {
    const button = document.getElementById('btnKakaoAutoEnter');
    setButtonLoading(button, true);
    setPayMessage('카카오 계정을 확인하고 있어요.');
    try {
      const restored = await restoreWithKakao();
      if (!restored) {
        setPayMessage('저장된 카카오 계정이 아니에요. 비밀번호로 한 번 입장한 뒤 저장해주세요.', true);
        return;
      }
      setPayMessage('카카오 계정으로 입장했어요.');
      if (window.PaywallController && typeof window.PaywallController.resumeAfterAuth === 'function') {
        window.PaywallController.resumeAfterAuth({ skipKakaoLinkPrompt: true });
      }
      if (latestCalculation && typeof window.showRecentCalculationToast === 'function') {
        setTimeout(() => window.showRecentCalculationToast(latestCalculation), 680);
      }
    } catch (error) {
      setPayMessage(error?.message || '카카오 자동 입장을 완료하지 못했어요.', true);
    } finally {
      setButtonLoading(button, false);
    }
  }

  function saveLatestCalculation(calculation) {
    if (!calculation || !hasLinkedKakaoAccount()) return Promise.resolve(false);
    let accessToken = '';
    try {
      accessToken = getAccessToken();
    } catch (_) {
      return Promise.resolve(false);
    }

    latestSavePromise = postAuthFunction('/api/kakao-session', {
      action: 'save',
      accessToken,
      calculation,
    }).then(data => Boolean(data?.saved)).catch(() => false);
    return latestSavePromise;
  }

  async function loadLatestCalculationIfAvailable() {
    if (latestRestoreStarted || !hasLinkedKakaoAccount() || localStorage.getItem('authVerified') !== '1') return;
    let accessToken = '';
    try {
      accessToken = getAccessToken();
    } catch (_) {
      return;
    }
    latestRestoreStarted = true;
    try {
      const data = await postAuthFunction('/api/kakao-session', { action: 'restore', accessToken });
      latestCalculation = data?.unlocked ? data.latestCalculation || null : null;
      if (latestCalculation && typeof window.showRecentCalculationToast === 'function') {
        setTimeout(() => window.showRecentCalculationToast(latestCalculation), 680);
      }
    } catch (_) {
      // 저장된 카카오 토큰이 없거나 만료된 경우 기존 진입 흐름은 그대로 유지한다.
    }
  }

  window.KakaoAuthBridge = {
    hasLinkedKakaoAccount,
    rememberPasswordForLink,
    openKakaoLinkSheet,
    closeKakaoLinkSheet,
    linkKakaoAfterPassword,
    restoreWithKakao,
    restoreWithKakaoFromPaySheet,
    saveLatestCalculation,
    loadLatestCalculationIfAvailable,
  };
  window.closeKakaoLinkSheet = closeKakaoLinkSheet;
  window.linkKakaoAfterPassword = linkKakaoAfterPassword;
  window.restoreWithKakaoFromPaySheet = restoreWithKakaoFromPaySheet;
  window.addEventListener('load', loadLatestCalculationIfAvailable, { once: true });
})();
