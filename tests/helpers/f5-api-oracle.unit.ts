import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluateGetInternal, expectedFromGet } from './f5-api-oracle.js';

const get = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  totalCash: { amount: 100, quantity: 2 },
  totalCheckingAccount: { amount: 50, quantity: 1 },
  totalCreditCard: { amount: 0, quantity: 0 },
  totalCashOtherCostNoCommissionable: { amount: 10, quantity: 1 },
  checkingAccountAgencyProfitDiff: 0,
  taxesCostCash: 5,
  totalBilling: 150,
  commissionSum: 1,
  agencyTotalCommission: 2,
  ownerTotalCommission: 3,
  ...over
});
const rows = [
  { paymentMethod: 'CASH' },
  { paymentMethod: 'CASH' },
  { paymentMethod: 'CHECKING_ACCOUNT' }
];

it('expectedFromGet: efectivo a rendir = totalCash + NC + impuestos; recaudado suma todo', () => {
  const e = expectedFromGet(get());
  assert.equal(e.cashToSurrender, 115);
  assert.equal(e.totalCollected, 165);
  assert.equal(e.ncCash.amount, 10);
});
it('expectedFromGet: lanza si falta un campo imprescindible', () => {
  assert.throws(() => expectedFromGet(get({ totalCash: undefined })), /totalCash/);
});
it('evaluateGetInternal: GET coherente pasa', () => {
  assert.equal(evaluateGetInternal(get(), rows).ok, true);
});
it('evaluateGetInternal: cantidad por medio de pago distinta de las filas falla', () => {
  const v = evaluateGetInternal(get({ totalCash: { amount: 100, quantity: 3 } }), rows);
  assert.equal(v.ok, false);
  assert.match(v.mismatches[0].field, /totalCash\.quantity/);
});
it('evaluateGetInternal: totalBilling incoherente, NC incoherente y comisión ausente fallan', () => {
  assert.equal(evaluateGetInternal(get({ totalBilling: 999 }), rows).ok, false);
  assert.equal(
    evaluateGetInternal(
      get({ totalCashOtherCostNoCommissionable: { amount: 10, quantity: 0 } }),
      rows
    ).ok,
    false
  );
  assert.equal(
    evaluateGetInternal(
      get({ totalCashOtherCostNoCommissionable: { amount: 10, quantity: 3 } }),
      rows
    ).ok,
    false
  );
  assert.equal(evaluateGetInternal(get({ ownerTotalCommission: undefined }), rows).ok, false);
});
it('evaluateGetInternal: checkingAccountAgencyProfitDiff ausente falla (no se asume 0)', () => {
  assert.equal(
    evaluateGetInternal(get({ checkingAccountAgencyProfitDiff: undefined }), rows).ok,
    false
  );
});
