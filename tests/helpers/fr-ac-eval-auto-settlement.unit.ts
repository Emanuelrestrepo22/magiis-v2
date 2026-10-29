// tests/helpers/fr-ac-eval-auto-settlement.unit.ts
// Unit de los evaluadores puros de ACs de rendicion automatica y liquidaciones.
/* eslint-disable playwright/expect-expect */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeLiquidationObservation,
  evaluateBatchPaymentMethods,
  evaluateCityTaxSummary,
  evaluateCurrencyEur,
  evaluateDriverAssignment,
  evaluateOwnerBookAuto,
  evaluateQuote,
  evaluateSettledLeftPending,
  evaluateTripAbsentFromBatch,
  evaluateVehicleLink,
  ownerSurrenderIds
} from './fr-ac-eval-auto-settlement.js';

test('AC-01 quote: >0 and optional expected', () => {
  assert.equal(evaluateQuote(54, '54').ok, true);
  assert.equal(evaluateQuote(54, undefined).ok, true);
  assert.equal(evaluateQuote(0, undefined).ok, false);
  assert.equal(evaluateQuote(54, '55').ok, false);
  assert.equal(evaluateQuote(54, 'abc').ok, false);
});

test('AC-02 currency: unverified when field is absent', () => {
  const absent = evaluateCurrencyEur({});
  assert.equal(absent.verified, false);
  assert.equal(evaluateCurrencyEur({ simulationPrice: { currencyCode: 'EUR' } }).ok, true);
  assert.equal(evaluateCurrencyEur({ simulationPrice: { currencyCode: 'ARS' } }).ok, false);
});

test('AC-03 city tax summary', () => {
  const ok = evaluateCityTaxSummary({
    base: 2838,
    cityTaxLineAmount: 283.8,
    otherCostsHeader: 283.8,
    fixedFees: 0,
    taxes: 0,
    simulatedTotal: 3121.8,
    pct: 0.1
  });
  assert.equal(ok.ok, true);
  const bad = evaluateCityTaxSummary({
    base: 100,
    cityTaxLineAmount: 10,
    otherCostsHeader: 10,
    fixedFees: 0,
    taxes: 0,
    simulatedTotal: 120,
    pct: 0.1
  });
  assert.equal(bad.ok, false);
  assert.equal(
    evaluateCityTaxSummary({
      base: 1,
      cityTaxLineAmount: null,
      otherCostsHeader: 0,
      fixedFees: 0,
      taxes: 0,
      simulatedTotal: 1,
      pct: 0.1
    }).ok,
    false
  );
});

test('AC-04 driver assignment: DB is mandatory, API only when numeric', () => {
  assert.equal(
    evaluateDriverAssignment({
      expectedDriverId: 4965,
      dbDriverId: 4965,
      detailDriverId: undefined
    }).ok,
    true
  );
  const withApi = evaluateDriverAssignment({
    expectedDriverId: 4965,
    dbDriverId: 4965,
    detailDriverId: 4965
  });
  assert.equal(withApi.apiChecked, true);
  assert.equal(
    evaluateDriverAssignment({ expectedDriverId: 4965, dbDriverId: null, detailDriverId: 4965 }).ok,
    false
  );
  assert.equal(
    evaluateDriverAssignment({ expectedDriverId: 4965, dbDriverId: 4965, detailDriverId: 1 }).ok,
    false
  );
});

test('AC-05 open trip is not in the pending batch', () => {
  assert.equal(
    evaluateTripAbsentFromBatch({ travelId: 9, dbPending: [1, 2], apiBatchIds: [1] }).ok,
    true
  );
  assert.equal(
    evaluateTripAbsentFromBatch({ travelId: 9, dbPending: [9], apiBatchIds: [] }).ok,
    false
  );
  assert.equal(
    evaluateTripAbsentFromBatch({ travelId: 9, dbPending: [], apiBatchIds: [9] }).ok,
    false
  );
});

