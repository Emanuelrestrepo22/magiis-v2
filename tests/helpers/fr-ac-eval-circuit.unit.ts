import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SurrenderBatch, SurrenderClient } from '../api/clients/surrender.client.js';
import type { CcMovement } from './cc-delta.js';
import type { SurrenderRow } from './db-oracle-eval.js';
import { evaluateSurrenderRow } from './db-oracle-eval.js';
import {
  editDiffs,
  evaluateAppRecalc,
  evaluateBalanceDelta,
  evaluateBookCodes,
  evaluateClientCcBalance,
  evaluateCommissionPreview,
  evaluateDbCancelled,
  evaluateDbNoCharge,
  evaluateDbClosedByAdmin,
  evaluateDbNotSurrendered,
  evaluateDriverAssigned,
  evaluateNoAgencyBookRow,
  evaluateNoDuplicatedRows,
  evaluateNotInBatch,
  evaluatePaymentColumn,
  evaluateSurrenderEditDeltas,
  expectedManualSurrender,
  nullAsZeroWhereExpectedZero,
  readBatchStateUntilEmpty,
  splitSaleCostMismatches,
  type TravelCoreDb
} from './fr-ac-eval-circuit.js';

const core = (over: Partial<TravelCoreDb> = {}): TravelCoreDb => ({
  hasTravelRow: true,
  hasHistoryRow: false,
  STATE: 6,
  SURRENDERED: 0,
  DRIVER_ID: 4965,
  FINALIZE_ADMIN: 1,
  TRAVELSSURRENDER_ID: null,
  FINALPRICE_ID: 10,
  FINALPRICE: 100,
  ...over
});

describe('evaluateDriverAssigned', () => {
  it('passes with DB and detail matching, notes when detail is silent', () => {
    assert.equal(
      evaluateDriverAssigned({ expectedDriverId: 4965, detailDriverId: 4965, core: core() }).ok,
      true
    );
    const silent = evaluateDriverAssigned({
      expectedDriverId: 4965,
      detailDriverId: null,
      core: core()
    });
    assert.equal(silent.ok, true);
    assert.equal(silent.notes.length, 1);
  });
  it('fails on DB driver, detail driver or missing TRAVEL row', () => {
    assert.equal(
      evaluateDriverAssigned({
        expectedDriverId: 4965,
        detailDriverId: 4965,
        core: core({ DRIVER_ID: 1 })
      }).ok,
      false
    );
    assert.equal(
      evaluateDriverAssigned({ expectedDriverId: 4965, detailDriverId: 7, core: core() }).ok,
      false
    );
    assert.equal(
      evaluateDriverAssigned({
        expectedDriverId: 4965,
        detailDriverId: 4965,
        core: core({ hasTravelRow: false })
      }).ok,
      false
    );
  });
});

describe('evaluateNotInBatch', () => {
  it('passes on an empty batch', () => {
    assert.equal(evaluateNotInBatch({ previewIds: [], summary: 0 }, 1).ok, true);
  });
  it('fails when the open trip or any row shows up', () => {
    assert.equal(evaluateNotInBatch({ previewIds: [1], summary: 0 }, 1).ok, false);
    assert.equal(evaluateNotInBatch({ previewIds: [2], summary: 0 }, 1).ok, false);
    assert.equal(evaluateNotInBatch({ previewIds: [], summary: 1 }, 1).ok, false);
  });
});

describe('DB trip state', () => {
  it('cancelled: STATE 7; no charge: no FINALPRICEI or 0', () => {
    assert.equal(evaluateDbCancelled(core({ STATE: 7 })).ok, true);
    assert.equal(evaluateDbCancelled(core({ STATE: 6 })).ok, false);
    assert.equal(evaluateDbCancelled(core({ hasTravelRow: false, STATE: null })).ok, true);
    assert.equal(evaluateDbNoCharge(core({ FINALPRICE_ID: null, FINALPRICE: null })).ok, true);
    assert.equal(evaluateDbNoCharge(core({ FINALPRICE: 0 })).ok, true);
    assert.equal(evaluateDbNoCharge(core({ FINALPRICE: 5 })).ok, false);
  });
  it('closed by admin needs TRAVEL row, STATE 6, FINALIZE_ADMIN 1', () => {
    assert.equal(evaluateDbClosedByAdmin(core()).ok, true);
    assert.equal(evaluateDbClosedByAdmin(core({ FINALIZE_ADMIN: 0 })).ok, false);
    assert.equal(evaluateDbClosedByAdmin(core({ STATE: 7 })).ok, false);
    assert.equal(evaluateDbClosedByAdmin(core({ hasTravelRow: false })).ok, false);
  });
  it('not surrendered: no TRAVELSSURRENDER_ID and SURRENDERED 0', () => {
    assert.equal(evaluateDbNotSurrendered(core({ STATE: 7 })).ok, true);
    assert.equal(evaluateDbNotSurrendered(core({ TRAVELSSURRENDER_ID: 9 })).ok, false);
    assert.equal(evaluateDbNotSurrendered(core({ SURRENDERED: 1 })).ok, false);
  });
});

