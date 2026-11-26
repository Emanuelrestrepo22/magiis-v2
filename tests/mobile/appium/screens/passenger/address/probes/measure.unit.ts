// Unit de measure (puro, sin Appium). Run: npx tsx --test tests/mobile/appium/screens/passenger/address/probes/measure.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasQueryParam,
  isAutocompleteUrl,
  isGoogleUrl,
  queryParam,
  toEpochMs,
  toResult,
  uniq
} from './measure.js';

test('queryParam: decodifica, devuelve vacío si falta y tolera % inválido', () => {
  const url =
    'https://x/places/autocomplete?address=libertad%20479&sessionToken=abc&latitude=-34.6';
  assert.equal(queryParam(url, 'address'), 'libertad 479');
  assert.equal(queryParam(url, 'sessionToken'), 'abc');
  assert.equal(queryParam(url, 'longitude'), '');
  assert.equal(queryParam('https://x?address=%E0%A4%A', 'address'), '%E0%A4%A');
});

test('hasQueryParam: distingue el parámetro del prefijo de otro', () => {
  assert.equal(hasQueryParam('https://x?latitude=1&longitude=2', 'latitude'), true);
  assert.equal(hasQueryParam('https://x?mylatitude=1', 'latitude'), false);
});

test('toEpochMs: ISO válido, inválido y ausente', () => {
  assert.equal(toEpochMs('2026-08-12T10:00:00.000Z'), Date.parse('2026-08-12T10:00:00.000Z'));
  assert.equal(toEpochMs('no-es-fecha'), null);
  assert.equal(toEpochMs(undefined), null);
});

test('isAutocompleteUrl / isGoogleUrl', () => {
  assert.equal(isAutocompleteUrl('https://api/places/autocomplete?address=a'), true);
  assert.equal(isAutocompleteUrl('https://api/places/getPlace?placeId=a'), false);
  assert.equal(isGoogleUrl('https://maps.googleapis.com/maps/api/place/autocomplete'), true);
  assert.equal(isGoogleUrl('https://places.googleapis.com/v1/places:autocomplete'), true);
  assert.equal(isGoogleUrl('https://api.magiis.com/places/autocomplete'), false);
});

test('uniq conserva el orden de primera aparición', () => {
  assert.deepEqual(uniq(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']);
});

test('toResult: real-ui es reportable; mechanism NO; variant solo si existe', () => {
  const ev = { status: 'PASS', detail: 'ok' } as const;
  const real = toResult({ behavior: 'B1', title: 't' }, ev, { a: 1 });
  assert.equal(real.level, 'real-ui');
  assert.equal(real.reportableAsBug, true);
  assert.equal('variant' in real, false);
  const mech = toResult(
    { behavior: 'B8', title: 't', level: 'mechanism', variant: 'status' },
    ev,
    {}
  );
  assert.equal(mech.level, 'mechanism');
  assert.equal(mech.reportableAsBug, false);
  assert.equal(mech.variant, 'status');
});
