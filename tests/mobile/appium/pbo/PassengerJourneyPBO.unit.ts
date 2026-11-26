// Unit de PassengerJourneyPBO con dobles (sin Appium): plan puro, precondiciones, gate y limpieza.
// Run: npx tsx --test tests/mobile/appium/pbo/PassengerJourneyPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TripStatus } from '../screens/passenger/TripStatusScreen.js';
import {
  IrreversibleNotConfirmedError,
  JourneyPreconditionError,
  PassengerJourneyPBO,
  planGatewayJourneyRun,
  type GatewayJourneyRunInput,
  type PassengerJourneyDeps
} from './PassengerJourneyPBO.js';
import { PaymentMethodUnavailableError } from './TripRequestPBO.js';

const OK_PLAN: GatewayJourneyRunInput = {
  gatewayGateOpen: true,
  tripGateOpen: true,
  environment: 'test',
  activeTripExists: false,
  cardAvailable: true,
  scenarioActive: true
};

test('planGatewayJourneyRun: todo abierto -> proceed', () => {
  assert.deepEqual(planGatewayJourneyRun(OK_PLAN), { proceed: true });
});

test('planGatewayJourneyRun: cada faltante cierra y lista su motivo', () => {
  const cases: Array<[Partial<GatewayJourneyRunInput>, RegExp]> = [
    [{ gatewayGateOpen: false }, /pasarela/],
    [{ tripGateOpen: false }, /creación de viaje/],
    [{ environment: 'uat' }, /«uat»/],
    [{ activeTripExists: true }, /viaje activo/],
    [{ cardAvailable: false }, /tarjeta existente/],
    [{ scenarioActive: false }, /inactivo/]
  ];
  for (const [patch, re] of cases) {
    const plan = planGatewayJourneyRun({ ...OK_PLAN, ...patch });
    assert.equal(plan.proceed, false);
    if (!plan.proceed) assert.match(plan.reason, re);
  }
  const many = planGatewayJourneyRun({
    ...OK_PLAN,
    gatewayGateOpen: false,
    environment: 'prod'
  });
  assert.equal(many.proceed, false);
  if (!many.proceed) assert.match(many.reason, /pasarela.*y.*«prod»/);
});

test('planGatewayJourneyRun: null = aún no verificado, no bloquea (compuertas previas al dispositivo)', () => {
  assert.deepEqual(
    planGatewayJourneyRun({ ...OK_PLAN, activeTripExists: null, cardAvailable: null }),
    { proceed: true }
  );
});

const SEARCHING: TripStatus = {
  url: 'http://x/navigator/DriverAvailablePages;travelId=9',
  state: 'SEARCHING_DRIVER',
  tripCode: '4885-a',
  cancelCtaVisible: true
};
const AT_HOME: TripStatus = {
  url: 'http://x/navigator/HomePage',
  state: 'NONE',
  tripCode: null,
  cancelCtaVisible: false
};

type Overrides = {
  sessionStates?: Array<'login' | 'home' | 'other' | 'unknown'>;
  proceed?: { outcome: string; message?: string };
  selectPayment?: () => Promise<unknown>;
  confirm?: () => Promise<unknown>;
  status?: TripStatus;
  cancel?: () => Promise<unknown>;
  formShown?: boolean;
};

function build(o: Overrides = {}) {
  const calls: string[] = [];
  const states = [...(o.sessionStates ?? ['home'])];
  const deps = {
    session: {
      waitForStableSessionState: async () => {
        calls.push('waitState');
        return { kind: states.length > 1 ? states.shift()! : states[0]!, url: 'u' };
      },
      loginOrFail: async () => {
        calls.push('login');
        return undefined;
      }
    },
    home: { ensureProfileMode: async () => ({ changed: false, from: 'personal', to: 'personal' }) },
    active: { observeActiveTrip: async () => ({ active: false, kind: null, url: '' }) },
    newTrip: {
      isFormShown: async () => o.formShown ?? true,
      prepareTrip: async () => {
        calls.push('prepare');
        return { originValue: 'a', destinationValue: 'b', confirmEnabled: true };
      }
    },
    request: {
      proceedToTripInfo: async () => {
        calls.push('proceed');
        return o.proceed ?? { outcome: 'trip-info' };
      },
      selectPayment:
        o.selectPayment ??
        (async () => ({
          type: 'credit-card',
          last4: '4242',
          alreadySelected: false
        })),
      confirmTrip:
        o.confirm ??
        (async () => {
          calls.push('confirm');
          return { outcome: 'created', tripCode: '4885-a' };
        })
    },
    cancel: {
      waitForState: async () => SEARCHING,
      readStatus: async () => {
        calls.push('readStatus');
        return o.status ?? SEARCHING;
      },
      cancelActiveTrip:
        o.cancel ??
        (async () => {
          calls.push('cancel');
          return { cancelled: true, landedOnHome: true };
        })
    }
  } as unknown as PassengerJourneyDeps;
  return { pbo: new PassengerJourneyPBO(deps, () => undefined), calls };
}

test('ensureSession: login vía PassengerSessionPBO y lanza si sigue en login', async () => {
  const ok = build({ sessionStates: ['login', 'home'] });
  const state = await ok.pbo.ensureSession({ email: 'e', password: 'p' });
  assert.equal(state.kind, 'home');
  assert.ok(ok.calls.includes('login'));

  const stuck = build({ sessionStates: ['login'] });
  await assert.rejects(
    stuck.pbo.ensureSession({ email: 'e', password: 'p' }),
    JourneyPreconditionError
  );
});

