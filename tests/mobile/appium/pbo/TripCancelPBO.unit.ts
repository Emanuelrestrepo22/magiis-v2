// Unit de TripCancelPBO con screens fake (sin Appium): gate, estados no cancelables, diálogo, costo y home.
// Run: npx tsx --test tests/mobile/appium/pbo/TripCancelPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TripStatus } from '../screens/passenger/TripStatusScreen.js';
import {
  IrreversibleNotConfirmedError,
  TripCancelFailedError,
  TripCancelPBO,
  TripNotCancellableError,
  planTripCancelRun,
  type TripCancelPboDeps
} from './TripCancelPBO.js';

const HOME = 'http://x/navigator/HomePage';
const SEARCHING: TripStatus = {
  url: 'http://x/navigator/DriverAvailablePages;travelId=9',
  state: 'SEARCHING_DRIVER',
  tripCode: '4885-a',
  cancelCtaVisible: true
};
const AT_HOME: TripStatus = { url: HOME, state: 'NONE', tripCode: null, cancelCtaVisible: false };
const IN_PROGRESS: TripStatus = {
  url: 'http://x/navigator/travel-in-progress',
  state: 'IN_PROGRESS',
  tripCode: null,
  cancelCtaVisible: false
};
const DIALOG = {
  text: 'Atención ¿Desea cancelar el Viaje?',
  buttons: ['Si', 'No']
};

type Opts = {
  reads: TripStatus[];
  tapCta?: boolean;
  dialog?: { text: string; buttons: string[] } | null;
  tapConfirm?: boolean;
};

function build(o: Opts) {
  const calls: string[] = [];
  let i = 0;
  const deps: TripCancelPboDeps = {
    status: {
      readStatus: async () => {
        calls.push('read');
        return o.reads[Math.min(i++, o.reads.length - 1)]!;
      }
    },
    cancel: {
      tapCancelCta: async () => {
        calls.push('tapCta');
        return o.tapCta ?? true;
      },
      readCancelDialog: async () => {
        calls.push('readDialog');
        return o.dialog === undefined ? DIALOG : o.dialog;
      },
      tapDialogConfirm: async () => {
        calls.push('tapConfirm');
        return o.tapConfirm ?? true;
      }
    }
  };
  return { pbo: new TripCancelPBO(deps, { log: () => undefined, pollIntervalMs: 1 }), calls };
}

test('gate: sin { confirmed: true } lanza ANTES de leer o tocar nada', async () => {
  const { pbo, calls } = build({ reads: [SEARCHING] });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: false }),
    IrreversibleNotConfirmedError
  );
  await assert.rejects(
    () => pbo.cancelActiveTrip(undefined as unknown as { confirmed: boolean }),
    IrreversibleNotConfirmedError
  );
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: 'yes' } as unknown as { confirmed: boolean }),
    IrreversibleNotConfirmedError
  );
  assert.deepEqual(calls, []);
});

test('cancelación feliz: CTA -> diálogo -> «Si» -> home estable', async () => {
  const { pbo, calls } = build({ reads: [SEARCHING, AT_HOME] });
  const r = await pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 500 });
  assert.equal(r.cancelled, true);
  assert.equal(r.landedOnHome, true);
  assert.equal(r.fromState, 'SEARCHING_DRIVER');
  assert.equal(r.tripCode, '4885-a');
  assert.equal(r.cancellationCost, null);
  assert.deepEqual(calls.slice(0, 4), ['read', 'tapCta', 'readDialog', 'tapConfirm']);
});

test('aviso de costo de cancelación: se devuelve en el resultado, no se oculta', async () => {
  const { pbo } = build({
    reads: [SEARCHING, AT_HOME],
    dialog: {
      text: 'Atención ¿Desea cancelar el Viaje? La cancelación del Viaje incluye un costo de 150',
      buttons: ['Si', 'No']
    }
  });
  const r = await pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 500 });
  assert.equal(r.cancellationCost?.amount, '150');
});

