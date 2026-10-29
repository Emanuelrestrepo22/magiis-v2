import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  evaluateCommissionBase,
  expectedCommissionPcts,
  type CommissionBaseInput,
  type CommissionConfig
} from './commission-base.js';

// Configuracion medida en TEST el 2026-10-21: chofer 4987 (venta 20 / costo 30) + vehiculo 3265
// (venta 32 / costo 23, pagador AGENCY).
const CFG: CommissionConfig = {
  driverSalePct: 20,
  driverCostPct: 30,
  vehicleSalePct: 32,
  vehicleCostPct: 23,
  payee: 'AGENCY'
};

// Fila (a): tarifador por costo 6203, Pc 21.33, comisionable 10/6 y no comisionable 8/4 (viaje 71413).
const rowA = (): CommissionBaseInput => ({
  label: 'fila a',
  quotedTourCost: 21.33,
  expectedWaitCost: 0,
  commissionableCost: 6,
  nonCommissionableCost: 4,
  nonCommissionableSale: 8,
  expectedPcts: expectedCommissionPcts(true, CFG),
  detail: {
    amountCost: 27.33,
    tourPriceCost: 21.33,
    waitTotalPriceCost: 0,
    otherCostPriceCost: 6,
    otherCostNoCom: 8,
    otherCostPriceCostNoCom: 4
  },
  db: {
    FINAL_COST_PRICE: 27.33,
    TOTALCOSTPARTIAL_COST: 21.33,
    WAIT_TOTAL_PRICE_COST: 0,
    OTHER_COST_TOTAL_PRICE_COST: 6,
    OTHER_COST_TOTAL_NOCOM: 8,
    OTHER_COST_PRICE_COST_NOCOM: 4
  },
  travelPcts: {
    DRIVER_COMMISSION_PCT: 0.3,
    OWNER_COMMISSION_PCT: 0.47,
    AGENCY_COMMISSION_PCT: 0.23
  },
  preview: {
    driverCommissionPct: 0.3,
    driverCommissionAmount: 8.199,
    ownerCommissionPct: 0.47,
    ownerCommissionAmount: 12.8451
  },
  sideEffects: {
    before: { travelsSurrenderId: null, surrendered: 0 },
    after: { travelsSurrenderId: null, surrendered: 0 },
    surrenderPosts: 0
  }
});

// Fila (b): control 6204 (solo venta), sin otros costos, Pc 21.33 (costo = venta copiada).
const rowB = (): CommissionBaseInput => ({
  ...rowA(),
  label: 'fila b',
  commissionableCost: 0,
  nonCommissionableCost: 0,
  nonCommissionableSale: 0,
  expectedPcts: expectedCommissionPcts(false, CFG),
  detail: {
    amountCost: 21.33,
    tourPriceCost: 21.33,
    waitTotalPriceCost: 0,
    otherCostPriceCost: 0,
    otherCostNoCom: 0,
    otherCostPriceCostNoCom: 0
  },
  db: {
    FINAL_COST_PRICE: 21.33,
    TOTALCOSTPARTIAL_COST: 21.33,
    WAIT_TOTAL_PRICE_COST: 0,
    OTHER_COST_TOTAL_PRICE_COST: 0,
    OTHER_COST_TOTAL_NOCOM: 0,
    OTHER_COST_PRICE_COST_NOCOM: 0
  },
  travelPcts: {
    DRIVER_COMMISSION_PCT: 0.2,
    OWNER_COMMISSION_PCT: 0.48,
    AGENCY_COMMISSION_PCT: 0.32
  },
  preview: {
    driverCommissionPct: 0.2,
    driverCommissionAmount: 4.266,
    ownerCommissionPct: 0.48,
    ownerCommissionAmount: 10.2384
  }
});

describe('expectedCommissionPcts', () => {
  it('por costo: chofer 0,30 / agencia 0,23 / dueno 0,47', () => {
    assert.deepEqual(expectedCommissionPcts(true, CFG), { driver: 0.3, agency: 0.23, owner: 0.47 });
  });

  it('por venta: chofer 0,20 / agencia 0,32 / dueno 0,48', () => {
    assert.deepEqual(expectedCommissionPcts(false, CFG), {
      driver: 0.2,
      agency: 0.32,
      owner: 0.48
    });
  });

  it('lanza si el pagador no es AGENCY o la configuracion esta incompleta', () => {
    assert.throws(() => expectedCommissionPcts(true, { ...CFG, payee: 'OWNER' }), /pagador/);
    assert.throws(
      () => expectedCommissionPcts(true, { ...CFG, driverCostPct: null }),
      /incompleta/
    );
  });
});

