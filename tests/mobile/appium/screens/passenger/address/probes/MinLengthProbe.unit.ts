// Unit de B3 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/MinLengthProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateMinLength,
  firstQueryLength,
  type MinLengthMeasurements,
  type MinLengthSample
} from './MinLengthProbe.js';

/** `calls` por longitud 1..n; el texto es irrelevante para el veredicto. */
const sweep = (calls: number[]): MinLengthSample[] =>
  calls.map((c, i) => ({ length: i + 1, text: 'libertad'.slice(0, i + 1), calls: c }));

const m = (calls: number[], expectedFloor: number): MinLengthMeasurements => ({
  term: 'libertad',
  perLength: sweep(calls),
  expectedFloor
});

test('B3 PASS piso 3: no consulta con 1-2 y sí con 3', () => {
  assert.equal(evaluateMinLength(m([0, 0, 1, 1, 1, 1], 3)).status, 'PASS');
});

test('B3 PASS piso 4 (Perfil › Mis Direcciones)', () => {
  assert.equal(evaluateMinLength(m([0, 0, 0, 1, 1, 1], 4)).status, 'PASS');
});

test('B3 FAIL: consulta por debajo del piso', () => {
  const r = evaluateMinLength(m([0, 1, 1, 1, 1, 1], 3));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /por debajo del piso de 3/);
});

test('B3 FAIL: consulta recién por encima del piso (3 esperado, 4 medido: develop con `> 3`)', () => {
  const r = evaluateMinLength(m([0, 0, 0, 1, 1, 1], 3));
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /por encima del piso de 3/);
});

test('B3 SIN_DATOS: ninguna longitud consulta (no distingue campo que no consulta nunca)', () => {
  assert.equal(evaluateMinLength(m([0, 0, 0, 0, 0, 0], 3)).status, 'SIN_DATOS');
});

test('B3 SIN_DATOS: el campo rechazó todas las longitudes, o no hay mediciones', () => {
  assert.equal(evaluateMinLength(m([-1, -1, -1], 3)).status, 'SIN_DATOS');
  assert.equal(evaluateMinLength(m([], 3)).status, 'SIN_DATOS');
});

test('B3 NO_EJERCIDO: el piso coincide pero la longitud inmediatamente inferior no se pudo medir', () => {
  const r = evaluateMinLength(m([0, -1, 1, 1], 3));
  assert.equal(r.status, 'NO_EJERCIDO');
});

test('B3 firstQueryLength ignora longitudes rechazadas (-1)', () => {
  assert.equal(firstQueryLength(sweep([-1, 0, 2])), 3);
  assert.equal(firstQueryLength(sweep([0, 0])), null);
});