test('estado no cancelable: sin viaje (NONE) o en curso sin botón -> TripNotCancellableError sin tocar', async () => {
  for (const status of [AT_HOME, IN_PROGRESS]) {
    const { pbo, calls } = build({ reads: [status] });
    await assert.rejects(
      () => pbo.cancelActiveTrip({ confirmed: true }),
      (e: unknown) => e instanceof TripNotCancellableError && e.state === status.state
    );
    assert.ok(!calls.includes('tapCta') && !calls.includes('tapConfirm'));
  }
});

test('el botón no se puede tocar -> TripCancelFailedError(cta), sin tocar «Si»', async () => {
  const { pbo, calls } = build({ reads: [SEARCHING], tapCta: false });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: true }),
    (e: unknown) => e instanceof TripCancelFailedError && e.step === 'cta'
  );
  assert.ok(!calls.includes('tapConfirm'));
});

test('el diálogo no aparece -> TripCancelFailedError(dialog), sin tocar «Si»', async () => {
  const { pbo, calls } = build({ reads: [SEARCHING], dialog: null });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 30 }),
    (e: unknown) => e instanceof TripCancelFailedError && e.step === 'dialog'
  );
  assert.ok(!calls.includes('tapConfirm'));
});

test('«Si» no tocable -> TripCancelFailedError(confirm) con los botones vistos', async () => {
  const { pbo } = build({ reads: [SEARCHING], tapConfirm: false });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: true }),
    (e: unknown) =>
      e instanceof TripCancelFailedError && e.step === 'confirm' && /Si \| No/.test(e.message)
  );
});

test('la app sigue en el viaje tras confirmar -> TripCancelFailedError(leave) con aviso manual', async () => {
  const { pbo } = build({ reads: [SEARCHING] });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 40 }),
    (e: unknown) =>
      e instanceof TripCancelFailedError && e.step === 'leave' && /MANUALMENTE/.test(e.message)
  );
});

test('post-cancelación fuera de home: cancelled true pero landedOnHome false', async () => {
  const other: TripStatus = {
    url: 'http://x/navigator/otra',
    state: 'UNKNOWN',
    tripCode: null,
    cancelCtaVisible: false
  };
  const { pbo } = build({ reads: [SEARCHING, other] });
  const r = await pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 500 });
  assert.equal(r.cancelled, true);
  assert.equal(r.landedOnHome, false);
});

test('UNKNOWN dentro de travel-in-progress no cuenta como salida del viaje', async () => {
  const stuck: TripStatus = {
    url: 'http://x/navigator/travel-in-progress',
    state: 'UNKNOWN',
    tripCode: null,
    cancelCtaVisible: false
  };
  const { pbo } = build({ reads: [SEARCHING, stuck] });
  await assert.rejects(
    () => pbo.cancelActiveTrip({ confirmed: true }, { timeoutMs: 40 }),
    TripCancelFailedError
  );
});

test('planTripCancelRun: solo abre con compuerta + entorno test + sin viaje activo previo', () => {
  const none = { active: false, url: HOME };
  assert.deepEqual(planTripCancelRun({ gateOpen: true, environment: 'test', preCheck: none }), {
    proceed: true
  });
  const closed = planTripCancelRun({ gateOpen: false, environment: 'test', preCheck: none });
  assert.equal(closed.proceed, false);
  const uat = planTripCancelRun({ gateOpen: true, environment: 'uat', preCheck: none });
  assert.equal(uat.proceed, false);
  assert.match(uat.proceed ? '' : uat.reason, /solo corren en test/);
  const foreign = planTripCancelRun({
    gateOpen: true,
    environment: 'test',
    preCheck: { active: true, url: 'http://x/DriverAvailablePages' }
  });
  assert.equal(foreign.proceed, false);
  assert.match(foreign.proceed ? '' : foreign.reason, /ya tiene un viaje activo/);
});

test('SEGURIDAD (estático): TripCancelPBO no lee process.env ni toca «Llamar»', () => {
  const src = readFileSync(fileURLToPath(new URL('./TripCancelPBO.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(code));
  assert.ok(!/llamar/i.test(code));
});
