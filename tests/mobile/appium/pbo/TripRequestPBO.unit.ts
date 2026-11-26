// Unit de TripRequestPBO con deps fake (sin Appium, sin dispositivo).
// Run: npx tsx --test tests/mobile/appium/pbo/TripRequestPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardOption, PaymentOption } from '../screens/passenger/PaymentSelectorScreen.js';
import type { BlockingKind, DialogInfo } from '../screens/passenger/TripConfirmScreen.js';
import {
  BlockingDialogNotFoundError,
  FinalCtaNotEnabledError,
  IrreversibleNotConfirmedError,
  PaymentMethodUnavailableError,
  TripCtaNotFoundError,
  TripInfoNotShownError,
  TripOutcomeUnknownError,
  TripRequestPBO,
  type TripRequestPboDeps
} from './TripRequestPBO.js';

type World = {
  tripInfo: boolean;
  cta: { present: boolean; visible: boolean; enabled: boolean; text: string };
  /** Diálogos que aparecen tras el tap final (o tras el tap 1). */
  dialogsAfterTap: DialogInfo[];
  createdAfterTap: boolean;
  haystackBefore: string;
  haystackAfter: string;
  methods: PaymentOption[];
  cards: CardOption[];
};

const method = (
  index: number,
  kind: PaymentOption['kind'],
  text: string,
  extra = {}
): PaymentOption => ({
  index,
  kind,
  text,
  selected: false,
  disabled: false,
  ...extra
});

function build(over: Partial<World> = {}) {
  const w: World = {
    tripInfo: true,
    cta: { present: true, visible: true, enabled: true, text: 'Viajo Ahora' },
    dialogsAfterTap: [],
    createdAfterTap: true,
    haystackBefore: 'historial 1111-a',
    haystackAfter: 'viaje 1111-a y nuevo 4885-a',
    methods: [
      method(0, 'cash', 'Efectivo'),
      method(1, 'checking-account', 'Cuenta Corriente'),
      method(2, 'credit-card', 'Tarjeta de Crédito')
    ],
    cards: [
      { index: 0, text: 'VISA ...1111', brand: 'VISA', last4: '1111', expired: false },
      { index: 1, text: 'VISA ...2224', brand: 'VISA', last4: '2224', expired: false }
    ],
    ...over
  };
  const calls: string[] = [];
  let tapped = false;
  let dismissed: BlockingKind | null = null;
  const deps: TripRequestPboDeps = {
    payment: {
      readMethods: async () => w.methods,
      tapMethod: async (i) => (calls.push(`tapMethod:${i}`), true),
      readCards: async () => w.cards,
      tapCard: async (i) => (calls.push(`tapCard:${i}`), true)
    },
    confirm: {
      isTripInfoShown: async () => w.tripInfo,
      readFinalCta: async () => w.cta,
      tapSelectVehicleCta: async () => (calls.push('tapSelectVehicleCta'), (tapped = true)),
      tapFinalConfirmCta: async () => (calls.push('tapFinalConfirmCta'), (tapped = true)),
      readDialogs: async () => (tapped ? w.dialogsAfterTap : []),
      dismissBlockingDialog: async (k) => (calls.push(`dismiss:${k}`), (dismissed = k), true),
      readTripHaystack: async () => (tapped ? w.haystackAfter : w.haystackBefore),
      isTripCreated: async () => tapped && w.createdAfterTap
    }
  };
  const pbo = new TripRequestPBO(deps, {
    log: () => undefined,
    timeouts: { tripInfo: 60, outcome: 60, tripCode: 60, interval: 5 }
  });
  return { pbo, calls, w, deps, dismissedKind: () => dismissed };
}

const BLOCK: DialogInfo = { text: 'Ya tiene un viaje creado', kind: 'blocked-active-trip' };
const CREDIT: DialogInfo = {
  text: 'Su saldo excede la cuenta corriente configurada.',
  kind: 'credit-limit'
};

test('confirmTrip: creado -> código NUEVO (excluye historial)', async () => {
  const { pbo, calls } = build();
  assert.deepEqual(await pbo.confirmTrip({ confirmed: true }), {
    outcome: 'created',
    tripCode: '4885-a'
  });
  assert.deepEqual(calls, ['tapFinalConfirmCta']);
});

test('confirmTrip: sin código nuevo cae al travelId, o null', async () => {
  const a = build({ haystackAfter: 'historial 1111-a travelId: 777' });
  assert.deepEqual(await a.pbo.confirmTrip({ confirmed: true }), {
    outcome: 'created',
    tripCode: '777'
  });
  const b = build({ haystackAfter: 'historial 1111-a' });
  assert.deepEqual(await b.pbo.confirmTrip({ confirmed: true }), {
    outcome: 'created',
    tripCode: null
  });
});

