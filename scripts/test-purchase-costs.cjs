const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../tax.js'), 'utf8'), context);
const calculate = context.window.RealEstateTax.calculatePurchaseCosts;
for (const [priceEok, expected] of [[0, 0], [0.49, 250000], [0.5, 250000],
  [1.99, 800000], [2, 800000], [5, 2000000], [9, 4500000],
  [12, 7200000], [15, 10500000]]) {
  assert.equal(calculate({ priceEok }).brokerageCeiling, expected, `price ${priceEok}`);
}
const base = calculate({ priceEok: 5, acquisition: 5500000 });
assert.equal(base.total, 7700000);
assert.equal(base.registrationMissing, true);
const quote = calculate({ priceEok: 5, acquisition: 5500000,
  brokerage: 1800000, registration: 1000000, other: 2000000 });
assert.equal(quote.total, 10300000);
assert.equal(quote.registrationMissing, false);
assert.equal(calculate({ priceEok: 5, brokerage: 0 }).brokerage, 0);
assert.equal(calculate({ priceEok: 5, registration: -5 }).registration, 0);
console.log('Purchase costs: 16 assertions passed');
