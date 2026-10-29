import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EditDiffs } from './edit-matrix.js';
import {
  classifyDownload,
  classifyReportHttp,
  closedGridScope,
  evaluateAgingTotals,
  evaluateBookRows,
  evaluateCcRewrite,
  evaluateClosedOmission,
  evaluateDownloads,
  evaluateEditedCostEqualsSale,
  evaluateFieldDelta,
  evaluateFinalizeRejected,
  evaluateNoRepeatedBookRows,
  evaluateSingleTivr,
  evaluateSurrenderDeltas,
  evaluateTripsInReport,
  isTripListMinutesKnownIssue,
  splitKnownOutliers
} from './fr-ac-eval-edit-reports.js';

const zero: EditDiffs = {
  fare: 0,
  wait: 0,
  otherCom: 0,
  otherNoCom: 0,
  toll: 0,
  parking: 0,
  total: 0
};

describe('EDM evaluators', () => {
  it('evaluateFieldDelta: tarifa +10 exacta pasa; colateral y total se registran', () => {
    const ok = evaluateFieldDelta('fare', 10, { ...zero, fare: 10, total: 10 });
    assert.equal(ok.ok, true);
    const col = evaluateFieldDelta('fare', 10, { ...zero, fare: 10, otherCom: 1, total: 11 });
    assert.equal(col.ok, true);
    assert.deepEqual(col.collaterals, { otherCom: 1 });
    const bad = evaluateFieldDelta('fare', 10, { ...zero, fare: 9, total: 9 });
    assert.equal(bad.ok, false);
    const wrongSign = evaluateFieldDelta('fare', 10, { ...zero, fare: 10, total: -10 });
    assert.equal(wrongSign.ok, false);
  });

  it('evaluateSurrenderDeltas: filtra columnas, falla sin DB o con delta distinto', () => {
    const exp = { TOTALBILLING: 10, CASHCOMMISSION: 4 };
    assert.equal(
      evaluateSurrenderDeltas(exp, { TOTALBILLING: 10, CASHCOMMISSION: 0 }, ['TOTALBILLING'], 'x')
        .ok,
      true
    );
    assert.equal(
      evaluateSurrenderDeltas(exp, { TOTALBILLING: 10, CASHCOMMISSION: 0 }, null, 'x').ok,
      false
    );
    assert.equal(evaluateSurrenderDeltas(exp, null, null, 'x').ok, false);
  });

  it('evaluateBookRows: cantidad y fila esperada', () => {
    const rows = [{ id: 1, amount: 4, checkingAccountCode: 'TCEA' }];
    assert.equal(
      evaluateBookRows('chofer', rows, [{ code: 'TCEA', amount: 4, note: 'n' }]).ok,
      true
    );
    assert.equal(
      evaluateBookRows('chofer', rows, [{ code: 'TDEA', amount: 4, note: 'n' }]).ok,
      false
    );
    assert.equal(
      evaluateBookRows('chofer', [], [{ code: 'TCEA', amount: 4, note: 'n' }]).ok,
      false
    );
  });

  it('evaluateNoRepeatedBookRows: detecta fila nueva repetida', () => {
    const before = [{ id: 1, amount: 4, origin: 9, checkingAccountCode: 'TCEA' }];
    assert.equal(evaluateNoRepeatedBookRows('chofer', before, before).ok, true);
    const dup = [...before, { id: 2, amount: 4, origin: 9, checkingAccountCode: 'TCEA' }];
    assert.equal(evaluateNoRepeatedBookRows('chofer', before, dup).ok, false);
    const dupNew = [
      ...before,
      { id: 2, amount: 5, origin: 9, checkingAccountCode: 'TCEA' },
      { id: 3, amount: 5, origin: 9, checkingAccountCode: 'TCEA' }
    ];
    assert.equal(evaluateNoRepeatedBookRows('chofer', before, dupNew).ok, false);
  });

  it('evaluateCcRewrite y evaluateSingleTivr', () => {
    const b = [{ debit: 54, credit: 0 }];
    assert.equal(
      evaluateCcRewrite({
        before: b,
        after: [{ debit: 64, credit: 0 }],
        expectedDelta: 10,
        finalTotal: 64
      }).ok,
      true
    );
    assert.equal(
      evaluateCcRewrite({ before: b, after: [...b, ...b], expectedDelta: 0, finalTotal: 54 }).ok,
      false
    );
    assert.equal(evaluateSingleTivr([{ conceptCode: 'TIVR' }]).ok, true);
    assert.equal(evaluateSingleTivr([]).ok, false);
  });

  it('evaluateEditedCostEqualsSale es estricto con costo ausente y admite pass-through', () => {
    assert.equal(
      evaluateEditedCostEqualsSale({ total: 64, totalCost: 64, passThrough: 0 }).ok,
      true
    );
    assert.equal(
      evaluateEditedCostEqualsSale({ total: 64, totalCost: null, passThrough: 0 }).ok,
      false
    );
    assert.equal(
      evaluateEditedCostEqualsSale({ total: 59, totalCost: 54, passThrough: 5 }).ok,
      true
    );
  });

  it('evaluateFinalizeRejected', () => {
    const same = { state: 'DONE', amount: 54 };
    assert.equal(
      evaluateFinalizeRejected({
        outcome: { accepted: false, status: 400, message: 'TRAVEL_SURRENDERED' },
        before: same,
        after: same
      }).ok,
      true
    );
    assert.equal(
      evaluateFinalizeRejected({
        outcome: { accepted: false, status: 400, message: 'ACTION_NOT_ALLOWED' },
        before: same,
        after: same
      }).ok,
      true
    );
    assert.equal(
      evaluateFinalizeRejected({ outcome: { accepted: true }, before: same, after: same }).ok,
      false
    );
    assert.equal(
      evaluateFinalizeRejected({
        outcome: { accepted: false, status: 400, message: 'otro' },
        before: same,
        after: same
      }).ok,
      false
    );
    assert.equal(
      evaluateFinalizeRejected({
        outcome: { accepted: false, status: 409, message: 'TRAVEL_SURRENDERED' },
        before: same,
        after: { state: 'DONE', amount: 55 }
      }).ok,
      false
    );
  });
});