test('confirmTrip: «Ya tiene un viaje creado» (es/en) -> blocked + modal cerrado, sin código', async () => {
  for (const text of ['Ya tiene un viaje creado', 'You already have a trip created']) {
    const { pbo, calls, dismissedKind } = build({
      createdAfterTap: false,
      dialogsAfterTap: [{ text, kind: 'blocked-active-trip' }]
    });
    assert.deepEqual(await pbo.confirmTrip({ confirmed: true }), {
      outcome: 'blocked-active-trip',
      message: text,
      dismissed: true
    });
    assert.deepEqual(calls, ['tapFinalConfirmCta', 'dismiss:blocked-active-trip']);
    assert.equal(dismissedKind(), 'blocked-active-trip');
  }
});

test('confirmTrip: dismissBlocking=false deja el aviso abierto', async () => {
  const { pbo, calls } = build({ createdAfterTap: false, dialogsAfterTap: [BLOCK] });
  const r = await pbo.confirmTrip({ confirmed: true }, { dismissBlocking: false });
  assert.deepEqual(r, { outcome: 'blocked-active-trip', message: BLOCK.text, dismissed: false });
  assert.deepEqual(calls, ['tapFinalConfirmCta']);
});

test('confirmTrip: límite de crédito detectado y cerrado', async () => {
  const { pbo, calls } = build({ createdAfterTap: false, dialogsAfterTap: [CREDIT] });
  assert.deepEqual(await pbo.confirmTrip({ confirmed: true }), {
    outcome: 'credit-limit',
    message: CREDIT.text,
    dismissed: true
  });
  assert.deepEqual(calls, ['tapFinalConfirmCta', 'dismiss:credit-limit']);
});

test('confirmTrip: sin resultado -> TripOutcomeUnknownError (avisa que pudo crearse)', async () => {
  const { pbo } = build({ createdAfterTap: false });
  await assert.rejects(pbo.confirmTrip({ confirmed: true }), TripOutcomeUnknownError);
});

test('SEGURIDAD: confirmTrip/proceedToTripInfo sin { confirmed: true } lanzan y NO tocan nada', async () => {
  const bad: unknown[] = [
    undefined,
    {},
    { confirmed: false },
    { confirmed: 1 },
    { confirmed: 'true' }
  ];
  for (const arg of bad) {
    const { pbo, calls } = build();
    await assert.rejects(
      pbo.confirmTrip(arg as { confirmed: boolean }),
      IrreversibleNotConfirmedError
    );
    await assert.rejects(
      pbo.proceedToTripInfo(arg as { confirmed: boolean }),
      IrreversibleNotConfirmedError
    );
    assert.deepEqual(calls, [], `no se tocó nada con ${JSON.stringify(arg)}`);
  }
});

test('confirmTrip: precondiciones (travel-info, CTA habilitado, CTA tocable) sin crear nada', async () => {
  const a = build({ tripInfo: false });
  await assert.rejects(a.pbo.confirmTrip({ confirmed: true }), TripInfoNotShownError);
  const b = build({ cta: { present: true, visible: true, enabled: false, text: 'Viajo Ahora' } });
  await assert.rejects(b.pbo.confirmTrip({ confirmed: true }), FinalCtaNotEnabledError);
  const c = build();
  c.deps.confirm.tapFinalConfirmCta = async () => false;
  await assert.rejects(c.pbo.confirmTrip({ confirmed: true }), TripCtaNotFoundError);
  assert.deepEqual([...a.calls, ...b.calls], []);
});

test('proceedToTripInfo: confirmado -> travel-info; también devuelve bloqueos', async () => {
  const a = build();
  assert.deepEqual(await a.pbo.proceedToTripInfo({ confirmed: true }), { outcome: 'trip-info' });
  assert.deepEqual(a.calls, ['tapSelectVehicleCta']);
  const b = build({ tripInfo: false, dialogsAfterTap: [BLOCK] });
  assert.deepEqual(await b.pbo.proceedToTripInfo({ confirmed: true }), {
    outcome: 'blocked-active-trip',
    message: BLOCK.text
  });
  const c = build({ tripInfo: false });
  await assert.rejects(c.pbo.proceedToTripInfo({ confirmed: true }), TripInfoNotShownError);
});

test('dismissTripAlreadyCreatedModal / waitFor...: detecta y cierra; sin modal lanza', async () => {
  const a = build();
  a.deps.confirm.readDialogs = async () => [BLOCK];
  assert.equal(await a.pbo.waitForTripAlreadyCreatedModal(40), true);
  await a.pbo.dismissTripAlreadyCreatedModal(40);
  assert.deepEqual(a.calls, ['dismiss:blocked-active-trip']);

  const b = build();
  b.deps.confirm.dismissBlockingDialog = async () => false;
  assert.equal(await b.pbo.waitForTripAlreadyCreatedModal(30), false);
  await assert.rejects(b.pbo.dismissTripAlreadyCreatedModal(30), BlockingDialogNotFoundError);
});

