// tests/helpers/circuit-guards.unit.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { loadCarrierProfile, prepPair, type CarrierProfile } from '../config/carrier-profiles.js';
import { PREP_SCENARIOS } from '../data/carrier-v2/trips/prep-scenarios.js';
import {
  assertDriverMatchesPair,
  assertEnvMatchesProfile,
  assertNoForbiddenFlow,
  assertOwnPair,
  detailDriverId,
  evaluatePrepClosure,
  findForbiddenFlow
} from './circuit-guards.js';

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

describe('assertDriverMatchesPair', () => {
  it('incidente 723585: chofer ajeno 6013 != 6437 lanza', () => {
    const { pair } = prepPair(uat('1481-uat'), 'P1');
    assert.throws(() => assertDriverMatchesPair(6013, pair), /chofer ajeno.*6013.*6437/);
    assert.throws(() => assertDriverMatchesPair(null, pair), /chofer ajeno/);
    assert.doesNotThrow(() => assertDriverMatchesPair(6437, pair));
  });
});

describe('assertOwnPair / assertEnvMatchesProfile', () => {
  it('rechaza un par no declarado y acepta el propio', () => {
    const p = uat('1481-uat');
    assert.throws(() => assertOwnPair(p, 'P7'), /no declarado como propio/);
    assert.equal(assertOwnPair(p, 'P3').pair.driverId, 6439);
  });
  it('rechaza un par declarado sin qaOwned', () => {
    const p = uat('1040-uat');
    const ajeno = {
      ...p,
      prep: {
        ...(p.prep as NonNullable<CarrierProfile['prep']>),
        pairs: {
          default: { ...(p.prep?.pairs.default as object), qaOwned: false }
        }
      }
    } as unknown as CarrierProfile;
    assert.throws(() => assertOwnPair(ajeno), /no declarado como propio/);
  });
  it('perfil UAT con ENV=test lanza; con ENV=uat pasa', () => {
    const p = uat('2021-uat');
    assert.doesNotThrow(() => assertEnvMatchesProfile(p, { ENV: 'uat' } as NodeJS.ProcessEnv));
    assert.throws(
      () => assertEnvMatchesProfile(p, { ENV: 'test' } as NodeJS.ProcessEnv),
      /ambiente uat.*ENV=test/
    );
  });
});

describe('detailDriverId / evaluatePrepClosure', () => {
  const p = (): CarrierProfile => uat('1040-uat');
  const pairOf = (profile: CarrierProfile) => prepPair(profile).pair;

  it('lee driverId o driver.id', () => {
    assert.equal(detailDriverId({ driverId: 6441 }), 6441);
    assert.equal(detailDriverId({ driver: { id: 6441 } }), 6441);
    assert.equal(detailDriverId({}), null);
    assert.equal(detailDriverId({ driverId: 0 }), null);
  });

  it('efectivo NC + COM cerrado con el chofer del par: sin diferencias', () => {
    const profile = p();
    const mismatches = evaluatePrepClosure(
      {
        state: 'DONE',
        paymentMethod: 'CASH',
        driver: { id: 6441 },
        otherCostList: [
          { name: 'QA F2F3 UAT Venta No Comisionable' },
          { name: 'QA F2F3 UAT Fijo Venta' }
        ]
      },
      {
        pair: pairOf(profile),
        scenario: PREP_SCENARIOS['EF-NC-COM'],
        costs: [
          {
            id: 279,
            name: 'QA F2F3 UAT Venta No Comisionable',
            fixed: 1000,
            commissionable: false
          },
          { id: 278, name: 'QA F2F3 UAT Fijo Venta', fixed: 1000, commissionable: true }
        ]
      }
    );
    assert.deepEqual(mismatches, []);
  });

  it('detecta estado, chofer, pago y conceptos distintos', () => {
    const profile = p();
    const mismatches = evaluatePrepClosure(
      { state: 'CANCELLED', paymentMethod: 'CHECKING_ACCOUNT', driverId: 6013, otherCostList: [] },
      {
        pair: pairOf(profile),
        scenario: PREP_SCENARIOS['EF-NC-ONLY'],
        costs: [{ id: 279, name: 'NC', fixed: 1, commissionable: false }]
      }
    );
    assert.deepEqual(
      mismatches.map((m) => m.field),
      ['state', 'driver.id', 'paymentMethod', 'otherCostList[NC]']
    );
  });

  it('EF-PLAIN: la lista de otros costos debe estar vacia', () => {
    const profile = p();
    const mismatches = evaluatePrepClosure(
      { state: 'DONE', paymentMethod: 'CASH', driverId: 6441, otherCostList: [{ name: 'X' }] },
      { pair: pairOf(profile), scenario: PREP_SCENARIOS['EF-PLAIN'], costs: [] }
    );
    assert.deepEqual(
      mismatches.map((m) => m.field),
      ['otherCostList']
    );
  });
});

describe('assertNoForbiddenFlow', () => {
  it('detecta sendService(, Send Service y autodispatch fuera de comentarios', () => {
    assert.deepEqual(findForbiddenFlow('await trip.sendService();'), ['linea 1: sendService(']);
    assert.ok(findForbiddenFlow("await click('Send Service')").length > 0);
    assert.ok(findForbiddenFlow('await api.autoDispatch(1)').length > 0);
    assert.deepEqual(findForbiddenFlow('// nunca sendService( ni autoDispatch'), []);
    assert.throws(() => assertNoForbiddenFlow('x.sendService()', 'steps'), /steps.*sendService/);
  });

  it('el flujo de preparacion real (steps + specs + escenarios) no los usa', () => {
    const files = [
      'tests/steps/trips/adminCircuit.steps.ts',
      'tests/specs/trips/f5-prep-trips.spec.ts',
      'tests/specs/trips/f5-prep-verify.spec.ts',
      'tests/data/carrier-v2/trips/prep-scenarios.ts'
    ];
    for (const f of files) {
      assert.deepEqual(findForbiddenFlow(readFileSync(f, 'utf-8')), [], f);
    }
  });
});
