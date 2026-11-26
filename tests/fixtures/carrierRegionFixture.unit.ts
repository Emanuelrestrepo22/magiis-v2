import assert from 'node:assert/strict';
import { it } from 'node:test';
import { regionStorageStateCandidates } from './carrierRegionFixture.js';

it('UAT: AR/US/FR con nombres canónicos y alternativos', () => {
  assert.deepEqual(regionStorageStateCandidates('AR', 'uat'), [
    'storage/state-carrier-ar-uat.json',
    'storage/state-carrier-uat-ar.json'
  ]);
  assert.deepEqual(regionStorageStateCandidates('US', 'uat'), [
    'storage/state-carrier-us-uat.json',
    'storage/state-carrier-uat-us.json',
    'storage/state-carrier-circuit-1521-uat.json'
  ]);
  assert.equal(regionStorageStateCandidates('FR', 'uat')[1], 'storage/state-carrier-uat-fr.json');
});
it('TEST: un solo candidato por región (sin cambios)', () => {
  assert.deepEqual(regionStorageStateCandidates('AR', 'test'), [
    'storage/state-carrier-ar-test.json'
  ]);
});
