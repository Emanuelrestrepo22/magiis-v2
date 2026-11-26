import assert from 'node:assert/strict';
import { it } from 'node:test';
import { newClosedSurrenderId, parsePairOverride, pickPendingPair } from './f5-pending-pair.js';

const row = (driverId: number, vehicleId: number, travelsToSurrender?: number) => ({
  driverId,
  vehicleId,
  travelsToSurrender
});

it('parsePairOverride: formato válido, vacío y basura', () => {
  assert.deepEqual(parsePairOverride(' 5076 / 3849 '), { driverUserId: 5076, vehicleId: 3849 });
  assert.equal(parsePairOverride(undefined), null);
  assert.equal(parsePairOverride('  '), null);
  assert.throws(() => parsePairOverride('5076'), /inválido/);
  assert.throws(() => parsePairOverride('0/1'), /inválido/);
});
it('pickPendingPair: sin override elige el de menos viajes y desempata por ids', () => {
  const p = pickPendingPair([row(9, 1, 5), row(7, 2, 2), row(6, 3, 2), row(8, 4, 0)]);
  assert.deepEqual(p, { driverUserId: 6, vehicleId: 3, travels: 2 });
});
it('pickPendingPair: grilla vacía o sin viajes > 0 → null', () => {
  assert.equal(pickPendingPair([]), null);
  assert.equal(pickPendingPair([row(1, 1, 0)]), null);
});
it('pickPendingPair: filas sin conteo de viajes siguen siendo candidatas', () => {
  assert.deepEqual(pickPendingPair([row(3, 4)]), { driverUserId: 3, vehicleId: 4, travels: 0 });
});
it('pickPendingPair: override presente en la grilla / ausente', () => {
  const rows = [row(1, 1, 1), row(2, 2, 9)];
  assert.deepEqual(pickPendingPair(rows, { driverUserId: 2, vehicleId: 2 }), {
    driverUserId: 2,
    vehicleId: 2,
    travels: 9
  });
  assert.equal(pickPendingPair(rows, { driverUserId: 5, vehicleId: 5 }), null);
});
it('pickPendingPair: ignora filas con ids inválidos', () => {
  assert.equal(pickPendingPair([row(0, 1, 3), row(1, Number.NaN, 3)]), null);
});
it('newClosedSurrenderId: exactamente una nueva; 0 o 2 lanzan', () => {
  assert.equal(newClosedSurrenderId([1, 2], [3, 1, 2]), 3);
  assert.throws(() => newClosedSurrenderId([1, 2], [1, 2]), /exactamente 1/);
  assert.throws(() => newClosedSurrenderId([1], [1, 2, 3]), /exactamente 1/);
});
