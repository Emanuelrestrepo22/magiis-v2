// Unit de OfferPBO con screens fake (sin Appium). Run: npx tsx --test tests/mobile/appium/pbo/OfferPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IrreversibleNotConfirmedError,
  OfferMismatchError,
  OfferPBO,
  type IrreversibleOptions
} from './OfferPBO.js';

function build(opts: { seenId?: string | null; visibleText?: string } = {}) {
  const calls: string[] = [];
  const rec = (name: string) => async () => void calls.push(name);
  const pbo = new OfferPBO(
    {
      confirm: {
        waitUntilShown: rec('confirm.shown'),
        readTravelId: async () => (opts.seenId === undefined ? '61545' : opts.seenId),
        readVisibleText: async () => opts.visibleText ?? '',
        acceptOffer: rec('confirm.accept'),
        waitUntilLeft: rec('confirm.left')
      },
      toStart: {
        waitUntilShown: rec('start.shown'),
        tapStartTrip: rec('start.tap'),
        waitForConfirmModal: rec('start.modal'),
        confirmStart: rec('start.yes'),
        waitUntilLeft: rec('start.left')
      }
    },
    { log: () => undefined }
  );
  return { pbo, calls };
}

// Valores que NO son `true` estricto: ninguno debe abrir el gate (incluye llamadas JS sin tipos).
const NOT_CONFIRMED: unknown[] = [
  { confirmed: false },
  {},
  undefined,
  { confirmed: 'true' },
  { confirmed: 1 }
];

test('acceptAssignedTrip: sin { confirmed: true } lanza IrreversibleNotConfirmedError y no toca nada', async () => {
  for (const options of NOT_CONFIRMED) {
    const { pbo, calls } = build();
    await assert.rejects(
      () => pbo.acceptAssignedTrip(options as IrreversibleOptions),
      IrreversibleNotConfirmedError
    );
    assert.deepEqual(calls, [], `options=${JSON.stringify(options)}`);
  }
});

test('startTrip: sin { confirmed: true } lanza IrreversibleNotConfirmedError y no toca nada', async () => {
  for (const options of NOT_CONFIRMED) {
    const { pbo, calls } = build();
    await assert.rejects(
      () => pbo.startTrip(options as IrreversibleOptions),
      IrreversibleNotConfirmedError
    );
    assert.deepEqual(calls, [], `options=${JSON.stringify(options)}`);
  }
});

test('el error del gate nombra la acción y el token esperado', async () => {
  const { pbo } = build();
  await assert.rejects(
    () => pbo.acceptAssignedTrip({ confirmed: false }),
    (e: Error) =>
      e.name === 'IrreversibleNotConfirmedError' &&
      /Aceptar la oferta/.test(e.message) &&
      /confirmed: true/.test(e.message)
  );
});

test('acceptAssignedTrip con { confirmed: true }: acepta y devuelve el travelId de la URL', async () => {
  const { pbo, calls } = build();
  const res = await pbo.acceptAssignedTrip({ confirmed: true });
  assert.deepEqual(calls, ['confirm.shown', 'confirm.accept', 'confirm.left']);
  assert.deepEqual(res, { travelId: '61545' });
});

test('startTrip con { confirmed: true }: tap -> modal -> Sí -> pantalla se va', async () => {
  const { pbo, calls } = build();
  await pbo.startTrip({ confirmed: true });
  assert.deepEqual(calls, ['start.shown', 'start.tap', 'start.modal', 'start.yes', 'start.left']);
});

test('peekOffer: solo lee el travelId, sin aceptar (no requiere confirmación)', async () => {
  const { pbo, calls } = build();
  assert.deepEqual(await pbo.peekOffer(), { travelId: '61545' });
  assert.deepEqual(calls, ['confirm.shown']);
});

test('assertOfferMatches: coincide por id, o no se exige (travelId null)', async () => {
  const { pbo, calls } = build();
  assert.deepEqual(await pbo.assertOfferMatches({ travelId: 61545 }), {
    travelId: '61545',
    matchedBy: 'travelId'
  });
  assert.equal((await pbo.assertOfferMatches({ travelId: null })).matchedBy, 'not-required');
  assert.ok(!calls.includes('confirm.accept'), 'el guard nunca acepta');
});

test('assertOfferMatches: id distinto lanza OfferMismatchError y no acepta nada', async () => {
  const { pbo, calls } = build({ seenId: '999' });
  await assert.rejects(() => pbo.assertOfferMatches({ travelId: 61545 }), OfferMismatchError);
  assert.ok(!calls.includes('confirm.accept'));
});

test('assertOfferMatches: sin id en la URL acepta solo si el código visible coincide', async () => {
  const ok = build({ seenId: null, visibleText: 'Viaje 5282-W Cannes' });
  assert.equal(
    (await ok.pbo.assertOfferMatches({ travelId: 5282, travelCode: '5282-W' })).matchedBy,
    'travelCode'
  );
  const bad = build({ seenId: null, visibleText: 'Viaje 1111-W' });
  await assert.rejects(
    () => bad.pbo.assertOfferMatches({ travelId: 5282, travelCode: '5282-W' }),
    OfferMismatchError
  );
  const noCode = build({ seenId: null, visibleText: '5282-W' });
  await assert.rejects(() => noCode.pbo.assertOfferMatches({ travelId: 5282 }), OfferMismatchError);
});
