// Unit de B2 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/DebounceProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDebounce, evaluateDebounce, type DebounceMeasurements } from './DebounceProbe.js';

const T0 = 1_000_000;
/** 10 pulsaciones cada 80 ms desde T0: la última cae en T0 + 720. */
const STAMPS = Array.from({ length: 10 }, (_, i) => T0 + i * 80);
const LAST = T0 + 720;

const m = (over: Partial<DebounceMeasurements> = {}): DebounceMeasurements => ({
  term: 'libertad 479',
  expectedKeystrokes: 10,
  sequenceCompleted: true,
  keystrokeStamps: STAMPS,
  requestStarts: [LAST + 300],
  ...over
});

test('B2 PASS: 1 request ~300 ms después de la última tecla', () => {
  const r = evaluateDebounce(m());
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /300 ms después de la última tecla/);
});

test('B2 PASS: borde de tolerancia (900 ms) todavía pasa', () => {
  assert.equal(evaluateDebounce(m({ requestStarts: [LAST + 900] })).status, 'PASS');
});

test('B2 FAIL: ventana medida por encima de la tolerancia (901 ms y el 2500 ms de develop)', () => {
  assert.equal(evaluateDebounce(m({ requestStarts: [LAST + 901] })).status, 'FAIL');
  assert.equal(evaluateDebounce(m({ requestStarts: [LAST + 2500] })).status, 'FAIL');
});

test('B2 FAIL: sin agrupar (varias requests en la ráfaga), aunque la primera salga ANTES de la última tecla', () => {
  const r = evaluateDebounce(m({ requestStarts: [T0 + 20, LAST + 50] }));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /2 requests/);
});

test('B2 NO_EJERCIDO: la ráfaga no se completó o faltan pulsaciones', () => {
  assert.equal(evaluateDebounce(m({ sequenceCompleted: false })).status, 'NO_EJERCIDO');
  assert.equal(evaluateDebounce(m({ keystrokeStamps: STAMPS.slice(0, 4) })).status, 'NO_EJERCIDO');
});

test('B2 NO_EJERCIDO: guard de premisa, intervalo real >= ventana (cada tecla es su ráfaga)', () => {
  const lento = Array.from({ length: 10 }, (_, i) => T0 + i * 320);
  const r = evaluateDebounce(m({ keystrokeStamps: lento, requestStarts: [T0 + 9 * 320 + 300] }));
  assert.equal(r.status, 'NO_EJERCIDO');
  assert.match(r.detail, /harness/);
});

test('B2 NO_EJERCIDO: request sin sello temporal', () => {
  assert.equal(evaluateDebounce(m({ requestStarts: [null] })).status, 'NO_EJERCIDO');
});

test('B2 NO_EJERCIDO: 1 request que salió antes de la última tecla (borde de entrada)', () => {
  assert.equal(evaluateDebounce(m({ requestStarts: [T0 + 40] })).status, 'NO_EJERCIDO');
});

test('B2 SIN_DATOS: cero requests, y solo requests anteriores a la ráfaga', () => {
  assert.equal(evaluateDebounce(m({ requestStarts: [] })).status, 'SIN_DATOS');
  const r = evaluateDebounce(m({ requestStarts: [T0 - 500] }));
  assert.equal(r.status, 'SIN_DATOS');
  assert.match(r.detail, /1 anteriores/);
});

test('B2 deriveDebounce: separa tráfico heredado y mide intervalos y deltas', () => {
  const d = deriveDebounce(m({ requestStarts: [T0 + 300, T0 - 10, LAST + 300] }));
  assert.equal(d.callsTotal, 3);
  assert.equal(d.callsInBurst, 2);
  assert.equal(d.callsBeforeBurst, 1);
  assert.equal(d.minIntervalMs, 80);
  assert.equal(d.maxIntervalMs, 80);
  assert.equal(d.delayFromFirstKeystrokeMs, 300);
  assert.equal(d.delayFromLastKeystrokeMs, 300 - 720);
});
