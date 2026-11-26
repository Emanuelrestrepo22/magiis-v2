// tests/config/carrier-profiles.unit.ts
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  cityTaxFraction,
  COMMISSION_SPLIT,
  currencyMatcher,
  isCircuitCarrierExplicit,
  loadCarrierProfile,
  resolveCircuitCarrierId,
  todoFields
} from './carrier-profiles.js';
import { circuitCredentialRegion, getEnvFile, getStorageStatePath } from './runtime.js';

const SAVED = {
  CIRCUIT_CARRIER: process.env.CIRCUIT_CARRIER,
  ENV_FILE: process.env.ENV_FILE,
  ENV: process.env.ENV
};

function restore(): void {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('carrier-profiles: seleccion', () => {
  afterEach(restore);

  it('sin CIRCUIT_CARRIER: default 1901 y comportamiento historico', () => {
    delete process.env.CIRCUIT_CARRIER;
    delete process.env.ENV_FILE;
    process.env.ENV = 'test';
    assert.equal(isCircuitCarrierExplicit(), false);
    assert.equal(resolveCircuitCarrierId(), '1901');
    assert.equal(loadCarrierProfile().carrierId, 1901);
    assert.equal(getEnvFile(), '.env.test');
    assert.equal(getStorageStatePath('test'), 'storage/state-carrier-test.json');
    assert.equal(circuitCredentialRegion(), '');
  });

  it('CIRCUIT_CARRIER=1901 explicito: mismo storage state, env file del perfil', () => {
    process.env.CIRCUIT_CARRIER = '1901';
    delete process.env.ENV_FILE;
    assert.equal(resolveCircuitCarrierId(), '1901');
    assert.equal(getStorageStatePath('test'), 'storage/state-carrier-test.json');
    assert.equal(getEnvFile(), '.env.test-fr');
    assert.equal(circuitCredentialRegion(), 'FR');
  });

  it('ENV_FILE explicito gana sobre el env file del perfil', () => {
    process.env.CIRCUIT_CARRIER = '1901';
    process.env.ENV_FILE = '.env.otro';
    assert.equal(getEnvFile(), '.env.otro');
  });

  it('1521: storage state propio (no pisa el de 1901) y env file propio', () => {
    process.env.CIRCUIT_CARRIER = '1521';
    delete process.env.ENV_FILE;
    assert.equal(getStorageStatePath('test'), 'storage/state-carrier-circuit-1521-test.json');
    assert.notEqual(getStorageStatePath('test'), 'storage/state-carrier-test.json');
    assert.equal(getEnvFile(), '.env.test-us');
    assert.equal(circuitCredentialRegion(), 'US');
  });

  it('id desconocido lanza nombrando los perfiles disponibles', () => {
    process.env.CIRCUIT_CARRIER = '9999';
    assert.throws(() => resolveCircuitCarrierId(), /9999.*1521.*1901/);
    assert.throws(() => loadCarrierProfile(), /9999/);
  });
});

describe('carrier-profiles: contenido', () => {
  afterEach(restore);

  it('1901 completo con los hechos actuales', () => {
    const p = loadCarrierProfile('1901');
    assert.deepEqual(todoFields('1901'), []);
    assert.equal(p.currency.code, 'EUR');
    assert.equal(p.thousandsSeparator, 'NONE');
    assert.deepEqual(p.commission, {
      kind: 'fixed',
      split: { owner: 0.4, driver: 0.4, agency: 0.2 }
    });
    assert.deepEqual(p.cityTax, { present: true, conceptName: 'QA City Taxes', percent: 10 });
    assert.equal(p.fixtures.ownerId, 2927);
    assert.equal(p.fixtures.driverDbId, 4965);
    assert.equal(p.fixtures.clientCcId, 5614);
    assert.equal(cityTaxFraction(p), 0.1);
  });

  it('1521 completo: loadCarrierProfile no lanza, sin pendientes y nunca cae en 1901', () => {
    // Descubierto el 11/11 (DB TEST): cityTax, ownerId, driverDbId, vehicleDomain, otherCosts, pares, ficha, app.
    // Alta relevada el 11/11 (cliente de efectivo, medios de pago). Pendiente: cuenta CC del cliente y su medio de pago.
    assert.deepEqual(todoFields('1521'), []);
    const p = loadCarrierProfile('1521');
    assert.equal(p.id, '1521');
    assert.notEqual(p.carrierId, 1901);
  });

  it('COMMISSION_SPLIT es del perfil activo y con comision de DB falla perezosamente hasta ensureCommissionResolved', () => {
    delete process.env.CIRCUIT_CARRIER;
    assert.equal(COMMISSION_SPLIT.owner, 0.4);
    assert.equal(COMMISSION_SPLIT.agency, 0.2);
    process.env.CIRCUIT_CARRIER = '1521';
    assert.throws(() => COMMISSION_SPLIT.owner, /1521.*ensureCommissionResolved/);
  });

  it('currencyMatcher: simbolo opcional y escape de $', () => {
    assert.ok(currencyMatcher({ code: 'EUR', symbol: '€' }).test('€ 10,00'));
    assert.ok(currencyMatcher({ code: 'EUR', symbol: '€' }).test('eur'));
    assert.ok(!currencyMatcher({ code: 'EUR', symbol: '€' }, { symbol: false }).test('€'));
    assert.ok(currencyMatcher({ code: 'USD', symbol: '$' }).test('$5'));
    assert.ok(!currencyMatcher({ code: 'USD', symbol: '$' }).test('EUR'));
  });

  it('cityTaxFraction: 0 si el perfil declara city tax ausente', () => {
    const p = { ...loadCarrierProfile('1901'), cityTax: { present: false } as const };
    assert.equal(cityTaxFraction(p), 0);
  });
});
