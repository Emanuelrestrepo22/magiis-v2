import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearingNcObservation,
  clearingRows,
  driverReportRows,
  evaluateAnchoredRows,
  evaluateConfirmRow,
  evaluateDueBeforeConfirm,
  evaluateNoNaN,
  evaluateOwnerBook,
  evaluatePendingSet,
  evaluatePostAttempts,
  evaluateZeroFareCommissions,
  expectedConfirmation,
  expectedConfirmPost,
  parseConfirmTrips,
  withDeliver,
  type F5ConfirmRow
} from './f5-confirm-oracle.js';
import { evaluateSurrenderPost, expectedF5, type F5TripFacts } from './f5-surrender-oracle.js';

const facts = (f: Partial<F5TripFacts> & { travelId: number }): F5TripFacts => ({
  paymentMethod: 'CASH',
  finalPrice: 0,
  toll: 0,
  parking: 0,
  noCom: 0,
  taxes: 0,
  ...f
});

// Lote E (72154): efectivo 1000 + impuestos 100, sin NC. Par 5036/2565: 12 % agencia / 88 % propietario, fija 0 hoy.
const LOTE_E = expectedF5([facts({ travelId: 72154, finalPrice: 1000, taxes: 100 })]);
const PCT = { pctOwner: 0.88, pctDriver: 0, pctAgency: 0.12 };
// Lote A (14185): 72136 efectivo (final 1545, NC 450, imp. 100) + 72137 CC (1000, imp. 100).
const LOTE_A = expectedF5([
  facts({ travelId: 72136, finalPrice: 1545, noCom: 450, taxes: 100 }),
  facts({ travelId: 72137, paymentMethod: 'CHECKING_ACCOUNT', finalPrice: 1000, taxes: 100 })
]);

describe('parseConfirmTrips', () => {
  it('parsea y ordena', () => assert.deepEqual(parseConfirmTrips('72155, 72154'), [72154, 72155]));
  it('vacio, invalido o repetido lanzan', () => {
    assert.throws(() => parseConfirmTrips(undefined));
    assert.throws(() => parseConfirmTrips('abc'));
    assert.throws(() => parseConfirmTrips('1,1'));
  });
});

describe('evaluatePendingSet', () => {
  it('igual = ok', () => assert.equal(evaluatePendingSet([72154], [72154]).ok, true));
  it('viaje ajeno pendiente falla', () => {
    const v = evaluatePendingSet([72154, 99], [72154]);
    assert.equal(v.ok, false);
    assert.deepEqual(v.mismatches[0].actual, [99]);
  });
  it('viaje declarado no pendiente falla', () =>
    assert.equal(evaluatePendingSet([], [72154]).ok, false));
});

describe('expectedConfirmation lote E (14188-like, TM-1655 AR)', () => {
  const want = expectedConfirmation({
    expected: LOTE_E,
    inputs: { ...PCT, ownerFixed: 0, agencyFixed: 0 },
    ownerFinancialCost: 0
  });
  it('body: surrendered 1100 / agencyNetPaid 1100 / netPaid 0', () => {
    assert.equal(want.post.surrendered, 1100);
    assert.equal(want.post.agencyNetPaid, 1100);
    assert.equal(want.post.netPaid, 0);
  });
  it('comisiones 880 / 120 / 0 y libro TDDV 880 sin TDCF ni TDDG', () => {
    assert.equal(want.commissions.OWNER_TOTALCOMMISSION, 880);
    assert.equal(want.commissions.AGENCY_TOTALCOMMISSION, 120);
    assert.equal(want.commissions.COMMISSIONSUM, 0);
    assert.deepEqual(want.ownerBook, { tddv: 880, tdcf: 0, tddg: 0 });
  });
  it('fila DB esperada pasa y NULL en NETPAID falla', () => {
    const row: F5ConfirmRow = {
      SURRENDERED: 1100,
      AGENCY_NETPAID: 1100,
      NETPAID: 0,
      OWNER_NETPAID: 0,
      COMMISSIONSUM: 0,
      OWNER_TOTALCOMMISSION: 880,
      AGENCY_TOTALCOMMISSION: 120,
      AGENCY_FIXED_COMM: 0,
      OWNER_FIXED_COMM: 0,
      MISCELLANYAMOUNT: 0
    };
    assert.equal(evaluateConfirmRow(row, want).ok, true);
    assert.equal(evaluateConfirmRow({ ...row, NETPAID: null }, want).ok, false);
    assert.equal(evaluateConfirmRow({ ...row, OWNER_TOTALCOMMISSION: 879.99 }, want).ok, false);
  });
});

