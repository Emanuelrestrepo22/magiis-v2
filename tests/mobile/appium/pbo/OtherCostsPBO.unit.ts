// Unit de OtherCostsPBO con deps fake (sin Appium). Run: npx tsx --test tests/mobile/appium/pbo/OtherCostsPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConceptNotOfferedError,
  OtherCostSaveDisabledError,
  OtherCostsPBO,
  buildOtherCostsComment,
  isAdditiveTotal,
  parseShownMoney,
  type OtherCostsPboDeps
} from './OtherCostsPBO.js';
import { IrreversibleNotConfirmedError } from './OfferPBO.js';
import type { OtherCostFormState } from '../screens/driver/otherCosts/OtherCostsModalScreen.js';

const NAME = 'QA E2E OC FIX ABCD1234';

function build(
  over: { offered?: string[]; form?: Partial<OtherCostFormState>; modalOpen?: boolean } = {}
) {
  const calls: string[] = [];
  let open = over.modalOpen ?? true;
  const form: OtherCostFormState = {
    selectedConcept: NAME,
    amount: '10.00',
    amountEditable: false,
    saveEnabled: true,
    ...over.form
  };
  const deps: OtherCostsPboDeps = {
    modal: {
      open: async () => void calls.push('open'),
      listOfferedConcepts: async () => over.offered ?? [NAME, 'Otro'],
      selectConcept: async (n: string) => void calls.push(`select:${n}`),
      readForm: async () => form,
      save: async () => {
        calls.push('save');
        open = false;
      },
      cancelIfOpen: async () => {
        calls.push('cancel');
        const was = open;
        open = false;
        return was;
      }
    },
    summary: {
      waitUntilRendered: async () => void calls.push('wait'),
      read: async () => ({
        rows: [],
        fare: '$ 5.00',
        otherFees: '$ 10.00',
        otherFeeItems: [],
        total: '$ 15.00',
        commission: null,
        activePaymentMethod: 'CASH',
        paymentMethods: ['CASH'],
        closeButtonText: null
      }),
      selectPaymentMethod: async (c) => void calls.push(`pay:${c}`)
    }
  };
  return { pbo: new OtherCostsPBO(deps, { log: () => undefined }), calls };
}

test('parseShownMoney: con $ manda lo que sigue al símbolo; sin $ vale el texto completo; AGREED -> null', () => {
  assert.equal(parseShownMoney('$ 10.00'), 10);
  assert.equal(parseShownMoney('$10,69'), 10.69);
  assert.equal(parseShownMoney('QA E2E OC FIX 1234 $ 10.00'), 10);
  assert.equal(parseShownMoney('10.00'), 10);
  assert.equal(parseShownMoney('AGREED'), null);
  assert.equal(parseShownMoney(null), null);
  assert.equal(parseShownMoney('QA E2E 3'), null);
});

test('isAdditiveTotal: tarifa + otros costos = total a 2 decimales; datos faltantes -> false', () => {
  assert.equal(isAdditiveTotal(5.34, 10, 15.34), true);
  assert.equal(isAdditiveTotal(0.1, 0.2, 0.3), true);
  assert.equal(isAdditiveTotal(5.34, 10, 5.34), false);
  assert.equal(isAdditiveTotal(null, 10, 10), false);
  assert.equal(isAdditiveTotal(1, undefined, 1), false);
});

test('buildOtherCostsComment: solo lo medido, ≤1500 caracteres', () => {
  const c = buildOtherCostsComment({
    env: 'test',
    appPackage: 'com.x',
    udid: 'emulator-5556',
    runId: 'r1'
  });
  assert.equal(c.split('\n').length, 1);
  assert.match(c, /TEST/);
  const full = buildOtherCostsComment({
    env: 'test',
    appPackage: 'com.x',
    udid: 'emulator-5556',
    runId: 'r1',
    concept: { name: NAME, saleValue: 10 },
    cleanup: { concepto: 'borrado', texto: 'x'.repeat(3000) }
  });
  assert.ok(full.length <= 1500);
  assert.match(full, /venta 10/);
});

test('addConcept sin {confirmed:true}: lanza IrreversibleNotConfirmedError y no toca la pantalla', async () => {
  const { pbo, calls } = build();
  await assert.rejects(
    () => pbo.addConcept(NAME, { confirmed: false }),
    IrreversibleNotConfirmedError
  );
  assert.deepEqual(calls, []);
});

test('addConcept confirmado: abre, verifica oferta, elige, lee el form y guarda', async () => {
  const { pbo, calls } = build();
  const r = await pbo.addConcept(NAME, { confirmed: true });
  assert.deepEqual(calls, ['open', `select:${NAME}`, 'save']);
  assert.equal(r.form.amount, '10.00');
  assert.deepEqual(r.offered, [NAME, 'Otro']);
});

test('addConcept: concepto no ofrecido -> ConceptNotOfferedError y el modal se cancela', async () => {
  const { pbo, calls } = build({ offered: ['Otro'] });
  await assert.rejects(() => pbo.addConcept(NAME, { confirmed: true }), ConceptNotOfferedError);
  assert.deepEqual(calls, ['open', 'cancel']);
});

test('addConcept: Guardar deshabilitado -> OtherCostSaveDisabledError, no guarda y cancela', async () => {
  const { pbo, calls } = build({ form: { saveEnabled: false } });
  await assert.rejects(() => pbo.addConcept(NAME, { confirmed: true }), OtherCostSaveDisabledError);
  assert.ok(!calls.includes('save'));
  assert.equal(calls.at(-1), 'cancel');
});

test('readSummary espera el render antes de leer; selectPaymentMethod delega con el código', async () => {
  const { pbo, calls } = build();
  const s = await pbo.readSummary();
  assert.equal(s.total, '$ 15.00');
  await pbo.selectPaymentMethod('CHECKING_ACCOUNT');
  assert.deepEqual(calls, ['wait', 'pay:CHECKING_ACCOUNT']);
});
