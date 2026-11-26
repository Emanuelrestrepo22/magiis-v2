// Unit de NewTripPBO con deps fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/pbo/NewTripPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AddressPrediction,
  ConfirmCtaState,
  TripField
} from '../screens/passenger/NewTripScreen.js';
import {
  NewTripFieldError,
  NewTripFormNotFoundError,
  NewTripPBO,
  NoAddressPredictionsError,
  type NewTripPboDeps
} from './NewTripPBO.js';

type World = {
  shown: boolean;
  /** Predicciones por campo (tras tipear). */
  predictions: Record<TripField, AddressPrediction[]>;
  originReadonlyAtStart: boolean;
  trash: boolean;
  typeOk: boolean;
  cta: ConfirmCtaState;
  modal: boolean;
};

const pred = (main: string, secondary = ''): AddressPrediction => ({
  index: 0,
  main,
  secondary,
  text: `${main} ${secondary}`.trim()
});

function build(over: Partial<World> = {}) {
  const w: World = {
    shown: true,
    predictions: {
      origin: [pred('Calle A', 'Ciudad'), pred('Obelisco', 'Buenos Aires')],
      destination: [pred('Aeroparque', 'CABA')]
    },
    originReadonlyAtStart: false,
    trash: true,
    typeOk: true,
    cta: { present: true, visible: true, enabled: true, text: 'Seleccionar Vehículo' },
    modal: false,
    ...over
  };
  const calls: string[] = [];
  const typed: Record<TripField, string> = { origin: '', destination: '' };
  const values: Record<TripField, string> = { origin: '', destination: '' };
  const readonly: Record<TripField, boolean> = {
    origin: w.originReadonlyAtStart,
    destination: false
  };
  const form: NewTripPboDeps['form'] = {
    isFormShown: async () => w.shown,
    isFieldReadonly: async (f) => readonly[f],
    readFieldValue: async (f) => values[f],
    typeAddress: async (f, text) => {
      calls.push(`type:${f}:${text}`);
      typed[f] = text;
      return w.typeOk;
    },
    clearOrigin: async () => {
      calls.push('clearOrigin');
      if (!w.trash) return false;
      readonly.origin = false;
      values.origin = '';
      return true;
    },
    readPredictions: async (f) => (typed[f] ? w.predictions[f] : []),
    selectPrediction: async (f, i) => {
      calls.push(`select:${f}:${i}`);
      const p = w.predictions[f][i];
      if (!p) return false;
      values[f] = `${p.main}, ${p.secondary}`;
      readonly[f] = true;
      return true;
    },
    dismissKeyboard: async () => {
      calls.push('blur');
    },
    readConfirmCta: async () => w.cta,
    isTripBlockModalShown: async () => w.modal
  };
  const pbo = new NewTripPBO({ form }, () => undefined, { pollIntervalMs: 1 });
  return { pbo, calls, values };
}

test('prepareTrip: elige por texto, devuelve valores leídos y CTA habilitado (sin tocar el CTA)', async () => {
  const { pbo, calls } = build();
  const out = await pbo.prepareTrip(
    { origin: { query: 'Obelisco Buenos Aires', pick: 'Obelisco' }, destination: 'Aeroparque' },
    { timeoutMs: 300 }
  );
  assert.deepEqual(out, {
    originValue: 'Obelisco, Buenos Aires',
    destinationValue: 'Aeroparque, CABA',
    confirmEnabled: true
  });
  assert.deepEqual(calls, [
    'type:origin:Obelisco Buenos Aires',
    'select:origin:1',
    'type:destination:Aeroparque',
    'select:destination:0',
    'blur'
  ]);
});

test('prepareTrip: origen auto-geolocalizado (readonly) se limpia antes de escribir', async () => {
  const { pbo, calls } = build({ originReadonlyAtStart: true });
  await pbo.prepareTrip({ origin: 'Obelisco', destination: 'Aeroparque' }, { timeoutMs: 300 });
  assert.deepEqual(calls.slice(0, 2), ['clearOrigin', 'type:origin:Obelisco']);
});

