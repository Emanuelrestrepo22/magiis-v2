import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateOneMovementPerTravel,
  evaluateSaleCostPairs,
  evaluateSurrenderRow,
  expectedCommissions,
  formatMismatches,
  type Mismatch,
  type MovementRow,
  type OtherCostItemRow,
  type SaleCostRow,
  type SurrenderRow
} from './db-oracle-eval.js';

const baseRow: SaleCostRow = {
  SRC: 'TRAVEL',
  ADDITIONAL_ID: 1,
  FINALPRICE: 100,
  FINAL_COST_PRICE: 100,
  TOTALCOSTPARTIAL: 80,
  TOTALCOSTPARTIAL_COST: 80,
  KM: 12,
  WAITTIMEPRICE: 10,
  WAIT_TOTAL_PRICE_COST: 10,
  OTHERCOST: 10,
  OTHER_COST_TOTAL_PRICE_COST: 10,
  OTHER_COST_TOTAL_NOCOM: 0,
  OTHER_COST_PRICE_COST_NOCOM: 0,
  TOOLPRICE: 0,
  PARKING: 0,
  FIX_CONCEPT_COST: 0,
  TAXES_COST: 0
};
const item = (over: Partial<OtherCostItemRow> = {}): OtherCostItemRow => ({
  ID: 5,
  NAME: 'city tax',
  PRICE: 10,
  PRICE_COST: 10,
  IS_COMMISIONABLE: null,
  ...over
});

describe('evaluateSaleCostPairs', () => {
  it('pasa con pares iguales (IS_COMMISIONABLE null cuenta como comisionable)', () => {
    const result = evaluateSaleCostPairs(1, baseRow, [item()]);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'TRAVEL');
  });

  it('nombra la columna que difiere', () => {
    const wait = evaluateSaleCostPairs(1, { ...baseRow, WAIT_TOTAL_PRICE_COST: 9 }, [item()]);
    assert.equal(wait.ok, false);
    assert.match(
      formatMismatches('x', wait.mismatches),
      /WAITTIMEPRICE vs WAIT_TOTAL_PRICE_COST: obtenido 10 vs esperado 9/
    );
    const cost = evaluateSaleCostPairs(1, baseRow, [item({ PRICE_COST: 7 })]);
    assert.equal(cost.ok, false);
    assert.match(
      formatMismatches('x', cost.mismatches),
      /TRAVEL_OTHERCOST\[5\] PRICE vs PRICE_COST/
    );
  });

  it('falla por costo NULL', () => {
    const v = evaluateSaleCostPairs(1, { ...baseRow, FINAL_COST_PRICE: null }, [item()]);
    assert.equal(v.ok, false);
    assert.match(formatMismatches('x', v.mismatches), /FINAL_COST_PRICE: obtenido NULL/);
  });

  it('con peaje el total de costo es la suma de segregados, no la venta', () => {
    const row = { ...baseRow, FINALPRICE: 105, TOOLPRICE: 5 };
    const result = evaluateSaleCostPairs(1, row, [item()]);
    assert.equal(result.ok, true);
    assert.ok(result.notes.some((n) => n.includes('no se compara')));
    const copy = evaluateSaleCostPairs(1, { ...row, FINAL_COST_PRICE: 105 }, [item()]);
    assert.equal(copy.ok, false);
    assert.match(
      formatMismatches('x', copy.mismatches),
      /FINAL_COST_PRICE vs TOTALCOSTPARTIAL_COST \+ WAIT_TOTAL_PRICE_COST/
    );
  });

  it('un item no comisionable no suma al total comisionable', () => {
    const row = {
      ...baseRow,
      OTHERCOST: 15,
      OTHER_COST_TOTAL_NOCOM: 5,
      OTHER_COST_PRICE_COST_NOCOM: 5
    };
    const items = [item(), item({ ID: 6, PRICE: 5, PRICE_COST: 5, IS_COMMISIONABLE: 0 })];
    // peaje/no-com presente: FINALPRICE no se compara; el resto debe pasar
    assert.equal(evaluateSaleCostPairs(1, { ...row, FINALPRICE: 105 }, items).ok, true);
  });
});

const surrender = (over: Partial<SurrenderRow> = {}): SurrenderRow =>
  ({
    CASHCOMMISSION: 608.4,
    CHECKINGACCOUNTCOMMISSION: 0,
    CREDITCARDCOMMISSION: 0,
    COMMISSIONSUM: 608.4,
    OWNER_TOTALCOMMISSION: 608.4,
    AGENCY_TOTALCOMMISSION: 304.2,
    TOTALOTHERCOST: 0,
    TOTALOTHERCOST_NOCOM: null,
    ...over
  }) as SurrenderRow;