describe('expectedConfirmation 14185 / 14186 / 14187', () => {
  it('14185: TDDV = 1.843,60 - 88 = 1.755,60; agencia 251,40; body 1645', () => {
    const want = expectedConfirmation({
      expected: LOTE_A,
      inputs: { ...PCT, ownerFixed: 0, agencyFixed: 0 },
      ownerFinancialCost: 88
    });
    assert.equal(want.commissions.OWNER_TOTALCOMMISSION, 1843.6);
    assert.equal(want.commissions.AGENCY_TOTALCOMMISSION, 251.4);
    assert.equal(want.ownerBook.tddv, 1755.6);
    assert.equal(want.post.surrendered, 1645);
    assert.equal(want.post.agencyNetPaid, 1645);
  });
  it('14186: fija agencia 122 -> TDCF 122, agencia 242', () => {
    const want = expectedConfirmation({
      expected: LOTE_E,
      inputs: { ...PCT, ownerFixed: 0, agencyFixed: 122 },
      ownerFinancialCost: 0
    });
    assert.equal(want.commissions.AGENCY_TOTALCOMMISSION, 242);
    assert.equal(want.ownerBook.tdcf, 122);
  });
  it('14187: gasto varios 100 -> TDDG 100', () => {
    const want = expectedConfirmation({
      expected: LOTE_E,
      inputs: { ...PCT, ownerFixed: 0, agencyFixed: 0 },
      ownerFinancialCost: 0,
      miscellanyVoucher: 100
    });
    assert.equal(want.ownerBook.tddg, 100);
    assert.equal(want.post.agencyNetPaid, 1000);
  });
  it('fija del propietario > 0 lanza (sin oraculo validado)', () => {
    assert.throws(() =>
      expectedConfirmation({
        expected: LOTE_E,
        inputs: { ...PCT, ownerFixed: 30, agencyFixed: 0 },
        ownerFinancialCost: 0
      })
    );
  });
});

describe('evaluateOwnerBook (filas reales 14185-14187)', () => {
  const row = (code: string, debit: number, credit: number) => ({
    CHECKINGACCOUNTCODE: code,
    DEBIT: debit,
    CREDIT: credit
  });
  it('14186: TDCF credito 122 + TDDV debito 880', () => {
    const v = evaluateOwnerBook([row('TDCF', 0, 122), row('TDDV', 880, 0)], {
      tddv: 880,
      tdcf: 122,
      tddg: 0
    });
    assert.equal(v.ok, true);
  });
  it('TDDV con signo invertido falla', () => {
    assert.equal(
      evaluateOwnerBook([row('TDDV', 0, 880)], { tddv: 880, tdcf: 0, tddg: 0 }).ok,
      false
    );
  });
  it('TDCF inesperado con fija 0 falla; codigo desconocido solo se informa', () => {
    const v = evaluateOwnerBook([row('TDDV', 880, 0), row('TDCF', 0, 122), row('XXXX', 1, 0)], {
      tddv: 880,
      tdcf: 0,
      tddg: 0
    });
    assert.equal(v.ok, false);
    assert.deepEqual(v.otherCodes, ['XXXX']);
  });
});

describe('evaluatePostAttempts', () => {
  it('1 ok; 0 y 2 fallan', () => {
    assert.equal(evaluatePostAttempts(1).ok, true);
    assert.equal(evaluatePostAttempts(0).ok, false);
    assert.equal(evaluatePostAttempts(2).ok, false);
  });
});

