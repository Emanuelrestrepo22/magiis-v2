// Unit de ActiveTripPBO con screen fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/pbo/ActiveTripPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveTripSnapshot } from '../screens/passenger/ActiveTripScreen.js';
import { ActiveTripPBO } from './ActiveTripPBO.js';

const HOME: ActiveTripSnapshot = { url: 'http://x/navigator/HomePage', text: 'Modo Personal' };
const SEARCHING: ActiveTripSnapshot = {
  url: 'http://x/navigator/DriverAvailablePages;travelId=9',
  text: 'Buscando servicio...'
};

function build(script: Array<ActiveTripSnapshot | Error>) {
  let reads = 0;
  const pbo = new ActiveTripPBO(
    {
      screen: {
        readSnapshot: async () => {
          const next = script[Math.min(reads++, script.length - 1)]!;
          if (next instanceof Error) throw next;
          return next;
        }
      }
    },
    { pollIntervalMs: 1 }
  );
  return { pbo, reads: () => reads };
}

test('observeActiveTrip: viaje activo estable en lecturas consecutivas', async () => {
  const { pbo } = build([SEARCHING]);
  const o = await pbo.observeActiveTrip({ timeoutMs: 500 });
  assert.deepEqual(o, { active: true, kind: 'searching-driver', url: SEARCHING.url });
});

test('observeActiveTrip: home que luego redirige exige estabilidad', async () => {
  const { pbo } = build([HOME, SEARCHING, SEARCHING]);
  assert.equal((await pbo.observeActiveTrip({ timeoutMs: 500 })).active, true);
});

test('observeActiveTrip: una lectura positiva suelta y luego home -> no activo', async () => {
  const { pbo } = build([SEARCHING, HOME]);
  const o = await pbo.observeActiveTrip({ timeoutMs: 80 });
  assert.equal(o.active, false);
  assert.equal(o.url, HOME.url);
});

test('observeActiveTrip: solo home -> no activo; los errores de lectura no lanzan', async () => {
  const { pbo } = build([new Error('webview caído'), HOME]);
  const o = await pbo.observeActiveTrip({ timeoutMs: 60 });
  assert.equal(o.active, false);
  assert.equal(o.kind, null);
});

test('readOnce: una sola lectura, sin espera', async () => {
  const { pbo, reads } = build([SEARCHING]);
  assert.equal((await pbo.readOnce()).kind, 'searching-driver');
  assert.equal(reads(), 1);
});
