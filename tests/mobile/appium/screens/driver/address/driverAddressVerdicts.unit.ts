// Unit de los veredictos puros del buscador de direcciones del Chofer. Run: npx tsx --test tests/mobile/appium/screens/driver/address/driverAddressVerdicts.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseFromProbe,
  deriveMinLengthCases,
  distanceKm,
  evaluateDegradation,
  evaluateDriverTokenRotation,
  evaluateEmptyState,
  evaluateOrder,
  evaluateRequestContract
} from './driverAddressVerdicts.js';
import { isTripContextUrl } from './AddressSearchScreen.js';

const URL_OK =
  'https://x/places/autocomplete?address=corrientes&latitude=-34.6&longitude=-58.4&sessionToken=abc';

test('TM-651: PASS con address+coordenadas y sin radius/language', () => {
  assert.equal(evaluateRequestContract([URL_OK]).status, 'PASS');
});

test('TM-651: FAIL si falta una coordenada, si sobra radius o language, y SIN_DATOS sin requests', () => {
  assert.equal(
    evaluateRequestContract(['https://x/places/autocomplete?address=a&latitude=1']).status,
    'FAIL'
  );
  assert.equal(evaluateRequestContract([`${URL_OK}&radius=10`]).status, 'FAIL');
  assert.equal(evaluateRequestContract([`${URL_OK}&language=es`]).status, 'FAIL');
  assert.equal(evaluateRequestContract([]).status, 'SIN_DATOS');
});

test('TM-656/657: piso de 3 con prueba de vida', () => {
  const ok = [
    { length: 1, text: 's', calls: 0 },
    { length: 2, text: 'sa', calls: 0 },
    { length: 3, text: 'san', calls: 1 },
    { length: 4, text: 'sant', calls: 1 }
  ];
  const r = deriveMinLengthCases(ok);
  assert.equal(r.tm656.status, 'PASS');
  assert.equal(r.tm657.status, 'PASS');
});

test('TM-656: cero llamadas en TODAS las longitudes es SIN_DATOS (campo inerte), no verde; TM-657 FAIL', () => {
  const dead = [1, 2, 3, 4].map((length) => ({ length, text: 'x'.repeat(length), calls: 0 }));
  const r = deriveMinLengthCases(dead);
  assert.equal(r.tm656.status, 'SIN_DATOS');
  assert.equal(r.tm657.status, 'FAIL');
});

test('TM-656/657: consulta con 2 caracteres es FAIL; campo que rechaza texto es SIN_DATOS', () => {
  const early = [
    { length: 2, text: 'sa', calls: 2 },
    { length: 3, text: 'san', calls: 1 }
  ];
  assert.equal(deriveMinLengthCases(early).tm656.status, 'FAIL');
  const rejected = [
    { length: 2, text: 'sa', calls: -1 },
    { length: 3, text: 'san', calls: -1 }
  ];
  const r = deriveMinLengthCases(rejected);
  assert.equal(r.tm656.status, 'SIN_DATOS');
  assert.equal(r.tm657.status, 'SIN_DATOS');
});

const EMPTY_BASE = {
  term: 'zzz',
  calls: 1,
  httpStatus: 200,
  rows: 0,
  parseError: null,
  itemsOnScreen: 0,
  loaders: [],
  errors: [],
  fieldUsable: true
};

test('TM-664: PASS en el estado vacío limpio y FAIL por status, filas, error, spinner o campo muerto', () => {
  assert.equal(evaluateEmptyState(EMPTY_BASE).status, 'PASS');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, calls: 0 }).status, 'SIN_DATOS');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, httpStatus: 500 }).status, 'FAIL');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, rows: 2 }).status, 'FAIL');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, errors: ['x'] }).status, 'FAIL');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, loaders: ['ion-spinner'] }).status, 'FAIL');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, fieldUsable: false }).status, 'FAIL');
  assert.equal(evaluateEmptyState({ ...EMPTY_BASE, parseError: 'x' }).status, 'FAIL');
});

