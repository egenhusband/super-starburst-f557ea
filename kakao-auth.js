(function () {
  const KAKAO_JS_KEY = 'd8d6691b19d2ac9e50014fd9ebc79367';
  const STORAGE_LINKED_USER = 'kakaoLinkedUserId';
  const STORAGE_LAST_NICKNAME = 'kakaoLastNickname';

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
    if (button) button.disabled = true;
    try {
      const profile = buildProfile(await requestKakaoLogin());
      if (!profile.id) throw new Error('카카오 계정 정보를 확인하지 못했어요.');
      localStorage.setItem(STORAGE_LINKED_USER, profile.id);
      localStorage.setItem(STORAGE_LAST_NICKNAME, profile.nickname);
      closeKakaoLinkSheet();
    } catch (error) {
      setPayMessage(error?.message || '카카오 로그인을 완료하지 못했어요.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function restoreWithKakao() {
    const profile = buildProfile(await requestKakaoLogin());
    const linkedUserId = localStorage.getItem(STORAGE_LINKED_USER);
    if (!profile.id || linkedUserId !== profile.id) return false;
    localStorage.setItem('authVerified', '1');
    localStorage.setItem(STORAGE_LAST_NICKNAME, profile.nickname);
    return true;
  }

  async function restoreWithKakaoFromPaySheet() {
    const button = document.getElementById('btnKakaoAutoEnter');
    if (button) button.disabled = true;
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
    } catch (error) {
      setPayMessage(error?.message || '카카오 자동 입장을 완료하지 못했어요.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  window.KakaoAuthBridge = {
    hasLinkedKakaoAccount,
    openKakaoLinkSheet,
    closeKakaoLinkSheet,
    linkKakaoAfterPassword,
    restoreWithKakao,
    restoreWithKakaoFromPaySheet,
  };
  window.closeKakaoLinkSheet = closeKakaoLinkSheet;
  window.linkKakaoAfterPassword = linkKakaoAfterPassword;
  window.restoreWithKakaoFromPaySheet = restoreWithKakaoFromPaySheet;
})();