test('selectPayment: efectivo / cuenta corriente por tipo; ya elegido no toca; deshabilitado lanza', async () => {
  const a = build();
  assert.deepEqual(await a.pbo.selectPayment({ type: 'cash' }), {
    type: 'cash',
    last4: null,
    alreadySelected: false
  });
  assert.deepEqual(a.calls, ['tapMethod:0']);

  const b = build({ methods: [method(0, 'cash', 'Efectivo', { selected: true })] });
  assert.equal((await b.pbo.selectPayment({ type: 'cash' })).alreadySelected, true);
  assert.deepEqual(b.calls, []);

  const c = build({
    methods: [method(0, 'checking-account', 'Cuenta Corriente', { disabled: true })]
  });
  await assert.rejects(
    c.pbo.selectPayment({ type: 'checking-account' }),
    PaymentMethodUnavailableError
  );
  const d = build({ methods: [method(0, 'cash', 'Efectivo')] });
  await assert.rejects(d.pbo.selectPayment({ type: 'credit-card' }), PaymentMethodUnavailableError);
});

test('selectPayment: tarjeta por últimos 4 (toca columna y luego la tarjeta); ya elegida no toca', async () => {
  const a = build();
  assert.deepEqual(await a.pbo.selectPayment({ type: 'credit-card', last4: 'VISA ...2224' }), {
    type: 'credit-card',
    last4: '2224',
    alreadySelected: false
  });
  assert.deepEqual(a.calls, ['tapMethod:2', 'tapCard:1']);

  const b = build({
    methods: [method(0, 'credit-card', 'VISA - 2224', { selected: true })]
  });
  assert.equal(
    (await b.pbo.selectPayment({ type: 'credit-card', last4: '2224' })).alreadySelected,
    true
  );
  assert.deepEqual(b.calls, []);

  const c = build();
  await assert.rejects(
    c.pbo.selectPayment({ type: 'credit-card', last4: '9999' }),
    PaymentMethodUnavailableError
  );
  const d = build({
    cards: [
      { index: 0, text: 'VISA ...2224 (Vencida)', brand: 'VISA', last4: '2224', expired: true }
    ]
  });
  await assert.rejects(d.pbo.selectPayment({ type: 'credit-card', last4: '2224' }), /vencida/);
});

// ---- Guardas estáticas: el CTA que confirma solo se toca en el PBO, tras la compuerta ----

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // tests/mobile/appium/
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
const rel = (p: string): string => p.slice(ROOT.length).replace(/\\/g, '/');

test('SEGURIDAD (estático): los taps de confirmación solo existen en TripConfirmScreen y solo los llama TripRequestPBO', () => {
  const callers = walk(ROOT)
    .filter((p) => !p.endsWith('.unit.ts'))
    .filter((p) => /tapFinalConfirmCta|tapSelectVehicleCta/.test(readFileSync(p, 'utf8')))
    .map(rel)
    .sort();
  assert.deepEqual(callers, ['pbo/TripRequestPBO.ts', 'screens/passenger/TripConfirmScreen.ts']);
});

test('SEGURIDAD (estático): en TripRequestPBO cada tap de CTA va precedido de assertConfirmed en su método', () => {
  const src = readFileSync(join(ROOT, 'pbo/TripRequestPBO.ts'), 'utf8');
  for (const tap of ['tapSelectVehicleCta', 'tapFinalConfirmCta']) {
    const uses = [...src.matchAll(new RegExp(`confirm\\.${tap}\\(`, 'g'))];
    assert.equal(uses.length, 1, `una sola llamada a ${tap}`);
    const before = src.slice(0, uses[0]!.index);
    const methodStart = Math.max(
      before.lastIndexOf('async proceedToTripInfo('),
      before.lastIndexOf('async confirmTrip(')
    );
    assert.ok(methodStart >= 0, `${tap} dentro de proceedToTripInfo/confirmTrip`);
    assert.ok(/assertConfirmed\(/.test(before.slice(methodStart)), `${tap} tras assertConfirmed`);
  }
});

test('SEGURIDAD (estático): NewTripScreen y NewTripPBO no importan ni referencian la screen/PBO que confirma', () => {
  for (const f of ['screens/passenger/NewTripScreen.ts', 'pbo/NewTripPBO.ts']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(
      !/TripConfirmScreen|TripRequestPBO|PaymentSelectorScreen/.test(
        src.replace(/\/\*[\s\S]*?\*\//g, '')
      ),
      f
    );
    assert.ok(!/tapFinalConfirmCta|tapSelectVehicleCta/.test(src), f);
  }
});
