// Unit de NewTripScreen PAX con driver fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/NewTripScreen.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'webdriverio';
import type { MobileActorConfig } from '../../config/appiumRuntime.js';
import { MobileSession } from '../../core/MobileSession.js';
import { passengerAddressesFor } from '../../data/passengerAddresses.js';
import { NEW_TRIP_LOCATORS, NewTripScreen, pickPredictionIndex } from './NewTripScreen.js';

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
  click: () => Promise<void>;
  setValue: (v: string) => Promise<void>;
};

function fakeEl(log: string[], name: string, displayed = true, fail = false): FakeEl {
  return {
    isDisplayed: async () => displayed,
    click: async () => {
      if (fail) throw new Error('no clickable');
      log.push(`click:${name}`);
    },
    setValue: async (v: string) => {
      log.push(`setValue:${name}:${v}`);
    }
  };
}

/** Driver fake: `$$` por selector (mapa) y `execute` con handler; registra todo en `log`. */
function fake(opts: {
  elements?: Record<string, FakeEl[]>;
  execute?: (args: unknown[]) => unknown;
}) {
  const log: string[] = [];
  const driver = {
    getContext: async () => 'WEBVIEW_com.example',
    $$: async (sel: string) => {
      log.push(`$$:${sel}`);
      return opts.elements?.[sel] ?? [];
    },
    execute: async (_fn: unknown, ...args: unknown[]) => {
      log.push('execute');
      return opts.execute ? opts.execute(args) : undefined;
    }
  } as unknown as Browser;
  return {
    screen: new NewTripScreen(new MobileSession(CONFIG, { driver, log: () => undefined })),
    log
  };
}

const ORIGIN_INPUT = (NEW_TRIP_LOCATORS.originInput.web as readonly string[])[0]!;
const DEST_PRED = NEW_TRIP_LOCATORS.destinationPredictions.web as string;

test('locators: estructurales, con placeholder solo de respaldo (es/en, sin depender del espacio final)', () => {
  const origin = NEW_TRIP_LOCATORS.originInput.web as readonly string[];
  assert.ok(origin[0]!.includes('travel-edit-input:nth-of-type(1)'));
  assert.ok(origin.slice(1).every((s) => s.includes('placeholder^=')));
  assert.ok(origin.some((s) => s.includes('Origen')) && origin.some((s) => s.includes('From')));
  assert.equal(
    (NEW_TRIP_LOCATORS.confirmCta.web as readonly string[])[0],
    'ion-col.travel-btn-confirm'
  );
  assert.ok(DEST_PRED.includes('ion-item.prediction-item'));
});

test('pickPredictionIndex: por texto (sin acentos), por índice, primera por defecto y vacío', () => {
  const list = [
    { text: 'Av. Corrientes Buenos Aires' },
    { text: 'Obelisco Plaza de la República' }
  ];
  assert.equal(pickPredictionIndex(list, 'obélisco'), 1);
  assert.equal(pickPredictionIndex(list, 'zzz'), 0);
  assert.equal(pickPredictionIndex(list), 0);
  assert.equal(pickPredictionIndex(list, 1), 1);
  assert.equal(pickPredictionIndex(list, 5), -1);
  assert.equal(pickPredictionIndex([], 'x'), -1);
});

test('isFormShown: requiere origen y destino visibles', async () => {
  const log: string[] = [];
  const both = fake({
    elements: {
      [ORIGIN_INPUT]: [fakeEl(log, 'o')],
      [(NEW_TRIP_LOCATORS.destinationInput.web as readonly string[])[0]!]: [fakeEl(log, 'd')]
    }
  });
  assert.equal(await both.screen.isFormShown(), true);
  const onlyOrigin = fake({ elements: { [ORIGIN_INPUT]: [fakeEl(log, 'o')] } });
  assert.equal(await onlyOrigin.screen.isFormShown(), false);
  const hidden = fake({ elements: { [ORIGIN_INPUT]: [fakeEl(log, 'o', false)] } });
  assert.equal(await hidden.screen.isFormShown(), false);
});

test('typeAddress: teclado real (click + setValue), nunca asigna value por JS', async () => {
  const log: string[] = [];
  const { screen, log: calls } = fake({
    elements: { [ORIGIN_INPUT]: [fakeEl(log, 'origen')] },
    execute: () => false // no es readonly
  });
  assert.equal(await screen.typeAddress('origin', 'Obelisco'), true);
  assert.deepEqual(log, ['click:origen', 'setValue:origen:Obelisco']);
  // la única `execute` es la lectura de readonly (sin args de texto a escribir)
  assert.equal(calls.filter((c) => c === 'execute').length, 1);
});

test('typeAddress: false si el campo está readonly, no existe o falla el tipeo', async () => {
  const log: string[] = [];
  const ro = fake({ elements: { [ORIGIN_INPUT]: [fakeEl(log, 'o')] }, execute: () => true });
  assert.equal(await ro.screen.typeAddress('origin', 'Obelisco'), false);
  assert.deepEqual(log, []);
  const none = fake({ execute: () => false });
  assert.equal(await none.screen.typeAddress('origin', 'Obelisco'), false);
  const broken = fake({
    elements: { [ORIGIN_INPUT]: [fakeEl(log, 'o', true, true)] },
    execute: () => false
  });
  assert.equal(await broken.screen.typeAddress('origin', 'Obelisco'), false);
});