describe('evaluateAnchoredRows (Clearing 14185 es-AR)', () => {
  const clearing = [
    'Clearing 1013            Fecha 15/11/2026',
    'Cash Trips        # 1    $ 1.095,00',
    'Credit Account    # 1    $ 1.000,00',
    'Other Cost NO Commission (Cash Trips)   $ 450,00',
    'Taxes                    $ 100,00',
    'TOTAL             # 2    $ 2.645,00',
    'Payment to Company       $ 1.645,00'
  ].join('\n');
  const post = expectedConfirmation({
    expected: LOTE_A,
    inputs: { ...PCT, ownerFixed: 0, agencyFixed: 0 },
    ownerFinancialCost: 88
  }).post;
  it('pasa con las filas reales', () =>
    assert.equal(evaluateAnchoredRows(clearing, clearingRows(LOTE_A, post)).ok, true));
  it('importe correcto en OTRA fila no cuenta: Cash Trips con 1.000,00 falla', () => {
    const bad = clearing.replace('$ 1.095,00', '$ 1.000,00');
    const v = evaluateAnchoredRows(bad, clearingRows(LOTE_A, post));
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field.includes('Cash Trips')));
  });
  it('rotulo ausente falla; importe en el renglon siguiente (corte de celda) pasa', () => {
    assert.equal(
      evaluateAnchoredRows('foo', [{ field: 'x', label: /^Taxes/, amount: 1 }]).ok,
      false
    );
    assert.equal(
      evaluateAnchoredRows('Taxes\n   $ 100,00', [{ field: 'x', label: /^Taxes/, amount: 100 }]).ok,
      true
    );
  });
  it('el rotulo «Cash Trips» no matchea la fila del NC', () => {
    const only = 'Other Cost NO Commission (Cash Trips)   $ 450,00';
    assert.equal(
      evaluateAnchoredRows(only, [{ field: 'x', label: /^\s*Cash Trips\b/i, amount: 450 }]).ok,
      false
    );
  });
});

describe('driverReportRows (Reporte Chofer 14185 en-US)', () => {
  it('pasa con 1,645.00 / 1,095.00 / 450.00 / 100.00', () => {
    const text = [
      'Total Cash          $ 1,645.00',
      'Cash Trips          $ 1,095.00',
      'Other Costs No Commissionable (Cash Trips)   $ 450.00',
      'Taxes               $ 100.00'
    ].join('\n');
    assert.equal(evaluateAnchoredRows(text, driverReportRows(LOTE_A)).ok, true);
    assert.equal(
      evaluateAnchoredRows(text.replace('1,645.00', '1,600.00'), driverReportRows(LOTE_A)).ok,
      false
    );
  });
});

// ───────────── W1: body del POST por regla con montos de los handoffs UAT del 10/11/2026 ─────────────

