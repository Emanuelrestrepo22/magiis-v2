// Unit del adaptador superficie -> AddressFieldTarget con un SurfacePort fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/address/surfaceFieldTarget.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import { FIRST_PREDICTION_FALLBACK_LABEL, surfaceToFieldTarget } from './surfaceFieldTarget.js';
import type { ReachedSurface } from './surfaceFieldTarget.js';
import type { FieldState, SurfacePort } from './surfaces/index.js';

const SURFACE = { id: 'S3', label: 'Home · Agregar otro destino' } as const;
const REACH: ReachedSurface = { reachable: true, fieldSelector: 'input.x', detail: 'ok' };
const DRIVER = { sentinel: true } as unknown as Browser;

function fakePort(over: { tapOk?: boolean; value?: string } = {}): {
  port: SurfacePort;
  taps: string[];
  reads: string[];
} {
  const taps: string[] = [];
  const reads: string[] = [];
  const port = {
    tapCss: async (selector: string): Promise<boolean> => {
      taps.push(selector);
      return over.tapOk ?? true;
    },
    fieldState: async (selector: string): Promise<FieldState> => {
      reads.push(selector);
      return { present: true, readOnly: false, value: over.value ?? '' };
    }
  } as unknown as SurfacePort;
  return { port, taps, reads };
}

test('copia id, label y driver, y fija el selector del reach', () => {
  const { port } = fakePort();
  const target = surfaceToFieldTarget(SURFACE, port, REACH, DRIVER);
  assert.equal(target.id, 'S3');
  assert.equal(target.label, SURFACE.label);
  assert.equal(target.driver, DRIVER);
  assert.equal(target.fieldSelector(), 'input.x');
});

test('selectFirstPrediction toca la predicción con tap nativo y devuelve el valor del campo', async () => {
  const { port, taps, reads } = fakePort({ value: ' Arenales 1233 ' });
  const target = surfaceToFieldTarget(SURFACE, port, REACH, DRIVER);
  assert.equal(await target.selectFirstPrediction(), 'Arenales 1233');
  assert.deepEqual(taps, ['ion-item.prediction-item']);
  assert.deepEqual(reads, ['input.x']);
});

test('selectFirstPrediction usa el rótulo por defecto si el campo queda vacío', async () => {
  const { port } = fakePort({ value: '   ' });
  const target = surfaceToFieldTarget(SURFACE, port, REACH, DRIVER);
  assert.equal(await target.selectFirstPrediction(), FIRST_PREDICTION_FALLBACK_LABEL);
});

test('selectFirstPrediction devuelve null (y no lee el campo) si no hay predicción tocable', async () => {
  const { port, reads } = fakePort({ tapOk: false });
  const target = surfaceToFieldTarget(SURFACE, port, REACH, DRIVER);
  assert.equal(await target.selectFirstPrediction(), null);
  assert.deepEqual(reads, []);
});