test('ORDEN: FAIL si el aeropuerto va antes que la caché; PASS al revés; sin aeropuertos NO es verde', () => {
  const origin = { lat: -34.6, lng: -58.4 };
  const air = {
    mainText: 'Aeroparque',
    source: 'AIRPORT',
    airport: true,
    latitude: '-34.55',
    longitude: '-58.41'
  };
  const cache = { mainText: 'Caza 12', source: 'CACHE', latitude: '-34.6', longitude: '-58.4' };
  assert.equal(
    evaluateOrder({ term: 'caza', calls: 1, rows: [air, cache], origin }).status,
    'FAIL'
  );
  assert.equal(
    evaluateOrder({ term: 'caza', calls: 1, rows: [cache, air], origin }).status,
    'PASS'
  );
  assert.equal(
    evaluateOrder({ term: 'caza', calls: 1, rows: [cache], origin }).status,
    'NO_EJERCIDO'
  );
  assert.equal(
    evaluateOrder({ term: 'caza', calls: 1, rows: [air], origin }).status,
    'NO_EJERCIDO'
  );
  assert.equal(evaluateOrder({ term: 'caza', calls: 0, rows: [], origin }).status, 'SIN_DATOS');
});

test('distanceKm: Buenos Aires - Córdoba ~ 646 km', () => {
  const km = distanceKm(-34.6037, -58.3816, -31.4201, -64.1888);
  assert.ok(km > 630 && km < 660, String(km));
});

test('TM-663: rota (PASS), no rota (FAIL) y secuencias incompletas son NO_EJERCIDO', () => {
  const base = {
    typed: true,
    tokensBefore: ['a'],
    picked: 'Calle 1',
    searchClosed: true,
    reopened: true,
    typedAfter: true
  };
  assert.equal(evaluateDriverTokenRotation({ ...base, tokensAfter: ['b'] }).status, 'PASS');
  assert.equal(evaluateDriverTokenRotation({ ...base, tokensAfter: ['a'] }).status, 'FAIL');
  assert.equal(evaluateDriverTokenRotation({ ...base, picked: null }).status, 'NO_EJERCIDO');
  assert.equal(evaluateDriverTokenRotation({ ...base, searchClosed: false }).status, 'NO_EJERCIDO');
  assert.equal(evaluateDriverTokenRotation({ ...base, reopened: false }).status, 'NO_EJERCIDO');
  assert.equal(evaluateDriverTokenRotation({ ...base, tokensAfter: [] }).status, 'SIN_DATOS');
  assert.equal(evaluateDriverTokenRotation({ ...base, tokensBefore: [] }).status, 'SIN_DATOS');
});

const SC = {
  name: '503',
  faultHits: 1,
  googleNewResources: 0,
  googleXhr: 0,
  itemsOnScreen: 0,
  loaderVisible: false,
  errorShown: false
};

test('TM-665: PASS sin Google y con match; FAIL con Google; NO_EJERCIDO sin match; SIN_DATOS sin sonda', () => {
  assert.equal(evaluateDegradation([SC]).status, 'PASS');
  assert.equal(evaluateDegradation([{ ...SC, googleNewResources: 2 }]).status, 'FAIL');
  assert.equal(evaluateDegradation([{ ...SC, googleXhr: 1 }]).status, 'FAIL');
  assert.equal(evaluateDegradation([{ ...SC, faultHits: 0 }]).status, 'NO_EJERCIDO');
  assert.equal(evaluateDegradation([{ ...SC, faultHits: null }]).status, 'NO_EJERCIDO');
  assert.equal(evaluateDegradation([{ ...SC, googleNewResources: -1 }]).status, 'SIN_DATOS');
  assert.equal(evaluateDegradation([]).status, 'SIN_DATOS');
  assert.match(evaluateDegradation([{ ...SC, loaderVisible: true }]).detail, /indicador de carga/);
});

test('caseFromProbe conserva status, detalle, mediciones y nivel de la probe de PAX', () => {
  const r = caseFromProbe('TM-650', 'x', {
    behavior: 'B1',
    title: 't',
    level: 'mechanism',
    reportableAsBug: false,
    status: 'FAIL',
    detail: 'd',
    measured: { a: 1 }
  });
  assert.deepEqual(
    { key: r.key, status: r.status, verdict: r.verdict, level: r.level, measured: r.measured },
    { key: 'TM-650', status: 'FAIL', verdict: 'd', level: 'mechanism', measured: { a: 1 } }
  );
});

test('isTripContextUrl: viaje en curso y edición sí; home y login no', () => {
  assert.equal(isTripContextUrl('http://localhost/navigator/TravelInProgressPage'), true);
  assert.equal(isTripContextUrl('http://localhost/travel-edit'), true);
  assert.equal(isTripContextUrl('http://localhost/navigator/home;FROM_LOGIN=true'), false);
  assert.equal(isTripContextUrl('http://localhost/login'), false);
});