test('prepareTrip: lanza sin formulario y no escribe nada', async () => {
  const { pbo, calls } = build({ formShown: false });
  await assert.rejects(
    pbo.prepareTrip({ origin: 'a', destination: 'b' }),
    JourneyPreconditionError
  );
  assert.ok(!calls.includes('prepare'));
});

test('proceedToTripInfo: sin confirmed lanza antes de tocar; con aviso de bloqueo lanza precondición', async () => {
  const a = build();
  await assert.rejects(
    a.pbo.proceedToTripInfo({} as { confirmed: true }),
    IrreversibleNotConfirmedError
  );
  assert.ok(!a.calls.includes('proceed'));
  const b = build({ proceed: { outcome: 'blocked-active-trip', message: 'ya tiene viaje' } });
  await assert.rejects(b.pbo.proceedToTripInfo({ confirmed: true }), JourneyPreconditionError);
});

test('selectExistingCard: exige travel-info; tarjeta ausente -> selected:false (no lanza)', async () => {
  const early = build();
  await assert.rejects(early.pbo.selectExistingCard('4242'), JourneyPreconditionError);

  const missing = build({
    selectPayment: async () => {
      throw new PaymentMethodUnavailableError('credit-card', 'no hay tarjeta con últimos 4 4242');
    }
  });
  await missing.pbo.proceedToTripInfo({ confirmed: true });
  const r = await missing.pbo.selectExistingCard('4242');
  assert.equal(r.selected, false);
  await assert.rejects(missing.pbo.createTrip({ confirmed: true }), JourneyPreconditionError);
  assert.equal(missing.pbo.tripMayExist, false);
});

test('createTrip: sin confirmed lanza; sin tarjeta elegida lanza; no muta en ambos casos', async () => {
  const { pbo, calls } = build();
  await pbo.proceedToTripInfo({ confirmed: true });
  await assert.rejects(pbo.createTrip({} as { confirmed: true }), IrreversibleNotConfirmedError);
  await assert.rejects(pbo.createTrip({ confirmed: true }), JourneyPreconditionError);
  assert.ok(!calls.includes('confirm'));
  assert.equal(pbo.tripMayExist, false);
});

test('flujo completo: crea, observa SEARCHING_DRIVER y cancela UNA vez (idempotente)', async () => {
  const { pbo, calls } = build();
  await pbo.proceedToTripInfo({ confirmed: true });
  const card = await pbo.selectExistingCard('4242');
  assert.equal(card.selected, true);
  const created = await pbo.createTrip({ confirmed: true });
  assert.deepEqual(created, { outcome: 'created', tripCode: '4885-a' });
  assert.equal(pbo.tripMayExist, true);
  const status = await pbo.observeUntil('SEARCHING_DRIVER');
  assert.equal(status.state, 'SEARCHING_DRIVER');
  const first = await pbo.cancelCreatedTrip({ confirmed: true });
  assert.equal(first.attempted && first.cancelled, true);
  const second = await pbo.cancelCreatedTrip({ confirmed: true });
  assert.equal(second.attempted, false);
  assert.equal(calls.filter((c) => c === 'cancel').length, 1);
  assert.equal(pbo.tripMayExist, false);
});

test('createTrip bloqueado por viaje activo: no queda viaje propio y no se cancela nada ajeno', async () => {
  const { pbo, calls } = build({
    confirm: async () => ({ outcome: 'blocked-active-trip', message: 'm', dismissed: true })
  });
  await pbo.proceedToTripInfo({ confirmed: true });
  await pbo.selectExistingCard('4242');
  const r = await pbo.createTrip({ confirmed: true });
  assert.equal(r.outcome, 'blocked-active-trip');
  assert.equal(pbo.tripMayExist, false);
  const cleanup = await pbo.cancelCreatedTrip({ confirmed: true });
  assert.equal(cleanup.attempted, false);
  assert.ok(!calls.includes('cancel'));
});

test('resultado desconocido al confirmar: tripMayExist queda true y la limpieza cancela', async () => {
  const { pbo, calls } = build({
    confirm: async () => {
      throw new Error('timeout');
    }
  });
  await pbo.proceedToTripInfo({ confirmed: true });
  await pbo.selectExistingCard('4242');
  await assert.rejects(pbo.createTrip({ confirmed: true }), /timeout/);
  assert.equal(pbo.tripMayExist, true);
  await pbo.cancelCreatedTrip({ confirmed: true });
  assert.ok(calls.includes('cancel'));
});

test('cancelCreatedTrip: si la app ya está en el home no toca nada; si falla pide cancelar a mano', async () => {
  const home = build({ status: AT_HOME });
  await home.pbo.proceedToTripInfo({ confirmed: true });
  await home.pbo.selectExistingCard('4242');
  await home.pbo.createTrip({ confirmed: true });
  const r = await home.pbo.cancelCreatedTrip({ confirmed: true });
  assert.equal(r.attempted && !r.cancelled, true);
  assert.ok(!home.calls.includes('cancel'));

  const fail = build({
    cancel: async () => {
      throw new Error('boom');
    }
  });
  await fail.pbo.proceedToTripInfo({ confirmed: true });
  await fail.pbo.selectExistingCard('4242');
  await fail.pbo.createTrip({ confirmed: true });
  await assert.rejects(
    fail.pbo.cancelCreatedTrip({ confirmed: true }),
    /CANCELARLO MANUALMENTE.*4885-a|4885-a.*CANCELARLO MANUALMENTE/
  );
});