describe('splitSaleCostMismatches', () => {
  it('routes FINAL* rules to the total verdict', () => {
    const r = splitSaleCostMismatches({
      ok: false,
      travelId: 1,
      source: 'TRAVEL',
      notes: [],
      mismatches: [
        { field: 'FINALPRICEI.FINAL_COST_PRICE vs partes', expected: 1, actual: 2 },
        { field: 'PRICEADDITIONAL.WAITTIMEPRICE vs WAIT_TOTAL_PRICE_COST', expected: 1, actual: 2 }
      ]
    });
    assert.equal(r.total.mismatches.length, 1);
    assert.equal(r.pairs.mismatches.length, 1);
  });
});

describe('evaluateAppRecalc', () => {
  it('accepts a final different from the quote and reports it', () => {
    const r = evaluateAppRecalc({ quote: 100, apiFinal: 112.5, dbFinal: 112.5, dbKm: 14.2 });
    assert.equal(r.ok, true);
    assert.equal(r.differsFromQuote, true);
    assert.equal(r.delta, 12.5);
  });
  it('fails on API != DB, non-positive final or missing KM', () => {
    assert.equal(evaluateAppRecalc({ quote: 100, apiFinal: 112, dbFinal: 100, dbKm: 1 }).ok, false);
    assert.equal(evaluateAppRecalc({ quote: 100, apiFinal: 0, dbFinal: 0, dbKm: 1 }).ok, false);
    assert.equal(
      evaluateAppRecalc({ quote: 100, apiFinal: 100, dbFinal: 100, dbKm: null }).ok,
      false
    );
  });
});

describe('evaluatePaymentColumn', () => {
  it('cash must be Cash and CC must be informed and not Cash', () => {
    assert.equal(evaluatePaymentColumn('Cash', 'cash').ok, true);
    assert.equal(evaluatePaymentColumn('Credit Account', 'cash').ok, false);
    assert.equal(evaluatePaymentColumn('Credit Account', 'cc').ok, true);
    assert.equal(evaluatePaymentColumn('Cash', 'cc').ok, false);
    assert.equal(evaluatePaymentColumn(null, 'cc').ok, false);
  });
});

describe('evaluateCommissionPreview', () => {
  it('judges only exposed fields against the official base', () => {
    const r = evaluateCommissionPreview(
      { ownerCommissionAmount: 40, driverCommissionAmount: 40, agencyCommissionAmount: null },
      100
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.notExposed, ['agencyCommissionAmount']);
  });
  it('fails on the alternative base and flags it', () => {
    const r = evaluateCommissionPreview(
      { ownerCommissionAmount: 36, driverCommissionAmount: 40 },
      100,
      90
    );
    assert.equal(r.ok, false);
    assert.deepEqual(r.altMatches, ['ownerCommissionAmount']);
  });
});

describe('evaluateBookCodes', () => {
  it('cash: driver CASH_COMMISSION + CASH_PAYMENT_COMM, owner TDDV', () => {
    assert.equal(
      evaluateBookCodes('cash', ['CASH_COMMISSION', 'CASH_PAYMENT_COMM'], ['TDDV']).ok,
      true
    );
    assert.equal(evaluateBookCodes('cash', ['CASH_COMMISSION'], ['TDDV']).ok, false);
    assert.equal(
      evaluateBookCodes(
        'cash',
        ['CASH_COMMISSION', 'CASH_PAYMENT_COMM', 'CHECKING_ACCOUNT_COMM'],
        ['TDDV']
      ).ok,
      false
    );
    assert.equal(
      evaluateBookCodes('cash', ['CASH_COMMISSION', 'CASH_PAYMENT_COMM'], ['TDCV']).ok,
      false
    );
  });
  it('cc: driver CHECKING_ACCOUNT_COMM (CASH_PAYMENT_COMM tolerated)', () => {
    assert.equal(
      evaluateBookCodes('cc', ['CHECKING_ACCOUNT_COMM', 'CASH_PAYMENT_COMM'], ['TDDV']).ok,
      true
    );
    assert.equal(evaluateBookCodes('cc', ['CASH_COMMISSION'], ['TDDV']).ok, false);
  });
});

