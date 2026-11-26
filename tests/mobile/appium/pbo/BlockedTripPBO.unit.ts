// Unit de BlockedTripPBO: orden compuerta + pre-chequeo ANTES de confirmar (fakes, sin Appium) + chequeos estáticos.
// Run: npx tsx --test tests/mobile/appium/pbo/BlockedTripPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ActiveTripObservation } from './ActiveTripPBO.js';
import {
  BlockedTripPBO,
  UnexpectedTripCreatedError,
  planBlockedAttempt,
  type BlockedTripPboDeps
} from './BlockedTripPBO.js';
import type { ConfirmTripResult, ProceedResult } from './TripRequestPBO.js';

const ACTIVE: ActiveTripObservation = {
  active: true,
  kind: 'searching-driver',
  url: 'http://x/DriverAvailablePages'
};
const NONE: ActiveTripObservation = {
  active: false,
  kind: null,
  url: 'http://x/navigator/HomePage'
};
const TRAVEL_INFO: ProceedResult = { outcome: 'trip-info' };

function build(proceed: ProceedResult, confirm: ConfirmTripResult) {
  const calls: string[] = [];
  const trip: BlockedTripPboDeps['trip'] = {
    proceedToTripInfo: async (o) => {
      calls.push(`proceed:${o.confirmed}`);
      return proceed;
    },
    confirmTrip: async (o) => {
      calls.push(`confirm:${o.confirmed}`);
      return confirm;
    }
  };
  return { pbo: new BlockedTripPBO({ trip }), calls };
}

test('planBlockedAttempt: solo abre con compuerta Y pre-chequeo positivo', () => {
  assert.deepEqual(planBlockedAttempt({ gateOpen: true, preCheck: ACTIVE }), { proceed: true });
  assert.equal(planBlockedAttempt({ gateOpen: false, preCheck: ACTIVE }).proceed, false);
  assert.equal(planBlockedAttempt({ gateOpen: true, preCheck: NONE }).proceed, false);
  const both = planBlockedAttempt({ gateOpen: false, preCheck: NONE });
  assert.equal(both.proceed, false);
  if (!both.proceed) assert.match(both.reason, /compuerta.*y.*pre-chequeo negativo/);
});

test('sin compuerta: skipped y NUNCA llama proceed ni confirm', async () => {
  const { pbo, calls } = build(TRAVEL_INFO, { outcome: 'created', tripCode: '1-a' });
  const r = await pbo.attempt({ gateOpen: false, preCheck: ACTIVE });
  assert.equal(r.status, 'skipped');
  assert.deepEqual(calls, []);
});

test('compuerta abierta pero sin viaje activo observado: skipped y NUNCA llama confirm', async () => {
  const { pbo, calls } = build(TRAVEL_INFO, { outcome: 'created', tripCode: '1-a' });
  const r = await pbo.attempt({ gateOpen: true, preCheck: NONE });
  assert.equal(r.status, 'skipped');
  if (r.status === 'skipped') assert.match(r.reason, /pre-chequeo negativo/);
  assert.deepEqual(calls, []);
});

test('compuerta + pre-chequeo: confirma con confirmed:true y reporta el bloqueo es/en', async () => {
  for (const message of ['Ya tiene un viaje creado', 'You already have a trip created']) {
    const { pbo, calls } = build(TRAVEL_INFO, {
      outcome: 'blocked-active-trip',
      message,
      dismissed: true
    });
    const r = await pbo.attempt({ gateOpen: true, preCheck: ACTIVE });
    assert.deepEqual(r, { status: 'blocked', message, dismissed: true, atStep: 'confirm' });
    assert.deepEqual(calls, ['proceed:true', 'confirm:true']);
  }
});

test('passenger_already_traveling también cuenta como bloqueo', async () => {
  const message = 'No se puede solicitar un nuevo Viaje  en este momento';
  const { pbo } = build(TRAVEL_INFO, { outcome: 'blocked-active-trip', message, dismissed: false });
  const r = await pbo.attempt({ gateOpen: true, preCheck: ACTIVE });
  assert.equal(r.status, 'blocked');
});

test('bloqueo ya al pasar a travel-info: no se llega a confirmar', async () => {
  const { pbo, calls } = build(
    { outcome: 'blocked-active-trip', message: 'Ya tiene un viaje creado' },
    { outcome: 'created', tripCode: '1-a' }
  );
  const r = await pbo.attempt({ gateOpen: true, preCheck: ACTIVE });
  assert.deepEqual(r, {
    status: 'blocked',
    message: 'Ya tiene un viaje creado',
    dismissed: false,
    atStep: 'travel-info'
  });
  assert.deepEqual(calls, ['proceed:true']);
});

