// tests/api/clients/places.client.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { autocompleteQuery, checkPlacePath } from './places.client.js';

describe('autocompleteQuery', () => {
  it('sin carrierId no lo manda; con carrierId lo agrega', () => {
    assert.equal(autocompleteQuery({ address: 'eze' }, 'tok'), 'address=eze&sessionToken=tok');
    assert.equal(
      autocompleteQuery({ address: 'ñan', carrierId: 1521 }, 'tok'),
      'address=%C3%B1an&sessionToken=tok&carrierId=1521'
    );
  });
});

describe('checkPlacePath', () => {
  it('waypoint es opcional y el placeId va codificado', () => {
    assert.equal(checkPlacePath('ChIJ_a b'), 'places/checkPlace/ChIJ_a%20b');
    assert.equal(
      checkPlacePath('MGWP-1-1', { waypoint: true }),
      'places/checkPlace/MGWP-1-1?waypoint=true'
    );
    assert.equal(checkPlacePath('X', { waypoint: false }), 'places/checkPlace/X');
  });
});
