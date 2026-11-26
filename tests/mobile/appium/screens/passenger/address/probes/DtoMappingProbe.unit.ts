// Unit de B5 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/DtoMappingProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDtoMapping, parseDtoBody } from './DtoMappingProbe.js';
import { CONTRACT_FIELDS } from './measure.js';

const row = (): Record<string, unknown> => ({
  placeId: 'ChIJ1',
  mainText: 'Libertad 479',
  secondaryText: 'CABA',
  shortName: 'Libertad 479',
  latitude: null,
  longitude: null,
  airport: false,
  iataCode: null,
  source: 'GOOGLE'
});
const body = (rows: unknown): string => JSON.stringify(rows);
const term = 'libertad 479';

test('B5 PASS: los 9 campos presentes (valores null legítimos cuentan como presentes)', () => {
  const r = evaluateDtoMapping({ term, responseBody: body([row()]) });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /isAirport no viene/);
});

test('B5 PASS: si vienen airport e isAirport se deja constancia', () => {
  const r = evaluateDtoMapping({ term, responseBody: body([{ ...row(), isAirport: false }]) });
  assert.equal(r.status, 'PASS');
  assert.match(r.detail, /vinieron los dos/);
});

test('B5 FAIL: falta un campo del contrato y se nombra', () => {
  const sinAirport = row();
  delete sinAirport.airport;
  const r = evaluateDtoMapping({ term, responseBody: body([sinAirport]) });
  assert.equal(r.status, 'FAIL');
  assert.match(r.detail, /airport/);
});

test('B5 FAIL: el AC dice isAirport pero el contrato real es airport (no se acepta el nombre del AC)', () => {
  const { airport, ...rest } = row();
  const r = evaluateDtoMapping({ term, responseBody: body([{ ...rest, isAirport: airport }]) });
  assert.equal(r.status, 'FAIL');
});

test('B5 SIN_DATOS: sin cuerpo, cuerpo vacío o arreglo vacío', () => {
  assert.equal(evaluateDtoMapping({ term, responseBody: null }).status, 'SIN_DATOS');
  assert.equal(evaluateDtoMapping({ term, responseBody: '   ' }).status, 'SIN_DATOS');
  assert.equal(evaluateDtoMapping({ term, responseBody: '[]' }).status, 'SIN_DATOS');
});

test('B5 NO_EJERCIDO: el cuerpo no es JSON', () => {
  assert.equal(
    evaluateDtoMapping({ term, responseBody: '<html>502</html>' }).status,
    'NO_EJERCIDO'
  );
});

test('B5 parseDtoBody: un objeto que no es arreglo da cero filas sin error', () => {
  assert.deepEqual(parseDtoBody('{"a":1}'), { parseError: null, rows: [] });
  assert.equal(CONTRACT_FIELDS.length, 9);
});
