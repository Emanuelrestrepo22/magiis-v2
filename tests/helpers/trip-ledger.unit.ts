import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import type { TravelsClient } from '../api/clients/travels.client.js';
import {
  ADMIN_CIRCUIT_LEDGER_SCOPE,
  ledgerAdd,
  ledgerList,
  ledgerRemove,
  recordAdminCircuitTrip,
  recordLeakedTrip,
  recoverLeakedTrips
} from './trip-ledger.js';

const ENV = 'uat' as const;
const SCOPE = 'unit-test-ledger';
const OTHER = 'unit-test-ledger-other';

afterEach(() => {
  for (const s of [SCOPE, OTHER]) rmSync(`evidence/${ENV}/${s}-open-trips.json`, { force: true });
  rmSync(`evidence/${ENV}/${ADMIN_CIRCUIT_LEDGER_SCOPE}-done-trips.json`, { force: true });
});

describe('trip-ledger', () => {
  it('adds without duplicates and removes by id', () => {
    recordLeakedTrip(ENV, 1, 'r1', SCOPE);
    ledgerAdd(ENV, { travelId: 1, runId: 'r1', recordedAt: 'x' }, SCOPE);
    recordLeakedTrip(ENV, 2, 'r1', SCOPE);
    assert.deepEqual(
      ledgerList(ENV, SCOPE).map((e) => e.travelId),
      [1, 2]
    );
    ledgerRemove(ENV, 1, SCOPE);
    assert.deepEqual(
      ledgerList(ENV, SCOPE).map((e) => e.travelId),
      [2]
    );
  });

  it('sweeps only trips of its own scope', async () => {
    recordLeakedTrip(ENV, 10, 'r', SCOPE);
    recordLeakedTrip(ENV, 20, 'r', OTHER);
    const cancelled: number[] = [];
    const api = {
      getDetail: async () => ({ state: 'SEARCHING_DRIVER' }),
      cancel: async (id: number) => {
        cancelled.push(id);
      }
    } as unknown as TravelsClient;
    const result = await recoverLeakedTrips(api, ENV, SCOPE);
    assert.deepEqual(result.cancelled, [10]);
    assert.deepEqual(cancelled, [10]);
    assert.deepEqual(ledgerList(ENV, SCOPE), []);
    assert.deepEqual(
      ledgerList(ENV, OTHER).map((e) => e.travelId),
      [20]
    );
  });

  it('drops terminal-state trips from the ledger without cancelling', async () => {
    recordLeakedTrip(ENV, 30, 'r', SCOPE);
    recordLeakedTrip(ENV, 31, 'r', SCOPE);
    const cancelled: number[] = [];
    const api = {
      getDetail: async (id: number) => ({ state: id === 30 ? 'DONE' : 'LOST' }),
      cancel: async (id: number) => {
        cancelled.push(id);
      }
    } as unknown as TravelsClient;
    const result = await recoverLeakedTrips(api, ENV, SCOPE);
    assert.deepEqual(result.cancelled, []);
    assert.deepEqual(cancelled, []);
    assert.deepEqual(ledgerList(ENV, SCOPE), []);
  });

  it('never sweeps the admin-circuit scope', async () => {
    recordAdminCircuitTrip(ENV, 40, 'r');
    let calls = 0;
    const api = {
      getDetail: async () => {
        calls++;
        return { state: 'SEARCHING_DRIVER' };
      },
      cancel: async () => {
        calls++;
      }
    } as unknown as TravelsClient;
    const result = await recoverLeakedTrips(api, ENV, ADMIN_CIRCUIT_LEDGER_SCOPE);
    assert.deepEqual(result, { cancelled: [], failed: [] });
    assert.equal(calls, 0);
    assert.deepEqual(
      ledgerList(ENV, ADMIN_CIRCUIT_LEDGER_SCOPE).map((e) => e.travelId),
      [40]
    );
  });
});