describe('evaluateBalanceDelta', () => {
  const rows = [
    { debit: 40, credit: 0 },
    { debit: 0, credit: 10 }
  ];
  it('matches the absolute net of the new rows in either sign', () => {
    const plus = evaluateBalanceDelta(rows, 30);
    assert.equal(plus.ok, true);
    assert.equal(plus.sign, 'same-as-net');
    const minus = evaluateBalanceDelta(rows, -30);
    assert.equal(minus.ok, true);
    assert.equal(minus.sign, 'opposite-to-net');
  });
  it('fails on a different magnitude or missing balance; net 0 needs delta 0', () => {
    assert.equal(evaluateBalanceDelta(rows, 40).ok, false);
    assert.equal(evaluateBalanceDelta(rows, null).ok, false);
    assert.equal(evaluateBalanceDelta([{ debit: 5, credit: 5 }], 0).ok, true);
    assert.equal(evaluateBalanceDelta([{ debit: 5, credit: 5 }], 5).ok, false);
  });
});

describe('evaluateClientCcBalance', () => {
  const mv = (key: string, travelId: number | null, debit: number, credit = 0): CcMovement => ({
    key,
    travelId,
    concept: 'c',
    debit,
    credit
  });

  it('per-trip: no noise', () => {
    const v = evaluateClientCcBalance({
      travelId: 7,
      debit: 100,
      added: [mv('a', 7, 100)],
      balanceDeltaDb: -100
    });
    assert.equal(v.ok, true);
    assert.equal(v.foreign.length, 0);
  });

  it('per-trip: one foreign movement is ok and reported', () => {
    const v = evaluateClientCcBalance({
      travelId: 7,
      debit: 100,
      added: [mv('a', 7, 100), mv('b', 9, 40)],
      balanceDeltaDb: -140
    });
    assert.equal(v.ok, true);
    assert.equal(v.foreign.length, 1);
    assert.equal(v.own.length, 1);
  });

  it('per-trip: duplicated TIVR is a mismatch', () => {
    const v = evaluateClientCcBalance({
      travelId: 7,
      debit: 100,
      added: [mv('a', 7, 100), mv('b', 7, 100)],
      balanceDeltaDb: -200
    });
    assert.equal(v.ok, false);
  });

  it('per-trip: balance not matching the sum of new movements is a mismatch', () => {
    const v = evaluateClientCcBalance({
      travelId: 7,
      debit: 100,
      added: [mv('a', 7, 100), mv('b', 9, 40)],
      balanceDeltaDb: -100
    });
    assert.equal(v.ok, false);
  });
});

describe('readBatchStateUntilEmpty', () => {
  const batch = { driverUserId: 1, vehicleId: 2 } as unknown as SurrenderBatch;
  const fake = (rowsByCall: number[][]): SurrenderClient => {
    let i = 0;
    return {
      preview: async () => ({
        rows: (rowsByCall[Math.min(i++, rowsByCall.length - 1)] ?? []).map((travelId) => ({
          travelId
        }))
      }),
      pendingSummary: async () => []
    } as unknown as SurrenderClient;
  };

  it('settles once the trip leaves the batch', async () => {
    const r = await readBatchStateUntilEmpty(fake([[5], []]), batch, 5, 5_000);
    assert.equal(r.settled, true);
    assert.equal(r.value.stillPending, false);
    assert.equal(r.attempts, 2);
  });

  it('returns settled=false (no throw) while the trip stays pending', async () => {
    const r = await readBatchStateUntilEmpty(fake([[5]]), batch, 5, 50);
    assert.equal(r.settled, false);
    assert.equal(r.value.stillPending, true);
  });
});

describe('manual surrender row', () => {
  const row = (over: Partial<SurrenderRow>): SurrenderRow =>
    ({
      CASHCOMMISSION: 40,
      CHECKINGACCOUNTCOMMISSION: null,
      CREDITCARDCOMMISSION: null,
      COMMISSIONSUM: 40,
      OWNER_TOTALCOMMISSION: 40,
      AGENCY_TOTALCOMMISSION: 20,
      TOTALOTHERCOST: null,
      TOTALOTHERCOST_NOCOM: null,
      TOTALCASH: 100,
      TOTALCASHQTY: 1,
      TOTALCHECKINGACCOUNT: null,
      TOTALCHECKACCQTY: null,
      TOTALCREDITCARD: null,
      TOTALCREDCARDQTY: null,
      TOTALBILLING: null,
      OWNER_FIXED_COMM: null,
      TOTAL_COLLECTED: null,
      NETPAID: null,
      ...over
    }) as SurrenderRow;
  it('cash base 100: 40/20 commissions and TOTALCASH, NULL unused methods count as 0', () => {
    const expected = expectedManualSurrender('cash', 100);
    assert.equal(expected.CASHCOMMISSION, 40);
    assert.equal(expected.AGENCY_TOTALCOMMISSION, 20);
    const v = evaluateSurrenderRow(nullAsZeroWhereExpectedZero(row({}), expected), expected);
    assert.equal(v.ok, true, JSON.stringify(v.mismatches));
  });
  it('cc base 100 expects CHECKINGACCOUNTCOMMISSION and TOTALCHECKINGACCOUNT', () => {
    const expected = expectedManualSurrender('cc', 100);
    assert.equal(expected.CHECKINGACCOUNTCOMMISSION, 40);
    assert.equal(expected.TOTALCASH, 0);
    const ok = row({
      CASHCOMMISSION: 0,
      CHECKINGACCOUNTCOMMISSION: 40,
      TOTALCASH: 0,
      TOTALCASHQTY: 0,
      TOTALCHECKINGACCOUNT: 100,
      TOTALCHECKACCQTY: 1
    });
    assert.equal(
      evaluateSurrenderRow(nullAsZeroWhereExpectedZero(ok, expected), expected).ok,
      true
    );
    assert.equal(
      evaluateSurrenderRow(nullAsZeroWhereExpectedZero(row({}), expected), expected).ok,
      false
    );
  });
});

