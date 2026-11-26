// tests/helpers/waypoint-delete-guard.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOwnWaypointDelete } from './waypoint-delete-guard.js';

const base = 'https://apps-test.magiis.com/magiis-v0.2/carriers/1521/waypoint';

describe('waypoint-delete-guard', () => {
  it('deja pasar solo el id propio, con query o barra final', () => {
    assert.equal(isOwnWaypointDelete(`${base}/77`, 77), true);
    assert.equal(isOwnWaypointDelete(`${base}/77?x=1`, 77), true);
    assert.equal(isOwnWaypointDelete(`${base}/77/`, 77), true);
  });
  it('aborta otro id, prefijo de id, subruta y la coleccion', () => {
    assert.equal(isOwnWaypointDelete(`${base}/7`, 77), false);
    assert.equal(isOwnWaypointDelete(`${base}/770`, 77), false);
    assert.equal(isOwnWaypointDelete(`${base}/77/usage`, 77), false);
    assert.equal(isOwnWaypointDelete(base, 77), false);
  });
});
