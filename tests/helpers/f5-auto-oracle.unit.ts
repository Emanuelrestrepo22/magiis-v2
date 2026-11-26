// tests/helpers/f5-auto-oracle.unit.ts
// Oraculo de la automatica con NC (F5 W3). Numeros reales de UAT FR 2021 del 10/11 (handoff fr-1 / fr-2):
// R18 viaje 723597 = 206,00 + NC 15,00 + city taxes 20,60 = 241,60; R19 viaje 723599 = 206,00 + 20,60 = 226,60.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bookCode,
  classifySurrendered,
  evaluateAutoOwnerBook,
  evaluateAutoRow,
  evaluateNoNewDriverBookRows,
  evaluateToSettleDelta,
  expectedF5Auto,
  factsFromExpected,
  newBookRows,
  parseAutoPct,
  resolveAutoCommission,
  ownerBookApiToRows,
  type F5AutoRowReading,
  type F5AutoTripFacts
} from './f5-auto-oracle.js';
import { expectedFromGet } from './f5-api-oracle.js';

const PCT = { owner: 0.4, driver: 0.4, agency: 0.2 } as const;
const NO_FIXED = { owner: 0, agency: 0 } as const;
const opts = { pct: PCT, fixed: NO_FIXED };

const r18: F5AutoTripFacts = {
  travelId: 723597,
  paymentMethod: 'CASH',
  finalPrice: 241.6,
  toll: 0,
  parking: 0,
  noCom: 15,
  taxes: 0,
  cityTax: 20.6
};
const r19: F5AutoTripFacts = { ...r18, travelId: 723599, finalPrice: 226.6, noCom: 0 };

const rowOf = (over: Partial<F5AutoRowReading> = {}): F5AutoRowReading => ({
  DRIVER_ID: null,
  VEHICLEOWNERID: 4289,
  VEHICLE_ID: 5356,
  COLLECTEDPAYEE: 'OWNER',
  TOTALCASH: 226.6,
  TOTALCASHOTHERCOST_NOCOM: 15,
  TOTALCASHOTHERCOSTQTY_NOCOM: 1,
  TOTALOTHERCOST_NOCOM: 0,
  TOTALCASHOTHERCOST: 20.6,
  TOTALCASHTOSURRENDER: 241.6,
  COMMISSIONSUM: 90.64,
  OWNER_TOTALCOMMISSION: 90.64,
  AGENCY_TOTALCOMMISSION: 45.32,
  AGENCY_NETPAID: 0,
  ...over
});
const identity = { ownerId: 4289, vehicleId: 5356 };

describe('expectedF5Auto · R18 con NC (UAT FR 10/11)', () => {
  const e = expectedF5Auto([r18], opts);
  it('TOTALCASH sin NC y efectivo a rendir con NC', () => {
    assert.equal(e.scenario, 'R18-nc');
    assert.equal(e.row.TOTALCASH, 226.6);
    assert.equal(e.row.TOTALCASHOTHERCOST_NOCOM, 15);
    assert.equal(e.row.TOTALCASHOTHERCOSTQTY_NOCOM, 1);
    assert.equal(e.row.TOTALCASHTOSURRENDER, 241.6);
    assert.equal(e.row.TOTALCASHOTHERCOST, 20.6);
  });
  it('comisiones sobre la base SIN NC; agencia no cobra neto', () => {
    assert.equal(e.row.COMMISSIONSUM, 90.64);
    assert.equal(e.row.OWNER_TOTALCOMMISSION, 90.64);
    assert.equal(e.row.AGENCY_TOTALCOMMISSION, 45.32);
    assert.equal(e.row.AGENCY_NETPAID, 0);
  });
  it('libro del propietario: TDCV = agencia, TDOC = NC; To Settle sube owner + chofer (181,28)', () => {
    assert.deepEqual(e.ownerBook, { tdcvCredit: 45.32, tdocCredit: 15 });
    assert.equal(e.ownerToSettleDelta, 181.28);
  });
  it('SURRENDERED: esperado TOTALCASH 226,60; alternativa C2 con NC 241,60', () => {
    assert.deepEqual(e.surrendered, { base: 226.6, withNc: 241.6 });
  });
});

describe('expectedF5Auto · R19 sin NC (UAT FR 10/11)', () => {
  const e = expectedF5Auto([r19], opts);
  it('sin NC: NOCOM 0 (no NULL), mismo efectivo y mismas comisiones', () => {
    assert.equal(e.scenario, 'R19-sin-nc');
    assert.equal(e.row.TOTALCASHOTHERCOST_NOCOM, 0);
    assert.equal(e.row.TOTALCASHOTHERCOSTQTY_NOCOM, 0);
    assert.equal(e.row.TOTALCASH, 226.6);
    assert.equal(e.row.TOTALCASHTOSURRENDER, 226.6);
    assert.equal(e.row.COMMISSIONSUM, 90.64);
    assert.equal(e.ownerToSettleDelta, 181.28);
  });
  it('sin TDOC y sin alternativa C2', () => {
    assert.equal(e.ownerBook.tdocCredit, 0);
    assert.equal(e.surrendered.withNc, null);
  });
});

