import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SurrenderClient } from '../api/clients/surrender.client.js';
import { readIsolation } from './fr-preflight.js';

const fake = (
  rows: Array<{ travelId?: number }>,
  summary: Array<{ driverId: number; vehicleId: number }>
) =>
  ({
    preview: async () => ({ rows }),
    pendingSummary: async () => summary
  }) as unknown as SurrenderClient;

describe('fr-preflight', () => {
  it('readIsolation: devuelve lote y resumen filtrado, sin lanzar aunque no este vacio', async () => {
    const r = await readIsolation({
      surrender: fake(
        [{ travelId: 5 }, {}],
        [
          { driverId: 1, vehicleId: 2 },
          { driverId: 9, vehicleId: 9 }
        ]
      ),
      batch: { driverUserId: 1, vehicleId: 2 },
      now: new Date(Date.UTC(2026, 9, 21, 13, 10))
    });
    assert.deepEqual(r.batchRows, [5, null]);
    assert.equal(r.summaryRows, 1);
    assert.deepEqual(r.foreignTrips, []);
    assert.equal(r.cashCollectorFlag, null);
    assert.equal(r.cronWindow.inWindow, true);
  });
});