test('AC-23 payment method column', () => {
  const rows = [
    { travelId: 1, paymentMethod: 'Cash' },
    { travelId: 2, paymentMethod: 'Credit Account' }
  ];
  assert.equal(
    evaluateBatchPaymentMethods(rows, [
      { travelId: 1, kind: 'CASH' },
      { travelId: 2, kind: 'CHECKING_ACCOUNT' }
    ]).ok,
    true
  );
  assert.equal(evaluateBatchPaymentMethods(rows, [{ travelId: 2, kind: 'CASH' }]).ok, false);
  assert.equal(
    evaluateBatchPaymentMethods(rows, [{ travelId: 1, kind: 'CHECKING_ACCOUNT' }]).ok,
    false
  );
  assert.equal(evaluateBatchPaymentMethods(rows, [{ travelId: 3, kind: 'CASH' }]).ok, false);
});

test('AC-37 owner book of the automatic surrender', () => {
  const rows = [{ CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 0, CREDIT: 10.8 }];
  const ok = evaluateOwnerBookAuto({ rows, expectedTdcv: 10.8, hasCc: false, tddcExpected: null });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.byCode, { TDCV: 10.8 });
  assert.equal(
    evaluateOwnerBookAuto({ rows, expectedTdcv: 11, hasCc: false, tddcExpected: null }).ok,
    false
  );
  assert.equal(
    evaluateOwnerBookAuto({ rows, expectedTdcv: null, hasCc: false, tddcExpected: null }).ok,
    false
  );
  assert.equal(
    evaluateOwnerBookAuto({ rows, expectedTdcv: 10.8, hasCc: true, tddcExpected: 1248.32 }).ok,
    false
  );
  const withCc = [...rows, { CHECKINGACCOUNTCODE: 'TDDC', DEBIT: 1248.32, CREDIT: 0 }];
  assert.equal(
    evaluateOwnerBookAuto({ rows: withCc, expectedTdcv: 10.8, hasCc: true, tddcExpected: 1248.32 })
      .ok,
    true
  );
  assert.equal(
    evaluateOwnerBookAuto({ rows: withCc, expectedTdcv: 10.8, hasCc: false, tddcExpected: null })
      .ok,
    false
  );
});

test('AC-39 vehicle stays linked', () => {
  const expected = { driverId: 4965, vehicleId: 3765, ownerId: 2927 };
  assert.equal(
    evaluateVehicleLink({
      links: [{ DRIVER_ID: 4965, VEHICLE_ID: 3765 }],
      vehicleOwnerId: 2927,
      expected
    }).ok,
    true
  );
  assert.equal(evaluateVehicleLink({ links: [], vehicleOwnerId: 2927, expected }).ok, false);
  assert.equal(
    evaluateVehicleLink({
      links: [{ DRIVER_ID: 4965, VEHICLE_ID: 3765 }],
      vehicleOwnerId: null,
      expected
    }).ok,
    false
  );
});

test('AC-75 settled surrenders leave the pending list', () => {
  assert.equal(
    evaluateSettledLeftPending({
      settledSurrenderIds: [1, 2],
      dbPendingIds: [3],
      apiPendingIds: []
    }).ok,
    true
  );
  assert.equal(
    evaluateSettledLeftPending({
      settledSurrenderIds: [1, 2],
      dbPendingIds: [2],
      apiPendingIds: []
    }).ok,
    false
  );
  assert.equal(
    evaluateSettledLeftPending({ settledSurrenderIds: [1], dbPendingIds: [], apiPendingIds: [1] })
      .ok,
    false
  );
});

test('owner pending groups to surrender ids and AC-76 observation text', () => {
  assert.deepEqual(
    ownerSurrenderIds([{ surrenderIds: '5, 3' }, { surrenderIds: null }, { surrenderIds: '9' }]),
    [3, 5, 9]
  );
  const text = describeLiquidationObservation({
    kind: 'owner',
    liquidationId: 7,
    dbTotal: 100,
    postedTotal: 100,
    isLiquidated: [{ travelId: 1, isLiquidated: 0 }]
  });
  assert.match(text, /coinciden/);
  assert.match(text, /\[0\]/);
});
