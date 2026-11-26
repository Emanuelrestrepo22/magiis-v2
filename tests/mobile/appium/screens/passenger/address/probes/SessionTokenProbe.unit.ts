// Unit de B6 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/SessionTokenProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSessionToken, type SeenCall } from './SessionTokenProbe.js';

const terms = ['libe', 'libertad', 'libertad 479'];
const m = (observed: SeenCall[], termsRejected: string[] = []) => ({
  terms,
  termsRejected,
  observed
});

test('B6 PASS: varias consultas distintas comparten un único token', () => {
  const r = evaluateSessionToken(
    m([
      { address: 'libe', token: 'T1' },
      { address: 'libertad', token: 'T1' },
      { address: 'libertad 479', token: 'T1' }
    ])
  );
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /T1/);
});

test('B6 FAIL: tokens distintos dentro del mismo campo', () => {
  const r = evaluateSessionToken(
    m([
      { address: 'libe', token: 'T1' },
      { address: 'libertad', token: 'T2' }
    ])
  );
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /2 tokens/);
});

test('B6 SIN_DATOS: cero requests', () => {
  assert.equal(evaluateSessionToken(m([])).status, 'SIN_DATOS');
});

test('B6 NO_EJERCIDO: los requests salen sin sessionToken', () => {
  const r = evaluateSessionToken(
    m([
      { address: 'libe', token: '' },
      { address: 'libertad', token: '' }
    ])
  );
  assert.equal(r.status, 'NO_EJERCIDO');
});

test('B6 NO_EJERCIDO: una sola consulta distinta no acredita estabilidad (campo muerto tras el primer término)', () => {
  const r = evaluateSessionToken(
    m([{ address: 'libe', token: 'T1' }], ['libertad', 'libertad 479'])
  );
  assert.equal(r.status, 'NO_EJERCIDO');
  assert.match(r.detail, /rechazó: libertad, libertad 479/);
});

test('B6 NO_EJERCIDO: dos requests de la MISMA consulta no son dos consultas', () => {
  const r = evaluateSessionToken(
    m([
      { address: 'libe', token: 'T1' },
      { address: 'libe', token: 'T1' }
    ])
  );
  assert.equal(r.status, 'NO_EJERCIDO');
});

test('B6 FAIL gana sobre una sola consulta: tokens distintos ya es rotación indebida', () => {
  const r = evaluateSessionToken(
    m([
      { address: 'libe', token: 'T1' },
      { address: 'libe', token: 'T2' }
    ])
  );
  assert.equal(r.status, 'FAIL');
});