describe('evaluateNoAgencyBookRow', () => {
  it('fails when a new row carries the agency amount', () => {
    const rows = [
      { amount: 40, paid: 0, code: 'TDDV' },
      { amount: 0, paid: 20, code: 'TDCV' }
    ];
    assert.equal(evaluateNoAgencyBookRow(rows, 20, [40, 40]).ok, false);
    assert.equal(evaluateNoAgencyBookRow(rows.slice(0, 1), 20, [40, 40]).ok, true);
  });
  it('does not judge when the agency amount equals another commission', () => {
    assert.equal(evaluateNoAgencyBookRow([{ amount: 40 }], 40, [40]).ok, true);
  });
});

describe('evaluateNoDuplicatedRows', () => {
  const r = (code: string, amount: number, origin = 7) => ({
    checkingAccountCode: code,
    amount,
    paid: 0,
    origin
  });
  it('passes when only adjustment rows are added', () => {
    const before = [r('TDDV', 40)];
    const after = [r('TDDV', 40), r('TDEA', 4)];
    assert.equal(evaluateNoDuplicatedRows(before, after, 7).ok, true);
  });
  it('fails when an existing row is repeated, and when the surrender id is unknown', () => {
    const before = [r('TDDV', 40)];
    const dup = evaluateNoDuplicatedRows(before, [r('TDDV', 40), r('TDDV', 40)], 7);
    assert.equal(dup.ok, false);
    assert.equal(dup.duplicated.length, 1);
    assert.equal(evaluateNoDuplicatedRows(before, before, null).ok, false);
  });
});

describe('evaluateSurrenderEditDeltas', () => {
  const base = (over: Partial<SurrenderRow>): SurrenderRow =>
    ({
      CASHCOMMISSION: null,
      CHECKINGACCOUNTCOMMISSION: 40,
      CREDITCARDCOMMISSION: null,
      COMMISSIONSUM: 40,
      OWNER_TOTALCOMMISSION: 40,
      AGENCY_TOTALCOMMISSION: 20,
      TOTALOTHERCOST: 10,
      TOTALOTHERCOST_NOCOM: null,
      TOTALCASH: null,
      TOTALCASHQTY: null,
      TOTALCHECKINGACCOUNT: 100,
      TOTALCHECKACCQTY: 1,
      TOTALCREDITCARD: null,
      TOTALCREDCARDQTY: null,
      TOTALBILLING: 100,
      OWNER_FIXED_COMM: null,
      TOTAL_COLLECTED: null,
      NETPAID: null,
      ...over
    }) as SurrenderRow;
  it('CC fare +10: commissions move 4/4/2 and TOTALCHECKINGACCOUNT +10', () => {
    const diffs = editDiffs(
      { fare: 90, otherCom: 10, total: 100 },
      { fare: 100, otherCom: 10, total: 110 }
    );
    assert.equal(diffs.fare, 10);
    const after = base({
      CHECKINGACCOUNTCOMMISSION: 44,
      COMMISSIONSUM: 44,
      OWNER_TOTALCOMMISSION: 44,
      AGENCY_TOTALCOMMISSION: 22,
      TOTALCHECKINGACCOUNT: 110,
      TOTALBILLING: 110
    });
    const v = evaluateSurrenderEditDeltas('cc', base({}), after, diffs);
    assert.equal(v.ok, true, JSON.stringify(v.mismatches));
  });
  it('fails when a column does not move as expected', () => {
    const diffs = editDiffs({ fare: 90, total: 100 }, { fare: 100, total: 110 });
    const v = evaluateSurrenderEditDeltas('cc', base({}), base({}), diffs);
    assert.equal(v.ok, false);
  });
});
