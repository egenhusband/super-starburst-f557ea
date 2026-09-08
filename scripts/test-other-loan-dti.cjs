const assert = require('node:assert/strict');
const { calculateFundLoan } = require('../netlify/functions/calc-loan.js')._private;

const baseInput = {
  income: 1500,
  price: 3,
  asset: 1,
  household: '일반',
  house: '무주택',
  children: '없음',
  region: '수도권',
};

const withoutOtherLoan = calculateFundLoan({ ...baseInput, otherLoanInterest: 0 });
const withOtherLoan = calculateFundLoan({ ...baseInput, otherLoanInterest: 600 });

assert.equal(withOtherLoan.inputs.otherLoanInterest, 600);
assert.ok(
  withOtherLoan.products.didimdol.dtiLimit < withoutOtherLoan.products.didimdol.dtiLimit,
  '기타대출 연간 이자가 있으면 DTI 기준 한도가 낮아져야 합니다.',
);
assert.ok(
  withOtherLoan.products.didimdol.finalLimit < withoutOtherLoan.products.didimdol.finalLimit,
  'DTI가 최종 제한 조건인 경우 예상 대출 한도에도 반영되어야 합니다.',
);

console.log('Other-loan DTI: 3 assertions passed');