describe('expectedF5Auto · parametros', () => {
  it('pct del par: 30/50/20 cambia comisiones y no el efectivo', () => {
    const e = expectedF5Auto([r18], {
      pct: { owner: 0.5, driver: 0.3, agency: 0.2 },
      fixed: NO_FIXED
    });
    assert.equal(e.row.OWNER_TOTALCOMMISSION, 113.3);
    assert.equal(e.row.COMMISSIONSUM, 67.98);
    assert.equal(e.row.TOTALCASH, 226.6);
    assert.equal(e.ownerToSettleDelta, 181.28);
  });
  it('H-04: peaje/estacionamiento cambia TOTALCASH segun la definicion y deja observacion', () => {
    const withToll: F5AutoTripFacts = { ...r18, toll: 10, parking: 5 };
    const inc = expectedF5Auto([withToll], { ...opts, totalCashDefinition: 'includeTollParking' });
    const exc = expectedF5Auto([withToll], { ...opts, totalCashDefinition: 'excludeTollParking' });
    assert.equal(inc.row.TOTALCASH, 226.6);
    assert.equal(exc.row.TOTALCASH, 211.6);
    // La base de comision resta peaje/estacionamiento en ambas: 0,4 × 211,60.
    assert.equal(inc.row.COMMISSIONSUM, 84.64);
    assert.equal(exc.row.COMMISSIONSUM, 84.64);
    assert.ok(inc.observations.some((o) => /H-04/.test(o)));
  });
  it('sin city tax declarado no se asevera TOTALCASHOTHERCOST', () => {
    const { cityTax: _omit, ...noTax } = r18;
    void _omit;
    assert.equal(expectedF5Auto([noTax], opts).row.TOTALCASHOTHERCOST, null);
  });
  it('tarjeta de credito lanza; lote vacio lanza', () => {
    assert.throws(
      () => expectedF5Auto([{ ...r18, paymentMethod: 'CREDIT_CARD' }], opts),
      /tarjeta/
    );
    assert.throws(() => expectedF5Auto([], opts), /sin viajes/);
  });
});

describe('factsFromExpected (UAT sin DB)', () => {
  it('reconstruye R18 desde el GET del 10/11 (totalCash 226,6 · NC 15) y reproduce el oraculo', () => {
    const e = expectedFromGet({
      totalCash: { amount: 226.6, quantity: 1 },
      totalCheckingAccount: { amount: 0, quantity: 0 },
      totalCreditCard: { amount: 0, quantity: 0 },
      totalCashOtherCostNoCommissionable: { amount: 15, quantity: 1 }
    });
    const auto = expectedF5Auto(factsFromExpected(e), opts);
    assert.equal(auto.row.TOTALCASHTOSURRENDER, 241.6);
    assert.equal(auto.row.OWNER_TOTALCOMMISSION, 90.64);
    assert.equal(auto.ownerBook.tdocCredit, 15);
  });
});

describe('evaluateAutoRow', () => {
  const e = expectedF5Auto([r18], opts);
  it('la fila del 10/11 cumple', () => {
    assert.equal(evaluateAutoRow(rowOf(), e, identity).ok, true);
  });
  it('rendicion con chofer, otro propietario o NOCOM NULL fallan por campo', () => {
    const v = evaluateAutoRow(
      rowOf({ DRIVER_ID: 6440, VEHICLEOWNERID: 1, TOTALCASHOTHERCOST_NOCOM: null }),
      e,
      identity
    );
    assert.equal(v.ok, false);
    const fields = v.mismatches.map((m) => m.field).join('|');
    assert.match(fields, /DRIVER_ID/);
    assert.match(fields, /VEHICLEOWNERID/);
    assert.match(fields, /TOTALCASHOTHERCOST_NOCOM/);
  });
  it('comision con NC dentro de la base (error clasico) falla', () => {
    const v = evaluateAutoRow(rowOf({ OWNER_TOTALCOMMISSION: 96.64 }), e, identity);
    assert.equal(v.ok, false);
    assert.equal(v.mismatches[0].field, 'TRAVELSSURRENDER.OWNER_TOTALCOMMISSION');
  });
  it('AGENCY_NETPAID distinto de 0 falla (H-AUTO-03)', () => {
    assert.equal(evaluateAutoRow(rowOf({ AGENCY_NETPAID: 45.32 }), e, identity).ok, false);
  });
  it('TOTALCASHOTHERCOST no declarado (null esperado) no se asevera', () => {
    const { cityTax: _omit, ...noTax } = r18;
    void _omit;
    const e2 = expectedF5Auto([noTax], opts);
    assert.equal(evaluateAutoRow(rowOf({ TOTALCASHOTHERCOST: 999 }), e2, identity).ok, true);
  });
});

