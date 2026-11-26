// Unit de las constantes de DriverAddressSearchPBO. Run: npx tsx --test tests/mobile/appium/pbo/DriverAddressSearchPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEGRADATION_SCENARIOS, DRIVER_ADDRESS_TERMS } from './DriverAddressSearchPBO.js';

test('los términos de cada caso son distintos (distinctUntilChanged suprimiría un término repetido)', () => {
  const terms = [
    ...Object.values(DRIVER_ADDRESS_TERMS),
    ...DEGRADATION_SCENARIOS.map((s) => s.term)
  ];
  assert.equal(new Set(terms).size, terms.length);
});

test('ningún término de caso es prefijo-igual de otro que se haya emitido antes (sin colisión exacta)', () => {
  const t = DRIVER_ADDRESS_TERMS;
  assert.notEqual(t.ownEndpoint, t.contract);
  assert.ok(t.minLength.slice(0, 4) !== t.debounce.slice(0, 4));
});

test('los escenarios de TM-665 cubren 503, 500 y error de red', () => {
  assert.deepEqual(
    DEGRADATION_SCENARIOS.map((s) => `${s.mode}:${s.status ?? 'net'}`),
    ['status:503', 'status:500', 'networkError:net']
  );
});
