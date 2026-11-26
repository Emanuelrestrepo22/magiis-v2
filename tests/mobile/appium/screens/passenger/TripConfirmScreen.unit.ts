// Unit de PaymentSelectorScreen + PassengerTripConfirmScreen con driver fake (sin Appium, sin dispositivo).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/TripConfirmScreen.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import type { MobileActorConfig } from '../../config/appiumRuntime.js';
import { MobileSession } from '../../core/MobileSession.js';
import {
  PAYMENT_LOCATORS,
  PaymentSelectorScreen,
  classifyPaymentMethod,
  parseCardLabel,
  pickCardIndex
} from './PaymentSelectorScreen.js';
import {
  PassengerTripConfirmScreen,
  TRIP_CONFIRM_LOCATORS,
  classifyBlockingText,
  collectTripCodes,
  extractTravelId,
  isDismissButtonLabel,
  isTripCreatedSignal,
  isTripInfoUrl
} from './TripConfirmScreen.js';

const CONFIG = {
  actor: 'passenger',
  environment: 'test',
  appiumServerUrl: 'http://127.0.0.1:4723',
  appiumBasePath: '/',
  appPath: null,
  appPackage: 'com.example.passenger',
  appActivity: '.MainActivity',
  deviceName: 'emulator-5554',
  platformVersion: '14',
  udid: 'emulator-5554',
  newCommandTimeout: 60,
  noReset: true,
  fullReset: false,
  chromedriverAutodownload: false,
  chromedriverExecutable: null
} as MobileActorConfig;

type FakeEl = {
  isDisplayed: () => Promise<boolean>;
  getText: () => Promise<string>;
  click: () => Promise<void>;
  $$: (sel: string) => Promise<FakeEl[]>;
};

function el(log: string[], name: string, text: string, children: FakeEl[] = []): FakeEl {
  return {
    isDisplayed: async () => true,
    getText: async () => text,
    click: async () => {
      log.push(`click:${name}`);
    },
    $$: async () => children
  };
}

function fake(opts: {
  elements?: Record<string, FakeEl[]>;
  execute?: (args: unknown[]) => unknown;
  url?: string;
}) {
  const log: string[] = [];
  const driver = {
    getContext: async () => 'WEBVIEW_com.example',
    $$: async (sel: string) => opts.elements?.[sel] ?? [],
    execute: async (_fn: unknown, ...args: unknown[]) =>
      opts.execute ? opts.execute(args) : (opts.url ?? '')
  } as unknown as Browser;
  const session = new MobileSession(CONFIG, { driver, log: () => undefined });
  return { session, log };
}

const DIALOGS = TRIP_CONFIRM_LOCATORS.dialogs.web as string;
const FINAL_FIRST = (TRIP_CONFIRM_LOCATORS.finalCta.web as readonly string[])[0]!;
const SELECT_FIRST = (TRIP_CONFIRM_LOCATORS.selectVehicleCta.web as readonly string[])[0]!;

test('classifyBlockingText: viaje activo es/en y límite de crédito es/en', () => {
  assert.equal(classifyBlockingText('Ya tiene un viaje creado Aceptar'), 'blocked-active-trip');
  assert.equal(classifyBlockingText('You already have a trip created'), 'blocked-active-trip');
  assert.equal(
    classifyBlockingText(
      'Su saldo excede la cuenta corriente configurada. Por favor, seleccione otro método de pago'
    ),
    'credit-limit'
  );
  assert.equal(
    classifyBlockingText('Your balance exceeds the configured credit account. Please select'),
    'credit-limit'
  );
  // passenger_already_traveling (es.json tiene doble espacio tras «Viaje»)
  assert.equal(
    classifyBlockingText('No se puede solicitar un nuevo Viaje  en este momento'),
    'blocked-active-trip'
  );
  assert.equal(
    classifyBlockingText('Cannot request a new travel in this moment'),
    'blocked-active-trip'
  );
  assert.equal(classifyBlockingText('Agrega una tarjeta para continuar'), null);
  assert.equal(classifyBlockingText(''), null);
});