describe('expectedConfirmPost por regla (handoffs UAT 10/11 y TEST 14184)', () => {
  it('R01 AR #1: sin tocar campos, comisión chofer 0 -> surrendered 49.250 / agencyNetPaid 49.250', () => {
    const p = expectedConfirmPost({ cashToSurrender: 49250, driverCommission: 0 });
    assert.deepEqual(p, {
      surrendered: 49250,
      netPaid: 0,
      agencyNetPaid: 49250,
      ownerNetPaid: 0,
      fuelVoucher: 0,
      miscellanyVoucher: 0
    });
  });
  it('R01 FR-3 (2021): 241,60 con comisión de chofer 90,64 -> agencyNetPaid 150,96', () => {
    const p = expectedConfirmPost({ cashToSurrender: 241.6, driverCommission: 90.64 });
    assert.equal(p.surrendered, 241.6);
    assert.equal(p.agencyNetPaid, 150.96);
    assert.equal(p.netPaid, 0);
  });
  it('R01 US-1 (1481 P1): 22,58 con comisión 5,032 -> agencyNetPaid 17,55 (redondeo al centavo)', () => {
    const p = expectedConfirmPost({ cashToSurrender: 22.58, driverCommission: 5.032 });
    assert.equal(p.surrendered, 22.58);
    assert.equal(p.agencyNetPaid, 17.55);
  });
  it('R03 AR #2: entrega parcial 28.350 de 47.250 -> surrendered 47.250 / agencyNetPaid 28.350', () => {
    const p = expectedConfirmPost({
      cashToSurrender: 47250,
      driverCommission: 0,
      deliver: 28350
    });
    assert.equal(p.surrendered, 47250);
    assert.equal(p.agencyNetPaid, 28350);
    assert.equal(p.netPaid, 0);
  });
  it('R04 AR #3: gasto varios 100 y «$» -> surrendered 48.250 / agencyNetPaid 48.150 / misc 100', () => {
    const p = expectedConfirmPost({
      cashToSurrender: 48250,
      driverCommission: 0,
      miscellanyVoucher: 100
    });
    assert.equal(p.surrendered, 48250);
    assert.equal(p.agencyNetPaid, 48150);
    assert.equal(p.miscellanyVoucher, 100);
  });
  it('R05 AR #4: tarifa 0 con solo NC -> surrendered 7.000 / agencyNetPaid 7.000', () => {
    const p = expectedConfirmPost({ cashToSurrender: 7000, driverCommission: 0 });
    assert.equal(p.surrendered, 7000);
    assert.equal(p.agencyNetPaid, 7000);
  });
  it('R06 US (14184): EfR 2,35 < comisión 2,82 -> surrendered 0 / netPaid 0,47 / agencyNetPaid 0', () => {
    const p = expectedConfirmPost({ cashToSurrender: 2.35, driverCommission: 2.82 });
    assert.equal(p.surrendered, 0);
    assert.equal(p.netPaid, 0.47);
    assert.equal(p.agencyNetPaid, 0);
  });
  it('R06 ignora una entrega tecleada (no hay «Entregar» con saldo del chofer)', () => {
    const p = expectedConfirmPost({ cashToSurrender: 2.35, driverCommission: 2.82, deliver: 1 });
    assert.equal(p.netPaid, 0.47);
    assert.equal(p.agencyNetPaid, 0);
  });
  it('entrega 0 o mayor a lo adeudado (Q9) NO es contrato: lanza', () => {
    assert.throws(() =>
      expectedConfirmPost({ cashToSurrender: 47250, driverCommission: 0, deliver: 0 })
    );
    assert.throws(() =>
      expectedConfirmPost({ cashToSurrender: 47250, driverCommission: 0, deliver: 47250.01 })
    );
  });
  it('el body del POST de R03 pasa evaluateSurrenderPost y una entrega distinta falla', () => {
    const want = expectedConfirmPost({
      cashToSurrender: 47250,
      driverCommission: 0,
      deliver: 28350
    });
    const body = {
      fuelVoucher: { amount: 0 },
      miscellanyVoucher: { amount: 0 },
      netPaid: 0,
      surrendered: 47250,
      agencyNetPaid: 28350,
      ownerNetPaid: 0
    };
    assert.equal(evaluateSurrenderPost(body, want).ok, true);
    assert.equal(evaluateSurrenderPost({ ...body, agencyNetPaid: 7250 }, want).ok, false);
  });
});

describe('expectedConfirmation con entrega parcial / gastos (columnas DB)', () => {
  const base = {
    expected: LOTE_E,
    inputs: { ...PCT, ownerFixed: 0, agencyFixed: 0 },
    ownerFinancialCost: 0
  };
  it('deliver 660 sobre 1100: AGENCY_NETPAID 660 y SURRENDERED 1100 (la fila de DB lo exige)', () => {
    const want = expectedConfirmation({ ...base, deliver: 660 });
    assert.equal(want.post.agencyNetPaid, 660);
    assert.equal(want.post.surrendered, 1100);
    const row: F5ConfirmRow = {
      SURRENDERED: 1100,
      AGENCY_NETPAID: 660,
      NETPAID: 0,
      OWNER_NETPAID: 0,
      COMMISSIONSUM: 0,
      OWNER_TOTALCOMMISSION: 880,
      AGENCY_TOTALCOMMISSION: 120,
      AGENCY_FIXED_COMM: 0,
      OWNER_FIXED_COMM: 0,
      MISCELLANYAMOUNT: 0
    };
    assert.equal(evaluateConfirmRow(row, want).ok, true);
    assert.equal(evaluateConfirmRow({ ...row, AGENCY_NETPAID: 1100 }, want).ok, false);
  });
  it('withDeliver reutiliza el esperado y valida el rango; sin saldo de la empresa lanza', () => {
    const want = expectedConfirmation(base);
    assert.equal(withDeliver(want, 600).post.agencyNetPaid, 600);
    assert.equal(withDeliver(want, 600).commissions, want.commissions);
    assert.throws(() => withDeliver(want, 1100.01));
    const driverSide = {
      ...want,
      post: expectedConfirmPost({ cashToSurrender: 2.35, driverCommission: 2.82 })
    };
    assert.throws(() => withDeliver(driverSide, 1));
  });
  it('R04: gasto 100 y deliver implícito (todo): body 1000 y TDDG 100', () => {
    const want = expectedConfirmation({ ...base, miscellanyVoucher: 100 });
    assert.equal(want.post.agencyNetPaid, 1000);
    assert.equal(want.ownerBook.tddg, 100);
  });
});

