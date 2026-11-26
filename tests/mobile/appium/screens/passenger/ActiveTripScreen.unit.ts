// Unit de ActiveTripScreen (clasificación pura + solo lectura), sin Appium.
// Run: npx tsx --test tests/mobile/appium/screens/passenger/ActiveTripScreen.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyActiveTrip } from './ActiveTripScreen.js';

test('classifyActiveTrip: URL de DriverAvailablePages y travel-in-progress', () => {
  assert.equal(
    classifyActiveTrip('http://localhost/navigator/DriverAvailablePages;carrierId=1;travelId=2'),
    'searching-driver'
  );
  assert.equal(
    classifyActiveTrip('http://localhost/navigator/travel-in-progress;statusPage=GOING_TO_CLIENT'),
    'in-progress'
  );
});

test('classifyActiveTrip: texto «Buscando servicio» es/en cuando la URL no alcanza', () => {
  assert.equal(
    classifyActiveTrip('http://localhost/x', 'Buscando servicio...'),
    'searching-driver'
  );
  assert.equal(
    classifyActiveTrip('http://localhost/x', 'We are looking for vehicles'),
    'searching-driver'
  );
});

test('classifyActiveTrip: home, login y vacío no son viaje activo', () => {
  assert.equal(classifyActiveTrip('http://localhost/navigator/HomePage', 'Modo Personal'), null);
  assert.equal(classifyActiveTrip('http://localhost/login'), null);
  assert.equal(classifyActiveTrip(''), null);
});

test('SEGURIDAD (estático): ActiveTripScreen no hace click/tap ni toca controles', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./ActiveTripScreen.ts', import.meta.url)),
    'utf8'
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\.click\(|\.tap\(|dispatchEvent|\.setValue\(|\.addValue\(/.test(code));
});
