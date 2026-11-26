// Unit de B1 (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/OwnEndpointProbe.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOwnEndpoint, evaluateRequestParams } from './OwnEndpointProbe.js';

const OWN = ['https://api/places/autocomplete?address=lib&latitude=1&longitude=2'];
const GOOGLE = ['https://maps.googleapis.com/maps/api/place/autocomplete/json?input=lib'];
const base = { term: 'libertad 479' };

test('B1 SIN_DATOS: cero requests propios y de Google (nunca PASS por ausencia)', () => {
  const r = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: [],
    googleUrls: [],
    googleSdkResourcesDelta: 0
  });
  assert.equal(r.status, 'SIN_DATOS');
});

test('B1 SIN_DATOS: cero requests y lectura del SDK no disponible', () => {
  const r = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: [],
    googleUrls: [],
    googleSdkResourcesDelta: null
  });
  assert.equal(r.status, 'SIN_DATOS');
});

test('B1 FAIL: request a Google por fetch/XHR, con o sin endpoint propio', () => {
  assert.equal(
    evaluateOwnEndpoint({
      ...base,
      autocompleteUrls: OWN,
      googleUrls: GOOGLE,
      googleSdkResourcesDelta: 0
    }).status,
    'FAIL'
  );
  assert.equal(
    evaluateOwnEndpoint({
      ...base,
      autocompleteUrls: [],
      googleUrls: GOOGLE,
      googleSdkResourcesDelta: 0
    }).status,
    'FAIL'
  );
});

test('B1 FAIL: el SDK de Places cargó recursos aunque fetch/XHR esté limpio', () => {
  const r = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: OWN,
    googleUrls: [],
    googleSdkResourcesDelta: 2
  });
  assert.equal(r.status, 'FAIL');
  const sinPropio = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: [],
    googleUrls: [],
    googleSdkResourcesDelta: 1
  });
  assert.equal(sinPropio.status, 'FAIL');
});

test('B1 SIN_DATOS: endpoint propio sin Google pero el SDK no se pudo leer (no se confirma)', () => {
  const r = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: OWN,
    googleUrls: [],
    googleSdkResourcesDelta: null
  });
  assert.equal(r.status, 'SIN_DATOS');
});

test('B1 PASS: endpoint propio, cero Google y SDK sin actividad', () => {
  const r = evaluateOwnEndpoint({
    ...base,
    autocompleteUrls: OWN,
    googleUrls: [],
    googleSdkResourcesDelta: 0
  });
  assert.equal(r.status, 'PASS');
});

test('TM-675 params: sin URLs es SIN_DATOS', () => {
  assert.equal(evaluateRequestParams([]).status, 'SIN_DATOS');
});

test('TM-675 params: falta el sesgo o el término es FAIL con lo que falta', () => {
  const noBias = evaluateRequestParams(['https://api/places/autocomplete?address=lib']);
  assert.equal(noBias.status, 'FAIL');
  assert.match(noBias.detail, /latitude, longitude/);
  const noAddress = evaluateRequestParams([
    'https://api/places/autocomplete?latitude=1&longitude=2'
  ]);
  assert.equal(noAddress.status, 'FAIL');
  assert.match(noAddress.detail, /address/);
});

test('TM-675 params: address + latitude + longitude es PASS', () => {
  assert.equal(evaluateRequestParams(OWN).status, 'PASS');
});