test('isDismissButtonLabel: Aceptar/Accept/Ok cierran; Llamar/Call jamás', () => {
  for (const ok of ['Aceptar', ' accept ', 'OK', 'Ok'])
    assert.equal(isDismissButtonLabel(ok), true);
  for (const no of ['Llamar', 'Call', 'Cancelar', ''])
    assert.equal(isDismissButtonLabel(no), false);
});

test('códigos de viaje: minúscula, múltiples, travelId, señal de creado, URL travel-info', () => {
  assert.deepEqual(collectTripCodes('viajes 4885-a y 8973-e; 12-a no; 4885-a'), [
    '4885-a',
    '8973-e'
  ]);
  assert.equal(extractTravelId('{"travelId": 70891}'), '70891');
  assert.equal(extractTravelId('nada'), null);
  assert.equal(isTripCreatedSignal('https://x/navigator/DriverAvailablePages;x=1', ''), true);
  assert.equal(
    isTripCreatedSignal('https://x/navigator/travel-info', 'Buscando servicio...'),
    true
  );
  assert.equal(isTripCreatedSignal('https://x/navigator/travel-info', 'Cancel Trip'), true);
  assert.equal(isTripCreatedSignal('https://x/navigator/travel-info', 'Viajo Ahora'), false);
  assert.equal(isTripInfoUrl('http://localhost/navigator/travel-info;a=1'), true);
  assert.equal(isTripInfoUrl('http://localhost/navigator/HomePage'), false);
});

test('pago: clasificación es/en, parseo de tarjeta y selección por últimos 4', () => {
  assert.equal(classifyPaymentMethod('Efectivo'), 'cash');
  assert.equal(classifyPaymentMethod('Cash'), 'cash');
  assert.equal(classifyPaymentMethod('Cuenta Corriente'), 'checking-account');
  assert.equal(classifyPaymentMethod('Credit Account'), 'checking-account');
  assert.equal(classifyPaymentMethod('Tarjeta de Crédito'), 'credit-card');
  assert.equal(classifyPaymentMethod('Credit Card'), 'credit-card');
  assert.equal(classifyPaymentMethod('VISA - 2224'), 'credit-card');
  assert.equal(classifyPaymentMethod('Otro'), 'unknown');
  assert.deepEqual(parseCardLabel('VISA ...2224'), { brand: 'VISA', last4: '2224' });
  assert.deepEqual(parseCardLabel('mastercard - 9235'), { brand: 'MASTERCARD', last4: '9235' });
  assert.deepEqual(parseCardLabel('sin tarjeta'), { brand: '', last4: '' });
  const cards = [{ last4: '1111' }, { last4: '2224' }];
  assert.equal(pickCardIndex(cards, '2224'), 1);
  assert.equal(pickCardIndex(cards, 'VISA ****2224'), 1);
  assert.equal(pickCardIndex(cards, '9999'), -1);
  assert.equal(pickCardIndex(cards, '24'), -1);
});

test('readDialogs: clasifica bloqueos visibles y descarta vacíos', async () => {
  const log: string[] = [];
  const { session } = fake({
    elements: {
      [DIALOGS]: [
        el(log, 'a', 'Ya tiene un viaje creado Aceptar'),
        el(log, 'b', 'Cualquier otro aviso'),
        el(log, 'c', '')
      ]
    }
  });
  const dialogs = await new PassengerTripConfirmScreen(session).readDialogs();
  assert.deepEqual(
    dialogs.map((d) => d.kind),
    ['blocked-active-trip', null]
  );
  assert.deepEqual(log, [], 'leer no toca nada');
});

test('dismissBlockingDialog: modal de crédito -> toca SOLO «Aceptar», nunca «Llamar»', async () => {
  const log: string[] = [];
  const modal = el(
    log,
    'modal',
    'Su saldo excede la cuenta corriente configurada. Llamar Aceptar',
    [el(log, 'llamar', 'Llamar'), el(log, 'aceptar', 'Aceptar')]
  );
  const { session } = fake({ elements: { [DIALOGS]: [modal] } });
  const screen = new PassengerTripConfirmScreen(session);
  assert.equal(await screen.dismissBlockingDialog('credit-limit'), true);
  assert.deepEqual(log, ['click:aceptar']);
});

