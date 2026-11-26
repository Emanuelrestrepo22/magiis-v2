// Unit de OtherCostsModalScreen / OtherCostsSummaryScreen con driver fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/driver/otherCosts/otherCostsScreens.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import type { MobileActorConfig } from '../../../config/appiumRuntime.js';
import { MobileSession } from '../../../core/MobileSession.js';
import { OTHER_COSTS_MODAL_LOCATORS, OtherCostsModalScreen } from './OtherCostsModalScreen.js';
import { OtherCostsSummaryScreen, paymentCodeFromIconSrc } from './OtherCostsSummaryScreen.js';

const CONFIG = { actor: 'driver' } as unknown as MobileActorConfig;

type FakeEl = { displayed: boolean; enabled: boolean; text: string; clicks: number };
const el = (text: string, over: Partial<FakeEl> = {}): FakeEl => ({
  displayed: true,
  enabled: true,
  text,
  clicks: 0,
  ...over
});
const wrap = (e: FakeEl) => ({
  isDisplayed: async () => e.displayed,
  isEnabled: async () => e.enabled,
  getText: async () => e.text,
  click: async () => {
    e.clicks++;
  }
});

function sessionFor(opts: { byCss: Record<string, FakeEl[]>; execute?: unknown }): MobileSession {
  const driver = {
    getContext: async () => 'WEBVIEW_com.example',
    $$: async (sel: string) => (opts.byCss[sel] ?? []).map(wrap),
    execute: async (...args: unknown[]) =>
      typeof opts.execute === 'function'
        ? (opts.execute as (...a: unknown[]) => unknown)(...args)
        : null
  } as unknown as Browser;
  return new MobileSession(CONFIG, { driver, log: () => undefined });
}

test('locators: la clase del modal y los botones coinciden con travel-resume.ts / travel-add-other.html de develop', () => {
  assert.equal(OTHER_COSTS_MODAL_LOCATORS.modal.web, 'ion-modal.add-other-modal.show-modal');
  assert.match(String(OTHER_COSTS_MODAL_LOCATORS.save.web), /\.buttons button\.btn\.primary$/);
  assert.match(String(OTHER_COSTS_MODAL_LOCATORS.cancel.web), /button\.btn-outlined-red$/);
  assert.match(String(OTHER_COSTS_MODAL_LOCATORS.opener.web), /img\[src\*="addCost"\]/);
});

test('paymentCodeFromIconSrc: extrae el código del ícono (negro/blanco) y tolera query', () => {
  assert.equal(
    paymentCodeFromIconSrc('http://l/assets/svg/CHECKING_ACCOUNT-black.svg'),
    'CHECKING_ACCOUNT'
  );
  assert.equal(paymentCodeFromIconSrc('../../../assets/svg/CASH-white.svg?v=2'), 'CASH');
  assert.equal(paymentCodeFromIconSrc('/x/CREDIT_CARD.svg'), 'CREDIT_CARD');
  assert.equal(paymentCodeFromIconSrc(''), '');
});

test('OtherCostsModalScreen.selectConcept: toca solo la opción con el texto exacto', async () => {
  const wanted = el('QA E2E OC FIX AAAA');
  const other = el('QA E2E OC FIX BBBB');
  let popover = 1;
  let saveEnabled = false;
  const optionSel = String(OTHER_COSTS_MODAL_LOCATORS.option.web);
  const session = sessionFor({
    byCss: { [optionSel]: [other, wanted] },
    execute: (_fn: unknown, arg: unknown) => {
      if (arg === 'ion-popover.select-popover') return popover;
      // readForm (modal selector): devuelve el estado
      saveEnabled = true;
      return { selectedConcept: 'x', amount: '10', amountEditable: false, saveEnabled };
    }
  });
  const screen = new OtherCostsModalScreen(session);
  const done = screen.selectConcept('QA E2E OC FIX AAAA');
  popover = 0; // el popover cierra tras el clic
  await done;
  assert.equal(wanted.clicks, 1);
  assert.equal(other.clicks, 0);
});

test('OtherCostsModalScreen.selectConcept: sin opción con ese texto lanza con el selector en el mensaje', async () => {
  const optionSel = String(OTHER_COSTS_MODAL_LOCATORS.option.web);
  const session = sessionFor({ byCss: { [optionSel]: [el('Otro')] } });
  await assert.rejects(
    () => new OtherCostsModalScreen(session).selectConcept('No existe', 200),
    /no apareció un elemento visible y habilitado/
  );
});

test('OtherCostsModalScreen.cancelIfOpen: sin modal abierto no toca nada', async () => {
  const cancel = el('Cancelar');
  const session = sessionFor({
    byCss: { [String(OTHER_COSTS_MODAL_LOCATORS.cancel.web)]: [cancel] },
    execute: () => 0
  });
  assert.equal(await new OtherCostsModalScreen(session).cancelIfOpen(), false);
  assert.equal(cancel.clicks, 0);
});

test('OtherCostsSummaryScreen.read: deriva medios de pago y el activo desde el ícono', async () => {
  const session = sessionFor({
    byCss: {},
    execute: () => ({
      rows: [['Tarifa', '$ 5.00']],
      fare: '$ 5.00',
      otherFees: '$ 10.00',
      otherFeeItems: ['QA E2E OC FIX AAAA $ 10.00'],
      total: '$ 15.00',
      commission: null,
      payments: [
        { src: '/svg/CASH-white.svg', active: false },
        { src: '/svg/CHECKING_ACCOUNT-black.svg', active: true }
      ],
      closeButtonText: 'Firmar y Cerrar viaje'
    })
  });
  const s = await new OtherCostsSummaryScreen(session).read();
  assert.deepEqual(s.paymentMethods, ['CASH', 'CHECKING_ACCOUNT']);
  assert.equal(s.activePaymentMethod, 'CHECKING_ACCOUNT');
  assert.equal(s.otherFees, '$ 10.00');
  assert.equal('payments' in s, false);
});

test('OtherCostsSummaryScreen.read: sin Resumen visible lanza', async () => {
  const session = sessionFor({ byCss: {}, execute: () => null });
  await assert.rejects(
    () => new OtherCostsSummaryScreen(session).read(),
    /no se está en el Resumen/
  );
});