test('prepareTrip: origen readonly sin papelera -> NewTripFieldError', async () => {
  const { pbo } = build({ originReadonlyAtStart: true, trash: false });
  await assert.rejects(
    pbo.prepareTrip({ origin: 'Obelisco', destination: 'Aeroparque' }, { timeoutMs: 100 }),
    (e: unknown) => e instanceof NewTripFieldError && e.field === 'origin'
  );
});

test('prepareTrip: sin predicciones -> NoAddressPredictionsError con el campo', async () => {
  const { pbo } = build({
    predictions: { origin: [pred('Obelisco', 'BA')], destination: [] }
  });
  await assert.rejects(
    pbo.prepareTrip({ origin: 'Obelisco', destination: 'Zzzzzz' }, { timeoutMs: 80 }),
    (e: unknown) =>
      e instanceof NoAddressPredictionsError && e.field === 'destination' && e.query === 'Zzzzzz'
  );
});

test('prepareTrip: formulario ausente -> NewTripFormNotFoundError', async () => {
  const { pbo, calls } = build({ shown: false });
  await assert.rejects(
    pbo.prepareTrip({ origin: 'Obelisco', destination: 'Aeroparque' }, { timeoutMs: 60 }),
    NewTripFormNotFoundError
  );
  assert.deepEqual(calls, []);
});

test('prepareTrip: texto de menos de 3 caracteres se rechaza sin escribir', async () => {
  const { pbo, calls } = build();
  await assert.rejects(
    pbo.prepareTrip({ origin: 'Ob', destination: 'Aeroparque' }, { timeoutMs: 80 }),
    (e: unknown) => e instanceof NewTripFieldError && e.field === 'origin'
  );
  assert.deepEqual(calls, []);
});

test('prepareTrip: no se pudo tipear -> NewTripFieldError', async () => {
  const { pbo } = build({ typeOk: false });
  await assert.rejects(
    pbo.prepareTrip({ origin: 'Obelisco', destination: 'Aeroparque' }, { timeoutMs: 80 }),
    NewTripFieldError
  );
});

test('prepareTrip: CTA deshabilitado o ausente -> confirmEnabled false (sin lanzar)', async () => {
  const disabled = build({ cta: { present: true, visible: true, enabled: false, text: 'x' } });
  const a = await disabled.pbo.prepareTrip(
    { origin: 'Obelisco', destination: 'Aeroparque' },
    { timeoutMs: 100 }
  );
  assert.equal(a.confirmEnabled, false);
  const absent = build({ cta: { present: false, visible: false, enabled: false, text: '' } });
  const b = await absent.pbo.prepareTrip(
    { origin: 'Obelisco', destination: 'Aeroparque' },
    { timeoutMs: 100 }
  );
  assert.equal(b.confirmEnabled, false);
});

test('leaveWithoutConfirming: quita foco y limpia el origen; no lanza aunque falle', async () => {
  const { pbo, calls } = build();
  await pbo.leaveWithoutConfirming();
  assert.deepEqual(calls, ['blur', 'clearOrigin']);

  const broken = new NewTripPBO(
    {
      form: {
        ...build().pbo['deps'].form,
        dismissKeyboard: async () => {
          throw new Error('x');
        },
        clearOrigin: async () => {
          throw new Error('y');
        }
      }
    },
    () => undefined
  );
  await broken.leaveWithoutConfirming();
});

test('SEGURIDAD: NewTripPBO no tiene métodos que confirmen, paguen ni toquen el CTA', () => {
  const methods = Object.getOwnPropertyNames(NewTripPBO.prototype).filter(
    (n) => n !== 'constructor'
  );
  assert.ok(
    !methods.some((n) => /^(confirm|pay|select(Payment|Vehicle)|tap|click|book|request)/i.test(n)),
    `métodos: ${methods.join(', ')}`
  );
  const deps = Object.keys(build().pbo['deps'].form);
  assert.ok(!deps.some((n) => /^(tap|click|confirm)/i.test(n)));
});

test('hasActiveTripBlock y readConfirmCta delegan en la screen', async () => {
  const { pbo } = build({ modal: true });
  assert.equal(await pbo.hasActiveTripBlock(), true);
  assert.equal((await pbo.readConfirmCta()).enabled, true);
});