describe('evaluateNoNaN (R05)', () => {
  it('texto numérico pasa; NaN, Infinity y undefined fallan', () => {
    assert.equal(evaluateNoNaN('pantalla', 'Total 7.000,00 Comisiones 0,00').ok, true);
    assert.equal(evaluateNoNaN('pantalla', 'Comisiones NaN').ok, false);
    assert.equal(evaluateNoNaN('PDF', 'Owner -Infinity %').ok, false);
    assert.equal(evaluateNoNaN('body', '{"a":undefined}').ok, false);
  });
});

describe('evaluateZeroFareCommissions (R05)', () => {
  const zero = { commissionSum: 0, agencyTotalCommission: 0, ownerTotalCommission: 0 };
  it('todo 0 pasa; una comisión > 0, NaN o ausente falla', () => {
    assert.equal(evaluateZeroFareCommissions(zero).ok, true);
    assert.equal(evaluateZeroFareCommissions({ ...zero, ownerTotalCommission: 0.01 }).ok, false);
    assert.equal(evaluateZeroFareCommissions({ ...zero, commissionSum: Number.NaN }).ok, false);
    assert.equal(evaluateZeroFareCommissions({ commissionSum: 0 }).ok, false);
  });
});

describe('evaluateDueBeforeConfirm (saldo previo al clic)', () => {
  it('R03: Due to Company 18.900 tras entregar 28.350 de 47.250', () => {
    assert.equal(
      evaluateDueBeforeConfirm(
        { kind: 'Company', amount: 18900 },
        { kind: 'Company', amount: 18900 }
      ).ok,
      true
    );
    assert.equal(
      evaluateDueBeforeConfirm(
        { kind: 'Driver', amount: 18900 },
        { kind: 'Company', amount: 18900 }
      ).ok,
      false
    );
  });
  it('R04: tras el gasto y antes de «$» el saldo es del chofer por 100; con 0 no se asevera el lado', () => {
    assert.equal(
      evaluateDueBeforeConfirm({ kind: 'Driver', amount: 100 }, { kind: 'Driver', amount: 100 }).ok,
      true
    );
    assert.equal(
      evaluateDueBeforeConfirm({ kind: 'Company', amount: 0 }, { kind: 'Driver', amount: 0 }).ok,
      true
    );
  });
  it('sin renglón (null) falla', () => {
    assert.equal(
      evaluateDueBeforeConfirm({ kind: null, amount: null }, { kind: 'Company', amount: 5 }).ok,
      false
    );
  });
});

describe('clearingNcObservation (Q2)', () => {
  it('NC > 0 no anota; NC = 0 anota presente/ausente', () => {
    assert.equal(clearingNcObservation('Other Cost NO Commission (Cash Trips) 15,00', 15), null);
    assert.match(
      clearingNcObservation('Other Cost NO Commission (Cash Trips)   0,00', 0) ?? '',
      /presente/
    );
    assert.match(clearingNcObservation('TOTAL 47.250,00', 0) ?? '', /ausente/);
  });
});

describe('Clearing de R03 con pago parcial (28.350 de 47.250)', () => {
  it('Payment to Company = lo entregado; Total = efectivo a rendir', () => {
    const expected = expectedF5([
      facts({ travelId: 723601, finalPrice: 47250 - 6000, taxes: 6000 })
    ]);
    const post = expectedConfirmPost({
      cashToSurrender: expected.cashToSurrender,
      driverCommission: 0,
      deliver: 28350
    });
    const text = [
      'Cash Trips     41.250,00',
      'Taxes          6.000,00',
      'TOTAL          47.250,00',
      'Payment to Company   28.350,00'
    ].join('\n');
    assert.equal(evaluateAnchoredRows(text, clearingRows(expected, post)).ok, true);
    assert.equal(
      evaluateAnchoredRows(text.replace('28.350,00', '47.250,00'), clearingRows(expected, post)).ok,
      false
    );
  });
});
