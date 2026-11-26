// Unit de B9 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/OfflineProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOfflineUsable, type OfflineMeasurements } from './OfflineProbe.js';

const sano: OfflineMeasurements = {
  term: 'libertad 479',
  typedBaseline: true,
  typedOffline: true,
  stillEditable: true,
  faultHits: 1,
  callsAfterRecovery: 1
};
const m = (over: Partial<OfflineMeasurements>): OfflineMeasurements => ({ ...sano, ...over });

test('B9 PASS: acepta texto sin red, sigue editable y recupera al volver la red', () => {
  assert.equal(evaluateOfflineUsable(sano).status, 'PASS');
});

test('B9 FAIL: sin red el campo no acepta texto (aceptaba antes)', () => {
  assert.equal(evaluateOfflineUsable(m({ typedOffline: false, faultHits: 0 })).status, 'FAIL');
});

test('B9 FAIL: el campo queda readonly/deshabilitado tras la caída', () => {
  assert.equal(evaluateOfflineUsable(m({ stillEditable: false })).status, 'FAIL');
});

test('B9 FAIL: no vuelve a consultar al restablecerse la red', () => {
  assert.equal(evaluateOfflineUsable(m({ callsAfterRecovery: 0 })).status, 'FAIL');
});

test('B9 SIN_DATOS: el campo no aceptaba texto antes de la falla (harness, no producto)', () => {
  assert.equal(
    evaluateOfflineUsable(m({ typedBaseline: false, typedOffline: false })).status,
    'SIN_DATOS'
  );
});

test('B9 SIN_DATOS: estado de la inyección ilegible', () => {
  assert.equal(evaluateOfflineUsable(m({ faultHits: null })).status, 'SIN_DATOS');
});

test('B9 NO_EJERCIDO: la regla networkError nunca disparó', () => {
  assert.equal(evaluateOfflineUsable(m({ faultHits: 0 })).status, 'NO_EJERCIDO');
});
