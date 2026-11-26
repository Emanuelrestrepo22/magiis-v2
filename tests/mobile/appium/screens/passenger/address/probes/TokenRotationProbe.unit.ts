// Unit de B7 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/TokenRotationProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTokenRotation,
  selectionPopulated,
  type TokenRotationMeasurements
} from './TokenRotationProbe.js';

const completo: TokenRotationMeasurements = {
  term: 'libertad 479',
  termAfter: 'libertad 47',
  typed: true,
  tokensBefore: ['T1'],
  picked: 'Libertad 479, CABA',
  valueBefore: 'libertad 479',
  valueAfter: 'Libertad 479, Buenos Aires',
  typedAfter: true,
  tokensAfter: ['T2']
};
const m = (over: Partial<TokenRotationMeasurements>): TokenRotationMeasurements => ({
  ...completo,
  ...over
});

test('B7 PASS: el token cambia tras seleccionar', () => {
  const r = evaluateTokenRotation(completo);
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /T1 -> T2/);
});

test('B7 FAIL: el mismo token sigue vigente tras seleccionar', () => {
  assert.equal(evaluateTokenRotation(m({ tokensAfter: ['T1'] })).status, 'FAIL');
});

test('B7 FAIL: si el token posterior mezcla uno viejo y uno nuevo no rotó del todo', () => {
  assert.equal(evaluateTokenRotation(m({ tokensAfter: ['T2', 'T1'] })).status, 'FAIL');
});

test('B7 SIN_DATOS: el campo no aceptó el primer término', () => {
  assert.equal(
    evaluateTokenRotation({ term: 'x', termAfter: 'y', typed: false, tokensBefore: [] }).status,
    'SIN_DATOS'
  );
});

test('B7 NO_EJERCIDO: no había predicción para seleccionar (no es defecto)', () => {
  assert.equal(evaluateTokenRotation(m({ picked: null })).status, 'NO_EJERCIDO');
});

test('B7 SIN_DATOS: el tap no pobló el campo (la selección no ocurrió: límite del harness)', () => {
  const r = evaluateTokenRotation(m({ valueAfter: 'libertad 479' }));
  assert.equal(r.status, 'SIN_DATOS');
  assert.match(r.detail, /NO un defecto/);
  assert.equal(evaluateTokenRotation(m({ valueAfter: '' })).status, 'SIN_DATOS');
});

test('B7 SIN_DATOS: tras seleccionar el campo no acepta la segunda consulta', () => {
  assert.equal(evaluateTokenRotation(m({ typedAfter: false })).status, 'SIN_DATOS');
  assert.equal(evaluateTokenRotation(m({ typedAfter: undefined })).status, 'SIN_DATOS');
});

test('B7 SIN_DATOS: falta un lado de la comparación', () => {
  assert.equal(evaluateTokenRotation(m({ tokensBefore: [] })).status, 'SIN_DATOS');
  assert.equal(evaluateTokenRotation(m({ tokensAfter: [] })).status, 'SIN_DATOS');
});

test('B7 selectionPopulated: vacío o sin cambio no es selección', () => {
  assert.equal(selectionPopulated('a', 'b'), true);
  assert.equal(selectionPopulated('a', 'a'), false);
  assert.equal(selectionPopulated('a', ''), false);
});