describe('RPT evaluators', () => {
  it('closedGridScope separa automaticas omitidas de omisiones con chofer', () => {
    const db = [
      { ID: 1, DRIVER_ID: 4965 },
      { ID: 2, DRIVER_ID: null },
      { ID: 3, DRIVER_ID: null },
      { ID: 4, DRIVER_ID: 4965 }
    ];
    const r = closedGridScope(db, new Set([1, 3]));
    assert.deepEqual(
      r.scope.map((s) => s.ID),
      [1, 3, 4]
    );
    assert.deepEqual(
      r.omittedAutomatic.map((s) => s.ID),
      [2]
    );
    assert.deepEqual(
      r.omittedWithDriver.map((s) => s.ID),
      [4]
    );
    assert.equal(evaluateClosedOmission(r.omittedWithDriver).ok, false);
    assert.equal(evaluateClosedOmission([]).ok, true);
  });

  it('classifyDownload / evaluateDownloads respetan la firma exacta del KI', () => {
    const empty = {
      ok: true,
      kind: 'other' as const,
      bytes: 0,
      suggestedName: 'x.xml',
      httpErrors: []
    };
    const http500 = { ok: false, httpErrors: ['POST /a -> 500'] };
    const pdf = { ok: true, kind: 'pdf' as const, bytes: 5000, httpErrors: [] };
    assert.equal(classifyDownload(pdf, []), 'valid');
    assert.equal(classifyDownload(empty, ['ki-90']), 'ki-90-empty-xml');
    assert.equal(classifyDownload(empty, []), 'other');
    assert.equal(classifyDownload(http500, ['ki-91']), 'ki-91-http-500');
    assert.equal(
      classifyDownload({ ok: false, httpErrors: ['POST /a -> 404'] }, ['ki-91']),
      'other'
    );
    const v = evaluateDownloads([
      { key: 'a', file: empty, allow: ['ki-90'] },
      { key: 'b', file: pdf, allow: [] }
    ]);
    assert.equal(v.ok, true);
    assert.equal(v.tolerated.length, 1);
    assert.equal(evaluateDownloads([{ key: 'c', file: empty, allow: [] }]).ok, false);
  });

  it('classifyReportHttp', () => {
    assert.equal(classifyReportHttp({ status: 200, body: null }), 'ok');
    assert.equal(
      classifyReportHttp({
        status: 400,
        body: { errorCode: 'BAD_FILTER_NAME', description: 'Named parameter [CURRENCY_ID] not set' }
      }),
      'ki-92-currency-id'
    );
    assert.equal(classifyReportHttp({ status: 500, body: null }), 'other');
  });

  it('splitKnownOutliers y minutos del Trip List', () => {
    const d = (actual: number) => ({ report: 'r', key: 'k', field: 'f', expected: 0, actual });
    const r = splitKnownOutliers([d(11312004), d(-11312004), d(99999999)], 11312004);
    assert.equal(r.known.length, 2);
    assert.equal(r.unexpected.length, 1);
    assert.equal(isTripListMinutesKnownIssue('10', 12, 12), true);
    assert.equal(isTripListMinutesKnownIssue('35', 3, 12), false);
  });

  it('evaluateTripsInReport y evaluateAgingTotals', () => {
    assert.equal(
      evaluateTripsInReport([{ Col1: '71532' }, { Col1: '71533' }], [71532, 71533]).ok,
      true
    );
    assert.equal(evaluateTripsInReport([{ Col1: '71532' }], [71532, 71533]).ok, false);
    const grid = [
      { Col3: '-10', Col4: '10' },
      { Col3: '-5', Col4: '5' }
    ];
    assert.equal(evaluateAgingTotals(grid, [{ Col1: '-15', Col2: '15' }]).ok, false);
    const full = {
      Col1: '-15',
      Col2: '15',
      Col3: '0',
      Col4: '0',
      Col5: '0',
      Col6: '0',
      Col7: '0',
      Col8: '0'
    };
    assert.equal(evaluateAgingTotals(grid, [full]).ok, true);
  });
});