describe('classifySurrendered (C2)', () => {
  const e = expectedF5Auto([r18], opts);
  it('= TOTALCASH es esperado', () => {
    assert.equal(classifySurrendered(226.6, e.surrendered).kind, 'esperado');
  });
  it('= TOTALCASH + NC (241,60) es la observacion C2, no falla', () => {
    const c = classifySurrendered(241.6, e.surrendered);
    assert.equal(c.kind, 'incluye-nc-c2');
    assert.match(c.observation ?? '', /C2/);
  });
  it('cualquier otro valor o NULL es distinto; sin NC 241,60 no es C2', () => {
    assert.equal(classifySurrendered(100, e.surrendered).kind, 'distinto');
    assert.equal(classifySurrendered(null, e.surrendered).kind, 'distinto');
    const none = expectedF5Auto([r19], opts);
    assert.equal(classifySurrendered(241.6, none.surrendered).kind, 'distinto');
  });
});

describe('libro del propietario', () => {
  const r18e = expectedF5Auto([r18], opts);
  const r19e = expectedF5Auto([r19], opts);
  const tdcv = { CHECKINGACCOUNTCODE: 'TDCV', DEBIT: null, CREDIT: 45.32 };
  const tdoc = { CHECKINGACCOUNTCODE: 'TDOC', DEBIT: null, CREDIT: 15 };
  it('R18: TDCV credito 45,32 + TDOC 15 cumple', () => {
    assert.equal(evaluateAutoOwnerBook([tdcv, tdoc], r18e).ok, true);
  });
  it('R18 sin TDOC falla; TDCV como debito falla (es credito)', () => {
    assert.equal(evaluateAutoOwnerBook([tdcv], r18e).ok, false);
    const asDebit = { CHECKINGACCOUNTCODE: 'TDCV', DEBIT: 45.32, CREDIT: null };
    assert.equal(evaluateAutoOwnerBook([asDebit, tdoc], r18e).ok, false);
  });
  it('R19: solo TDCV cumple; con TDOC falla', () => {
    assert.equal(evaluateAutoOwnerBook([tdcv], r19e).ok, true);
    assert.equal(evaluateAutoOwnerBook([tdcv, tdoc], r19e).ok, false);
  });
  it('API: filas nuevas por id, codigo con prefijo i18n y amount/paid como debito/credito', () => {
    const before = [{ id: 1 }, { id: 2 }];
    const after = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    assert.deepEqual(
      newBookRows(before, after).map((r) => r.id),
      [3, 4]
    );
    assert.equal(bookCode('carrier.checking_accounts.concept_codes.tdcv'), 'TDCV');
    assert.equal(bookCode(null), null);
    const rows = ownerBookApiToRows([
      { id: 3, amount: null, paid: 45.32, checkingAccountCode: 'x.TDCV' },
      { id: 4, amount: null, paid: 15, checkingAccountCode: 'TDOC' }
    ]);
    assert.equal(evaluateAutoOwnerBook(rows, r18e).ok, true);
  });
});

describe('Q7b y To Settle', () => {
  it('libro del chofer: 0 filas nuevas', () => {
    assert.equal(evaluateNoNewDriverBookRows(0).ok, true);
    assert.equal(evaluateNoNewDriverBookRows(2).ok, false);
  });
  it('To Settle 263,68 → 444,96 = +181,28 (FR-2)', () => {
    assert.equal(evaluateToSettleDelta(263.68, 444.96, 181.28).ok, true);
    assert.equal(evaluateToSettleDelta(263.68, 354.32, 181.28).ok, false);
    assert.equal(evaluateToSettleDelta(null, 10, 1).ok, false);
  });
});

describe('resolveAutoCommission', () => {
  const split = { owner: 0.4, driver: 0.4, agency: 0.2 };
  const db = { pctOwner: 0.5, pctDriver: 0.3, pctAgency: 0.2, ownerFixed: 0, agencyFixed: 122 };
  it('override > db > perfil fijo', () => {
    assert.equal(
      resolveAutoCommission({
        source: { kind: 'fixed', split },
        dbInputs: db,
        override: '0.6/0.2/0.2'
      }).origin,
      'override'
    );
    const fromDb = resolveAutoCommission({ source: { kind: 'fixed', split }, dbInputs: db });
    assert.equal(fromDb.origin, 'db');
    assert.equal(fromDb.fixed.agency, 122);
    assert.equal(
      resolveAutoCommission({ source: { kind: 'fixed', split }, dbInputs: null }).origin,
      'profile'
    );
  });
  it('perfil db sin DB ni override lanza; override invalido lanza', () => {
    assert.throws(
      () => resolveAutoCommission({ source: { kind: 'db' }, dbInputs: null }),
      /F5_AUTO_PCT/
    );
    assert.throws(() => parseAutoPct('0.4/0.4'), /invalido/);
    assert.deepEqual(parseAutoPct('0.4/0.4/0.2'), split);
  });
});
