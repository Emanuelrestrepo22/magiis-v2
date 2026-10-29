import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deltaMovements, snapshotBook, snapshotClientCc } from './cc-delta.js';

const row = (travelId: number, debit: number, creationDate = '2026-10-19T10:00:00.000+0000') => ({
  creationDate,
  travelId,
  concept: 'carrier.checking_accounts.concept_codes.TIVR',
  debit,
  credit: 0
});

describe('cc-delta (cliente)', () => {
  it('detecta solo el movimiento nuevo y por viaje', () => {
    const before = snapshotClientCc([row(1, 10)], -90);
    const after = snapshotClientCc([row(2, 25.5), row(1, 10)], -115.5);
    const delta = deltaMovements(before, after);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.byTravel.get(2)?.[0]?.debit, 25.5);
    assert.equal(delta.debitDelta, 25.5);
    assert.equal(delta.creditDelta, 0);
  });

  it('invierte el signo de la API a convencion DB', () => {
    const delta = deltaMovements(
      snapshotClientCc([], -90),
      snapshotClientCc([row(2, 25.5)], -115.5)
    );
    // API: -90 -> -115.5 ; DB: 90 -> 115.5
    assert.equal(delta.balanceDelta, 25.5);
  });

  it('cuenta filas identicas por separado (reintento duplicado)', () => {
    const before = snapshotClientCc([row(7, 5)], null);
    const after = snapshotClientCc([row(7, 5), row(7, 5)], null);
    const delta = deltaMovements(before, after);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.byTravel.get(7)?.length, 1);
    assert.equal(delta.balanceDelta, null);
  });

  it('sin cambios: delta vacio y cero', () => {
    const snap = snapshotClientCc([row(1, 10)], -90);
    const delta = deltaMovements(snap, snap);
    assert.deepEqual(delta.added, []);
    assert.equal(delta.debitDelta, 0);
    assert.equal(delta.balanceDelta, 0);
  });
});

describe('cc-delta (libros chofer/propietario)', () => {
  it('usa id como identidad y no invierte el saldo', () => {
    const before = snapshotBook(
      [{ id: 10, amount: 0, paid: 5, balance: 100, checkingAccountCode: 'TCEA' }],
      100
    );
    const after = snapshotBook(
      [
        { id: 11, amount: 40, paid: 0, balance: 140, checkingAccountCode: 'TDEA' },
        { id: 10, amount: 0, paid: 5, balance: 100, checkingAccountCode: 'TCEA' }
      ],
      140
    );
    const delta = deltaMovements(before, after);
    assert.equal(delta.added.length, 1);
    assert.equal(delta.added[0]?.concept, 'TDEA');
    assert.equal(delta.debitDelta, 40);
    assert.equal(delta.balanceDelta, 40);
    assert.equal(delta.byTravel.get(null)?.length, 1);
  });
});
