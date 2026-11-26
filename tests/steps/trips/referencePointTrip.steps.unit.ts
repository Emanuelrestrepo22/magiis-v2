// tests/steps/trips/referencePointTrip.steps.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  futureTripDate,
  searchTextFor,
  zonedWallTimeToUtcIso
} from './referencePointTrip.steps.js';

describe('referencePointTrip.steps (helpers puros)', () => {
  it('futureTripDate da MM/DD/YYYY a N dias en la zona del carrier', () => {
    const now = Date.UTC(2026, 10, 19, 15, 0); // 19/11/2026 10:00 en Nueva York
    assert.equal(futureTripDate(6, now), '11/25/2026');
    assert.equal(futureTripDate(12, now), '12/01/2026');
  });
  it('zonedWallTimeToUtcIso convierte la hora de pared de la zona a UTC', () => {
    assert.equal(
      zonedWallTimeToUtcIso({ date: '2026-11-25', hour: 10, minute: 0 }, 'America/Chicago'),
      '2026-11-25T16:00:00.000Z'
    );
    assert.equal(
      zonedWallTimeToUtcIso({ date: '2026-07-01', hour: 10, minute: 30 }, 'America/New_York'),
      '2026-07-01T14:30:00.000Z'
    );
  });
  it('searchTextFor usa el prefijo propio y el runId', () => {
    assert.equal(searchTextFor('TOR8E3KC'), 'QA AUTO TOR8E3KC');
  });
});
