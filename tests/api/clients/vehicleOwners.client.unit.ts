// tests/api/clients/vehicleOwners.client.unit.ts

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractVehicleIds } from './vehicleOwners.client.js';

describe('extractVehicleIds', () => {
  it('arreglo de objetos con id o vehicleId bajo una clave «vehicle»', () => {
    assert.deepEqual(extractVehicleIds({ vehicles: [{ id: 5356 }] }), [5356]);
    assert.deepEqual(
      extractVehicleIds({ ownerVehicles: [{ vehicleId: 3849 }, { vehicleId: 3869 }] }),
      [3849, 3869]
    );
  });
  it('un nivel de anidado', () => {
    assert.deepEqual(extractVehicleIds({ owner: { vehicleList: [{ id: 1 }] } }), [1]);
  });
  it('sin arreglo reconocible o con elementos sin id: null (la guarda falla cerrada)', () => {
    assert.equal(extractVehicleIds({ name: 'x' }), null);
    assert.equal(extractVehicleIds({ vehicles: [{ plate: 'AB' }] }), null);
    assert.equal(extractVehicleIds({ vehicles: 'no' }), null);
  });
});
