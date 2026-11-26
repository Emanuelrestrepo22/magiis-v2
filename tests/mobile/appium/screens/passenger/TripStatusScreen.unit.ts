// Unit de TripStatusScreen (funciones puras + solo lectura), sin Appium.
// Run: npx tsx --test tests/mobile/appium/screens/passenger/TripStatusScreen.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCancelCtaLabel, normalizeTripState, readTripCode } from './TripStatusScreen.js';

const DA = 'http://localhost/navigator/DriverAvailablePages;carrierId=1;travelId=2';
const TIP = 'http://localhost/navigator/travel-in-progress';

test('normalizeTripState: SEARCHING_DRIVER por URL y por texto es/en', () => {
  assert.equal(normalizeTripState(DA), 'SEARCHING_DRIVER');
  assert.equal(normalizeTripState(DA, 'Buscando servicio...'), 'SEARCHING_DRIVER');
  assert.equal(
    normalizeTripState('http://localhost/x', 'We are looking for vehicles'),
    'SEARCHING_DRIVER'
  );
});

test('normalizeTripState: travel-in-progress distingue asignado, en curso y cerrando (es/en)', () => {
  assert.equal(normalizeTripState(TIP, 'Servicio Asignado'), 'WITH_DRIVER_ASSIGNED');
  assert.equal(normalizeTripState(TIP, 'Driver Assigned'), 'WITH_DRIVER_ASSIGNED');
  assert.equal(normalizeTripState(TIP, '¡Viaje  en curso!'), 'IN_PROGRESS');
  assert.equal(normalizeTripState(TIP, 'Trip in Progress!'), 'IN_PROGRESS');
  assert.equal(normalizeTripState(TIP, '¡Cerrando Viaje!'), 'CLOSING_TRAVEL');
  assert.equal(normalizeTripState(TIP, 'Closing Trip!'), 'CLOSING_TRAVEL');
});

test('normalizeTripState: sin texto legible usa el statusPage de la URL', () => {
  assert.equal(normalizeTripState(`${TIP};statusPage=GOING_TO_CLIENT`), 'GOING_TO_CLIENT');
  assert.equal(normalizeTripState(`${TIP};statusPage=GOING_TO_DESTINATION`), 'IN_PROGRESS');
  assert.equal(normalizeTripState(TIP, ''), 'UNKNOWN');
});

test('normalizeTripState: home -> NONE; login/otras -> UNKNOWN', () => {
  assert.equal(normalizeTripState('http://localhost/navigator/HomePage', 'Modo Personal'), 'NONE');
  assert.equal(normalizeTripState('http://localhost/login'), 'UNKNOWN');
  assert.equal(normalizeTripState(''), 'UNKNOWN');
});

test('readTripCode: código <n>-<letra> o null', () => {
  assert.equal(readTripCode('Viaje 4885-a en busca'), '4885-a');
  assert.equal(readTripCode('sin código'), null);
});

test('isCancelCtaLabel: es/en, no confunde otros botones', () => {
  assert.equal(isCancelCtaLabel('Cancelar Viaje '), true);
  assert.equal(isCancelCtaLabel('Cancel Trip'), true);
  assert.equal(isCancelCtaLabel('Llamar'), false);
  assert.equal(isCancelCtaLabel('Cancelar'), false);
});

test('SEGURIDAD (estático): TripStatusScreen no hace click/tap ni toca controles', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./TripStatusScreen.ts', import.meta.url)),
    'utf8'
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.click\(|\.tap\(|dispatchEvent|\.setValue\(|\.addValue\(/.test(code));
});
