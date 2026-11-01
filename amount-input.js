/*
 * 금액 입력칸: 사용자는 항상 "만원" 단위로 입력하고, 칸 아래에 "8억 5천만원"처럼 읽기 쉬운 금액을 보여준다.
 *
 *  data-amount="manwon" — 값 자체가 만원 단위(소득 등). 아래 표기만 붙는다.
 *  data-amount="eok"    — 화면 입력은 만원이지만, 기존 계산 코드가 읽고 쓰는 input.value는 억 단위 그대로 유지한다.
 *                         (예: 85000 입력 → input.value === '8.5', input.value = 8.5 → 화면에 85000 표시)
 *                         덕분에 계산·저장·복원 코드와 이전에 저장된 계산 데이터(억 단위)를 바꾸지 않아도 된다.
 */
(function () {
  const MANWON_PER_EOK = 10000;
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function formatManwonKorean(manwon) {
    const value = Math.round(Number(manwon));
    if (!Number.isFinite(value) || value <= 0) return '';
    const eok = Math.floor(value / MANWON_PER_EOK);
    const rest = value % MANWON_PER_EOK;
    const restText = rest === 0 ? ''
      : rest % 1000 === 0 ? `${rest / 1000}천만원`
        : `${rest.toLocaleString('ko-KR')}만원`;
    if (eok > 0) return rest ? `${eok.toLocaleString('ko-KR')}억 ${restText}` : `${eok.toLocaleString('ko-KR')}억원`;
    return restText;
  }

  function getHint(input) {
    if (input._amountHint) return input._amountHint;
    const anchor = input.closest('.number-field, .bank-input-wrap, .apt-loan-price-field') || input;
    const hint = document.createElement('div');
    hint.className = 'amount-hint';
    hint.setAttribute('aria-live', 'polite');
    anchor.insertAdjacentElement('afterend', hint);
    input._amountHint = hint;
    return hint;
  }

  function renderHint(input) {
    const text = formatManwonKorean(nativeValue.get.call(input));
    const hint = getHint(input);
    hint.textContent = text;
    hint.classList.toggle('is-visible', Boolean(text));
  }

  function bindEokInput(input) {
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        const raw = nativeValue.get.call(this);
        if (raw === '') return '';
        const manwon = Number(raw);
        return Number.isFinite(manwon) ? String(manwon / MANWON_PER_EOK) : raw;
      },
      set(next) {
        const eok = next === null || next === undefined || String(next).trim() === '' ? NaN : Number(next);
        nativeValue.set.call(this, Number.isFinite(eok) ? String(Math.round(eok * MANWON_PER_EOK)) : '');
        renderHint(this);
      },
    });
  }

  function bind(input) {
    if (!(input instanceof HTMLInputElement) || input._amountBound) return;
    const mode = input.dataset.amount;
    if (mode !== 'eok' && mode !== 'manwon') return;
    input._amountBound = true;
    input.step = '1';
    input.inputMode = 'numeric';
    if (mode === 'eok') bindEokInput(input);
    input.addEventListener('input', () => renderHint(input));
    renderHint(input);
  }

  function bindAll(root) {
    if (root instanceof HTMLInputElement) bind(root);
    if (root.querySelectorAll) root.querySelectorAll('input[data-amount]').forEach(bind);
  }

  bindAll(document);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) bindAll(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.AmountInput = { formatManwonKorean, bindAll };
})();