describe('surrender oracle', () => {
  it('formula verificada en la rendicion historica 71032 (cash 1521, 40/20)', () => {
    const expected = expectedCommissions({
      cashBase: 1521,
      checkingAccountBase: 0,
      creditCardBase: 0,
      pctOwner: 0.4,
      pctAgency: 0.2
    });
    assert.equal(expected.CASHCOMMISSION, 608.4);
    assert.equal(expected.AGENCY_TOTALCOMMISSION, 304.2);
    assert.equal(
      evaluateSurrenderRow(surrender(), { ...expected, TOTALOTHERCOST_NOCOM: 0 }).ok,
      true
    );
  });

  it('comision 0 % (carrier 1901): todas las comisiones esperadas son 0', () => {
    const expected = expectedCommissions({
      cashBase: 500,
      checkingAccountBase: 200,
      creditCardBase: 0,
      pctOwner: 0,
      pctAgency: 0
    });
    assert.equal(expected.COMMISSIONSUM, 0);
    assert.equal(expected.AGENCY_TOTALCOMMISSION, 0);
    const zeroRow = surrender({
      CASHCOMMISSION: 0,
      COMMISSIONSUM: 0,
      OWNER_TOTALCOMMISSION: 0,
      AGENCY_TOTALCOMMISSION: 0
    });
    assert.equal(evaluateSurrenderRow(zeroRow, expected).ok, true);
  });

  it('formula mixta 70404 (cash 3000 + CC 3000)', () => {
    const expected = expectedCommissions({
      cashBase: 3000,
      checkingAccountBase: 3000,
      creditCardBase: 0,
      pctOwner: 0.4,
      pctAgency: 0.2
    });
    assert.equal(expected.COMMISSIONSUM, 2400);
    assert.equal(expected.AGENCY_TOTALCOMMISSION, 1200);
  });

  it('una columna distinta falla nombrandola; NOCOM null≡0', () => {
    const v = evaluateSurrenderRow(surrender({ AGENCY_TOTALCOMMISSION: 300 }), {
      AGENCY_TOTALCOMMISSION: 304.2
    });
    assert.equal(v.ok, false);
    assert.deepEqual(v.mismatches, [
      { field: 'TRAVELSSURRENDER.AGENCY_TOTALCOMMISSION', expected: 304.2, actual: 300 }
    ]);
    assert.match(
      formatMismatches('rendicion 1', v.mismatches),
      /TRAVELSSURRENDER\.AGENCY_TOTALCOMMISSION: obtenido 300 vs esperado 304.2/
    );
    assert.equal(evaluateSurrenderRow(surrender(), { TOTALOTHERCOST_NOCOM: 0 }).ok, true);
  });
});

const mv = (over: Partial<MovementRow>): MovementRow => ({
  ID: 1,
  TRAVEL_ID: 10,
  MOVEMENT_CODE: 'TIVR',
  MOVEMENT_TYPE: 'AUTOMATIC',
  MOUNT: 50,
  CURRENCY_ID: null,
  MOVEMENTSTATUS: 1,
  CREATIONDATE: null,
  ...over
});

describe('evaluateOneMovementPerTravel', () => {
  const messageOf = (v: { mismatches: Mismatch[] }): string => formatMismatches('x', v.mismatches);

  it('1 movimiento por viaje con MOUNT = venta; ignora TITX/TETX', () => {
    const v = evaluateOneMovementPerTravel(
      [mv({}), mv({ ID: 2, MOVEMENT_CODE: 'TITX', MOUNT: 3 })],
      [{ travelId: 10, amount: 50 }]
    );
    assert.equal(v.ok, true);
    assert.equal(v.found.get(10)?.ID, 1);
  });

  it('duplicado, faltante, monto distinto y viaje ajeno fallan', () => {
    const dup = evaluateOneMovementPerTravel(
      [mv({}), mv({ ID: 2 })],
      [{ travelId: 10, amount: 50 }]
    );
    assert.equal(dup.ok, false);
    assert.match(
      messageOf(dup),
      /viaje 10 \(filas TIVR\/TEVR AUTOMATIC\): obtenido 2 vs esperado 1/
    );
    const none = evaluateOneMovementPerTravel([], [{ travelId: 10, amount: 50 }]);
    assert.equal(none.ok, false);
    assert.match(messageOf(none), /obtenido 0 vs esperado 1/);
    const amount = evaluateOneMovementPerTravel(
      [mv({ MOUNT: 49 })],
      [{ travelId: 10, amount: 50 }]
    );
    assert.equal(amount.ok, false);
    assert.match(messageOf(amount), /MOVEMENT\.MOUNT \(viaje 10\)/);
    const foreign = evaluateOneMovementPerTravel(
      [mv({}), mv({ ID: 3, TRAVEL_ID: 99 })],
      [{ travelId: 10, amount: 50 }]
    );
    assert.equal(foreign.ok, false);
    assert.match(messageOf(foreign), /MOVEMENT 3: viaje ajeno.*obtenido 99/);
  });
});