test('dismissBlockingDialog: tipo distinto o sin botón de cierre -> false sin tocar', async () => {
  const log: string[] = [];
  const modal = el(log, 'modal', 'Ya tiene un viaje creado', [el(log, 'llamar', 'Llamar')]);
  const { session } = fake({ elements: { [DIALOGS]: [modal] } });
  const screen = new PassengerTripConfirmScreen(session);
  assert.equal(await screen.dismissBlockingDialog('credit-limit'), false);
  assert.equal(await screen.dismissBlockingDialog('blocked-active-trip'), false);
  assert.deepEqual(log, []);
});

test('taps de CTA: solo con el texto esperado (Seleccionar Vehículo / Viajo Ahora, es y en)', async () => {
  const log: string[] = [];
  const { session } = fake({
    elements: {
      [SELECT_FIRST]: [el(log, 'x', 'Otro'), el(log, 'select', 'Select Vehicle')],
      [FINAL_FIRST]: [el(log, 'final', 'Viajo Ahora Standard - $ 1.200')]
    }
  });
  const screen = new PassengerTripConfirmScreen(session);
  assert.equal(await screen.tapSelectVehicleCta(), true);
  assert.equal(await screen.tapFinalConfirmCta(), true);
  assert.deepEqual(log, ['click:select', 'click:final']);

  const empty = new PassengerTripConfirmScreen(fake({}).session);
  assert.equal(await empty.tapSelectVehicleCta(), false);
  assert.equal(await empty.tapFinalConfirmCta(), false);
});

test('readFinalCta: devuelve el estado del execute y no hace click', async () => {
  const log: string[] = [];
  const state = { present: true, visible: true, enabled: true, text: 'Viajo Ahora' };
  const { session } = fake({
    execute: () => state,
    elements: { [FINAL_FIRST]: [el(log, 'f', 'x')] }
  });
  assert.deepEqual(await new PassengerTripConfirmScreen(session).readFinalCta(), state);
  assert.deepEqual(log, []);
});

test('PaymentSelectorScreen: readMethods marca seleccionado/deshabilitado; tapMethod/tapCard por índice', async () => {
  const log: string[] = [];
  const methodSel = (PAYMENT_LOCATORS.methods.web as readonly string[])[0]!;
  const cardSel = (PAYMENT_LOCATORS.cardItems.web as readonly string[])[0]!;
  const { session } = fake({
    execute: () => [
      { text: 'Efectivo', cls: 'payment-method' },
      { text: 'VISA - 2224', cls: 'payment-method payment-method-selected' },
      { text: 'Cuenta Corriente', cls: 'payment-method payment-method-disabled' }
    ],
    elements: {
      [methodSel]: [el(log, 'm0', 'Efectivo'), el(log, 'm1', 'VISA - 2224')],
      [cardSel]: [el(log, 'c0', 'VISA ...1111'), el(log, 'c1', 'MASTERCARD ...2224 (Vencida)')]
    }
  });
  const screen = new PaymentSelectorScreen(session);
  const methods = await screen.readMethods();
  assert.deepEqual(
    methods.map((m) => [m.kind, m.selected, m.disabled]),
    [
      ['cash', false, false],
      ['credit-card', true, false],
      ['checking-account', false, true]
    ]
  );
  assert.equal(await screen.tapMethod(0), true);
  assert.equal(await screen.tapMethod(7), false);
  const cards = await screen.readCards();
  assert.deepEqual(
    cards.map((c) => [c.last4, c.expired]),
    [
      ['1111', false],
      ['2224', true]
    ]
  );
  assert.equal(await screen.tapCard(1), true);
  assert.deepEqual(log, ['click:m0', 'click:c1']);
});
