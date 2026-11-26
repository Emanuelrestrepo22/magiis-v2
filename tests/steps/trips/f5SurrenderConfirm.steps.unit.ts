import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  assertConfirmEnvAllowed,
  ccByCostOfTarget,
  isF5ConfirmGateOpen
} from './f5SurrenderConfirm.steps.js';
import { F5_UAT_TARGETS, F5_TARGETS } from '../../config/f5-targets.js';

const env = (e: Record<string, string>): NodeJS.ProcessEnv => e as NodeJS.ProcessEnv;

describe('gate de la confirmación F5', () => {
  it('cerrado por defecto; solo el valor exacto 1 lo abre (también por el alias histórico)', () => {
    assert.equal(isF5ConfirmGateOpen(env({})), false);
    assert.equal(isF5ConfirmGateOpen(env({ F5_CONFIRM_SURRENDER: 'true' })), false);
    assert.equal(isF5ConfirmGateOpen(env({ F5_CONFIRM_SURRENDER: '1' })), true);
    assert.equal(isF5ConfirmGateOpen(env({ FR_CONFIRM_SURRENDER: '1' })), true);
  });
});

describe('H-08: la confirmación irreversible no corre en prod', () => {
  it('uat y test pasan; prod, vacío o desconocido lanzan', () => {
    assert.equal(assertConfirmEnvAllowed(env({ ENV: 'uat' })), 'uat');
    assert.equal(assertConfirmEnvAllowed(env({ ENV: 'test' })), 'test');
    assert.throws(() => assertConfirmEnvAllowed(env({ ENV: 'prod' })), /nunca prod/);
    assert.throws(() => assertConfirmEnvAllowed(env({})));
  });
});

describe('ccByCostOfTarget (H-02: CC por costo desde el perfil)', () => {
  // Los perfiles UAT solo cargan con ENV=uat (no se mezclan ambientes).
  const saved = process.env.ENV;
  before(() => {
    process.env.ENV = 'uat';
  });
  after(() => {
    if (saved === undefined) delete process.env.ENV;
    else process.env.ENV = saved;
  });
  it('1481 UAT: el vehículo con % de costo > 0 (5353) es por costo y los demás no', () => {
    const base = F5_UAT_TARGETS['1481'];
    assert.equal(ccByCostOfTarget({ ...base, vehicleId: 5353 }), true);
    assert.equal(ccByCostOfTarget({ ...base, vehicleId: 5352 }), false);
    assert.equal(ccByCostOfTarget({ ...base, vehicleId: 5354 }), false);
  });
  it('sin dato del vehículo (par en runtime) o sin perfil (1040 TEST histórico): undefined, no se asume', () => {
    assert.equal(ccByCostOfTarget(F5_UAT_TARGETS['1481']), undefined);
    assert.equal(ccByCostOfTarget(F5_TARGETS['1040']), undefined);
  });
});
