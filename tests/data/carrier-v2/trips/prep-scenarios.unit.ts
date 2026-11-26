// tests/data/carrier-v2/trips/prep-scenarios.unit.ts
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { loadCarrierProfile, type CarrierProfile } from '../../../config/carrier-profiles.js';
import { parseMoney } from '../../../utils/money.js';
import {
  costAmount,
  expectedQuote,
  parseScenarioList,
  PREP_SCENARIOS,
  prepNote,
  scenarioCosts
} from './prep-scenarios.js';

const SAVED = { ENV: process.env.ENV, CIRCUIT_CARRIER: process.env.CIRCUIT_CARRIER };

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function uat(id: string): CarrierProfile {
  process.env.ENV = 'uat';
  process.env.CIRCUIT_CARRIER = id;
  return loadCarrierProfile(id);
}

describe('expectedQuote', () => {
  it('AR efectivo NC + COM = base + 1000 + 1000', () => {
    const q = expectedQuote(uat('1040-uat'), PREP_SCENARIOS['EF-NC-COM'], 41250);
    assert.equal(q.total, 43250);
    assert.equal(q.nonCommissionable, 1000);
    assert.equal(q.commissionable, 1000);
    assert.deepEqual(
      q.costs.map((c) => c.name),
      ['QA F2F3 UAT Venta No Comisionable', 'QA F2F3 UAT Fijo Venta']
    );
  });

  it('US efectivo NC + COM = base + 10 + 10 (base 1,29 -> 21,29)', () => {
    const q = expectedQuote(uat('1481-uat'), PREP_SCENARIOS['EF-NC-COM'], 1.29);
    assert.equal(q.total, 21.29);
  });

  it('US CC por costo: solo el concepto byCost NC (venta 8)', () => {
    const q = expectedQuote(uat('1481-uat'), PREP_SCENARIOS.CC, 99.79);
    assert.equal(q.total, 107.79);
    assert.equal(q.costs.length, 1);
    assert.equal(q.costs[0].byCost, true);
  });

  it('FR efectivo = base + 15 + 10 % de la base (206 -> 241,60)', () => {
    const q = expectedQuote(uat('2021-uat'), PREP_SCENARIOS['EF-NC-COM'], 206);
    assert.equal(q.total, 241.6);
    assert.equal(q.nonCommissionable, 15);
    assert.equal(q.commissionable, 20.6);
  });

  it('EF-PLAIN = base, sin conceptos; EF-NC-ONLY = base + NC', () => {
    assert.equal(expectedQuote(uat('1040-uat'), PREP_SCENARIOS['EF-PLAIN'], 500).total, 500);
    assert.equal(expectedQuote(uat('1040-uat'), PREP_SCENARIOS['EF-PLAIN'], 500).costs.length, 0);
    assert.equal(expectedQuote(uat('2021-uat'), PREP_SCENARIOS['EF-NC-ONLY'], 206).total, 221);
  });

  it('AR en CC: el concepto accountNc es opcional y no se ofrece -> sin conceptos', () => {
    assert.equal(scenarioCosts(uat('1040-uat'), PREP_SCENARIOS.CC).length, 0);
  });

  it('un slot obligatorio ausente lanza (no se inventa un concepto)', () => {
    const p = uat('1040-uat');
    const sinNc: CarrierProfile = {
      ...p,
      prep: { ...(p.prep as NonNullable<CarrierProfile['prep']>), otherCosts: {} }
    };
    assert.throws(() => scenarioCosts(sinNc, PREP_SCENARIOS['EF-NC-ONLY']), /cashNc/);
  });

  it('costAmount: PCT redondea a 2 decimales y un concepto sin importe lanza', () => {
    assert.equal(
      costAmount({ id: 1, name: 'x', percent: 10, commissionable: true }, 206.15),
      20.62
    );
    assert.throws(() => costAmount({ id: 1, name: 'x', commissionable: true }, 1), /sin importe/);
  });
});

describe('formatos de importe del parseo de la cotizacion', () => {
  it('parseMoney cubre AR 1.000,00 · US 10.00 · FR 241,60', () => {
    assert.equal(parseMoney('$ 1.000,00'), 1000);
    assert.equal(parseMoney('$ 10.00'), 10);
    assert.equal(parseMoney('€ 241,60'), 241.6);
    assert.equal(parseMoney('$ 41.250'), 41250);
  });
});

describe('parseScenarioList y nota', () => {
  it('vacio -> []; valida ids, quita duplicados y mantiene el orden', () => {
    assert.deepEqual(parseScenarioList(undefined), []);
    assert.deepEqual(parseScenarioList(' '), []);
    assert.deepEqual(parseScenarioList('CC, EF-NC-COM,CC'), ['CC', 'EF-NC-COM']);
  });
  it('un id desconocido lanza listando los validos', () => {
    assert.throws(() => parseScenarioList('EF-NC-COM,XX'), /"XX".*EF-NC-COM.*PAIR-EMPTY/);
  });
  it('PAIR-EMPTY no crea nada (payment null)', () => {
    assert.equal(PREP_SCENARIOS['PAIR-EMPTY'].payment, null);
  });
  it('EF-FARE0 es el unico que edita la tarifa final', () => {
    const edits = Object.values(PREP_SCENARIOS).filter((s) => s.editFinalFareToZero);
    assert.deepEqual(
      edits.map((s) => s.id),
      ['EF-FARE0']
    );
  });
  it('prepNote: QA F5 <ambiente> <escenario> <runId>', () => {
    assert.equal(prepNote('EF-NC-COM', 'abc123'), 'QA F5 UAT EF-NC-COM abc123');
  });
});