test('viaje creado (precondición falsa): falla fuerte con el código y pide cancelar a mano', async () => {
  const { pbo } = build(TRAVEL_INFO, { outcome: 'created', tripCode: '4885-a' });
  await assert.rejects(
    pbo.attempt({ gateOpen: true, preCheck: ACTIVE }),
    (e: unknown) =>
      e instanceof UnexpectedTripCreatedError &&
      e.tripCode === '4885-a' &&
      /4885-a/.test(e.message) &&
      /MANUALMENTE desde Carrier/.test(e.message)
  );
});

test('viaje creado sin código: el mensaje igual pide cancelar a mano', async () => {
  const { pbo } = build(TRAVEL_INFO, { outcome: 'created', tripCode: null });
  await assert.rejects(pbo.attempt({ gateOpen: true, preCheck: ACTIVE }), /n\/d[\s\S]*MANUALMENTE/);
});

test('límite de crédito: other-block (el spec lo reporta como fallo del caso)', async () => {
  const { pbo } = build(TRAVEL_INFO, {
    outcome: 'credit-limit',
    message: 'Su saldo excede la cuenta corriente',
    dismissed: true
  });
  const r = await pbo.attempt({ gateOpen: true, preCheck: ACTIVE });
  assert.equal(r.status, 'other-block');
});

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('SEGURIDAD (estático): en BlockedTripPBO, plan -> return ANTES de proceed/confirm; sin env ni taps', () => {
  const code = stripComments(read('./BlockedTripPBO.ts'));
  const attempt = code.slice(code.indexOf('async attempt('));
  const plan = attempt.indexOf('planBlockedAttempt(');
  const guard = attempt.indexOf('if (!plan.proceed) return');
  const proceed = attempt.indexOf('proceedToTripInfo(');
  const confirm = attempt.indexOf('confirmTrip(');
  assert.ok(plan >= 0 && guard > plan, 'se evalúa el plan y se corta si está cerrado');
  assert.ok(proceed > guard && confirm > proceed, 'proceed/confirm solo después del guard');
  assert.equal([...attempt.matchAll(/confirmTrip\(/g)].length, 1, 'una sola llamada a confirmTrip');
  assert.ok(!/process\.env/.test(code), 'sin process.env en el PBO');
  assert.ok(!/tapFinalConfirmCta|tapSelectVehicleCta/.test(code), 'sin taps de bajo nivel');
  assert.ok(!/cancelTrip|cancelTravel/i.test(code), 'nunca cancela el viaje');
});

test('SEGURIDAD (estático): el spec no confirma directo; lee la compuerta y evalúa el plan antes de intentar', () => {
  const raw = read('../passenger/specs/pax-new-trip-blocked.spec.ts');
  const code = stripComments(raw);
  assert.ok(
    !/confirmTrip\(|proceedToTripInfo\(|tapFinalConfirmCta|tapSelectVehicleCta|cancelTrip|cancelTravel/.test(
      code
    )
  );
  const gate = code.indexOf("process.env[PRECONDITION_GATE_ENV] === '1'");
  const open = code.indexOf("openAndObserve('pax-new-trip-blocked-t3')");
  const plan = code.indexOf('planBlockedAttempt({');
  const attempt = code.indexOf('.attempt({');
  assert.ok(gate > 0 && open > gate, 'la compuerta se evalúa antes de abrir la sesión de T3');
  assert.ok(plan > open && attempt > plan, 'el plan (pre-chequeo) precede al intento');
  assert.match(raw, /PAX_TRIP_BLOCKED_PRECONDITION/);
  assert.match(raw, /@mobile @no-xray/);
});

test('SEGURIDAD (estático): la compuerta no se lee fuera del spec ni hay process.env en screens/pbo', () => {
  for (const f of [
    './BlockedTripPBO.ts',
    './ActiveTripPBO.ts',
    './TripRequestPBO.ts',
    '../screens/passenger/ActiveTripScreen.ts',
    '../screens/passenger/TripConfirmScreen.ts'
  ]) {
    const code = stripComments(read(f));
    assert.ok(!/PAX_TRIP_BLOCKED_PRECONDITION/.test(code), f);
    assert.ok(!/process\.env/.test(code), f);
  }
});