describe('evaluateCommissionBase', () => {
  it('fila a (por costo, con comisionable y no comisionable) en verde y devuelve lo medido', () => {
    const v = evaluateCommissionBase(rowA());
    assert.equal(v.ok, true, v.message);
    assert.equal(v.measured.expectedFinalCostPrice, 27.33);
    assert.equal(v.measured.wrongBaseFinalCostPrice, 31.33);
    assert.equal(v.measured.expectedDriverCommission, 8.199);
    assert.equal(v.measured.wrongBaseDriverCommission, 9.399);
  });

  it('fila b (control sin otros costos) en verde', () => {
    const v = evaluateCommissionBase(rowB());
    assert.equal(v.ok, true, v.message);
  });

  it('base que suma el costo no comisionable falla nombrando FINAL_COST_PRICE y la comision', () => {
    const input = rowA();
    input.db = { ...input.db, FINAL_COST_PRICE: 31.33 };
    input.detail = { ...input.detail, amountCost: 31.33 };
    input.preview = {
      ...input.preview,
      driverCommissionAmount: 9.399,
      ownerCommissionAmount: 14.7251
    };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    const fields = v.mismatches.map((m) => m.field).join(' | ');
    assert.match(fields, /E1 DB FINALPRICEI\.FINAL_COST_PRICE/);
    assert.match(fields, /E2 FINAL_COST_PRICE no debe sumar/);
    assert.match(v.message, /\[fila a\] base de comision: \d+ diferencia/);
  });

  it('comision de la vista previa calculada sobre base + no comisionable falla en E5', () => {
    const input = rowA();
    input.preview = {
      ...input.preview,
      driverCommissionAmount: 9.399,
      ownerCommissionAmount: 14.7251
    };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    const fields = v.mismatches.map((m) => m.field);
    assert.ok(fields.includes('E5 vista previa driverCommissionAmount'));
    assert.ok(fields.includes('E5 driverCommissionAmount no debe incluir el no comisionable'));
    assert.ok(fields.includes('E5 ownerCommissionAmount no debe incluir el no comisionable'));
  });

  it('porcentaje 0 es vacuo: falla E4 aunque los importes cierren', () => {
    const input = rowA();
    input.expectedPcts = { driver: 0, owner: 0.47, agency: 0.53 };
    input.travelPcts = { ...input.travelPcts, DRIVER_COMMISSION_PCT: 0 };
    input.preview = { ...input.preview, driverCommissionPct: 0, driverCommissionAmount: 0 };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'E4 pct chofer esperado'));
  });

  it('porcentajes guardados distintos de la configuracion fallan en E4', () => {
    const input = rowA();
    input.travelPcts = { ...input.travelPcts, DRIVER_COMMISSION_PCT: 0.2 };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'E4 TRAVEL.DRIVER_COMMISSION_PCT'));
  });

  it('fila de la vista previa ausente (null) no pasa en silencio', () => {
    const input = rowA();
    input.preview = {};
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    const fields = v.mismatches.map((m) => m.field);
    assert.ok(fields.includes('E5 vista previa driverCommissionAmount'));
    assert.ok(fields.includes('E4 vista previa driverCommissionPct'));
  });

  it('componentes API/DB distintos entre si fallan en E1 (API vs DB)', () => {
    const input = rowA();
    input.detail = { ...input.detail, amountCost: 27.0 };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'E1 API amountCost vs DB FINAL_COST_PRICE'));
  });

  it('vista previa que genero rendicion falla en E6 (id, flag y POST)', () => {
    const input = rowA();
    input.sideEffects = {
      before: { travelsSurrenderId: null, surrendered: 0 },
      after: { travelsSurrenderId: 99, surrendered: 1 },
      surrenderPosts: 1
    };
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    const fields = v.mismatches.map((m) => m.field);
    assert.ok(fields.includes('E6 TRAVEL.TRAVELSSURRENDER_ID (after)'));
    assert.ok(fields.includes('E6 TRAVEL.SURRENDERED (after)'));
    assert.ok(fields.includes('E6 POST toTravelsSurrender durante la vista previa'));
  });

  it('caso vacuo: sin no comisionable ni comisionable en la fila a falla E2', () => {
    const input = rowA();
    input.commissionableCost = 0;
    const v = evaluateCommissionBase(input);
    assert.equal(v.ok, false);
    assert.ok(v.mismatches.some((m) => m.field === 'E2 otros costos comisionables (costo)'));
  });
});