test('readPredictions: arma index/main/secondary/text; vacío si falla la lectura', async () => {
  const ok = fake({
    execute: () => [
      { main: 'Obelisco', secondary: 'Buenos Aires, Argentina' },
      { main: 'Obelisco Hotel', secondary: '' }
    ]
  });
  assert.deepEqual(await ok.screen.readPredictions('destination'), [
    {
      index: 0,
      main: 'Obelisco',
      secondary: 'Buenos Aires, Argentina',
      text: 'Obelisco Buenos Aires, Argentina'
    },
    { index: 1, main: 'Obelisco Hotel', secondary: '', text: 'Obelisco Hotel' }
  ]);
  const bad = fake({
    execute: () => {
      throw new Error('boom');
    }
  });
  assert.deepEqual(await bad.screen.readPredictions('origin'), []);
});

test('selectPrediction: click real sobre el item visible por índice; false si no existe', async () => {
  const log: string[] = [];
  const { screen } = fake({
    elements: { [DEST_PRED]: [fakeEl(log, 'p0'), fakeEl(log, 'oculto', false), fakeEl(log, 'p2')] }
  });
  assert.equal(await screen.selectPrediction('destination', 1), true);
  assert.deepEqual(log, ['click:p2']); // el índice cuenta solo visibles
  assert.equal(await screen.selectPrediction('destination', 5), false);
});

test('readFieldValue / isFieldReadonly: leen el input (fallo -> valores neutros)', async () => {
  const ok = fake({ execute: () => 'Obelisco, Buenos Aires' });
  assert.equal(await ok.screen.readFieldValue('origin'), 'Obelisco, Buenos Aires');
  const bad = fake({
    execute: () => {
      throw new Error('x');
    }
  });
  assert.equal(await bad.screen.readFieldValue('origin'), '');
  assert.equal(await bad.screen.isFieldReadonly('origin'), false);
});

test('clearOrigin: toca la papelera si existe; false si no', async () => {
  const log: string[] = [];
  const withTrash = fake({
    elements: { [NEW_TRIP_LOCATORS.originClear.web as string]: [fakeEl(log, 'papelera')] }
  });
  assert.equal(await withTrash.screen.clearOrigin(), true);
  assert.deepEqual(log, ['click:papelera']);
  assert.equal(await fake({}).screen.clearOrigin(), false);
});

test('readConfirmCta: solo lectura del estado; falla -> ausente', async () => {
  const state = { present: true, visible: true, enabled: true, text: 'Seleccionar Vehículo' };
  const ok = fake({ execute: () => state });
  assert.deepEqual(await ok.screen.readConfirmCta(), state);
  assert.ok(
    !ok.log.some((c) => c.startsWith('click')) && !ok.log.some((c) => c.startsWith('$$')),
    'leer el CTA no hace click ni busca elementos'
  );
  const bad = fake({
    execute: () => {
      throw new Error('x');
    }
  });
  assert.deepEqual(await bad.screen.readConfirmCta(), {
    present: false,
    visible: false,
    enabled: false,
    text: ''
  });
});

test('SEGURIDAD: NewTripScreen no expone ningún método para confirmar/tocar el CTA ni pagar', () => {
  const methods = Object.getOwnPropertyNames(NewTripScreen.prototype).filter(
    (n) => n !== 'constructor'
  );
  // Ningún verbo de acción sobre confirmar/pago/vehículo/viaje.
  const forbidden =
    /(confirm|cta|vehicle|vehiculo|pay|pago|card|tarjeta|book|request|submit|travel|trip)/i;
  const offenders = methods.filter((n) => forbidden.test(n) && !/^(read|is)/.test(n));
  assert.deepEqual(offenders, [], `métodos prohibidos: ${offenders.join(', ')}`);
  // El único método que menciona el CTA es de lectura.
  assert.deepEqual(
    methods.filter((n) => /confirm|cta/i.test(n)),
    ['readConfirmCta']
  );
});

test('SEGURIDAD (estático): el locator del CTA solo se usa dentro de readConfirmCta y nunca con click', () => {
  const src = readFileSync(fileURLToPath(new URL('./NewTripScreen.ts', import.meta.url)), 'utf8');
  const uses = [...src.matchAll(/NEW_TRIP_LOCATORS\.confirmCta/g)];
  assert.equal(uses.length, 1, 'una sola referencia al locator del CTA');
  const start = src.indexOf('async readConfirmCta');
  const end = src.indexOf('async isTripBlockModalShown');
  assert.ok(
    uses[0]!.index! > start && uses[0]!.index! < end,
    'la referencia está en readConfirmCta'
  );
  const body = src.slice(start, end);
  assert.ok(
    !/\.click\(|\.tap\(|dispatchEvent|\.click\b/.test(body),
    'readConfirmCta no hace click'
  );
});

test('data: passengerAddressesFor usa AR por defecto y respeta región válida', () => {
  assert.equal(
    passengerAddressesFor(undefined).origin.query,
    passengerAddressesFor('xx').origin.query
  );
  assert.notEqual(
    passengerAddressesFor('us').origin.query,
    passengerAddressesFor('AR').origin.query
  );
  for (const r of ['AR', 'US', 'FR']) {
    const p = passengerAddressesFor(r);
    assert.ok(p.origin.query.length >= 3 && p.destination.query.length >= 3);
  }
});
