// tests/helpers/waypoints-contract.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AutocompleteItem } from '../api/clients/places.client.js';
import {
  carrierItems,
  distanceMeters,
  isSortedByNormalizedName,
  itemsOfWaypoints,
  normalizeName,
  parseUtcTimestamp,
  parseWaypointPlaceId
} from './waypoints-contract.js';

const item = (placeId: string, source: AutocompleteItem['source']): AutocompleteItem => ({
  placeId,
  mainText: placeId,
  secondaryText: null,
  shortName: placeId,
  latitude: null,
  longitude: null,
  airport: source === 'AIRPORT',
  iataCode: null,
  source,
  reference: null
});

describe('normalizeName', () => {
  it('quita tildes, la ñ pasa a n y baja a minusculas', () => {
    assert.equal(normalizeName('Añelo ÁVILA Éxodo Ñandú'), 'anelo avila exodo nandu');
  });
});

describe('parseWaypointPlaceId', () => {
  it('lee id y version de MGWP-{id}-{v} y rechaza placeIds de Google', () => {
    assert.deepEqual(parseWaypointPlaceId('MGWP-12-3'), { id: 12, version: 3 });
    assert.equal(parseWaypointPlaceId('ChIJabc'), null);
    assert.equal(parseWaypointPlaceId('MGWP-12'), null);
  });
});

describe('filtros de items', () => {
  const items = [item('MGWP-1-1', 'CARRIER'), item('MGWP-1-2', 'CARRIER'), item('ChIJ', 'GOOGLE')];
  it('carrierItems deja solo source CARRIER', () => {
    assert.equal(carrierItems(items).length, 2);
  });
  it('itemsOfWaypoints toma cualquier version del id', () => {
    assert.equal(itemsOfWaypoints(items, [1]).length, 2);
    assert.equal(itemsOfWaypoints(items, [2]).length, 0);
  });
});

describe('parseUtcTimestamp', () => {
  it('interpreta el texto como UTC sin importar la zona local', () => {
    assert.equal(
      parseUtcTimestamp('2026-11-17T13:29:26.447'),
      Date.UTC(2026, 10, 17, 13, 29, 26, 447)
    );
    assert.equal(parseUtcTimestamp(null), null);
  });
  it('rechaza texto que no es ISO', () => {
    assert.throws(() => parseUtcTimestamp('17/11/2026 13:29'), /no ISO/);
  });
});

describe('distanceMeters', () => {
  it('0.006 grados de latitud son unos 667 m', () => {
    const d = distanceMeters({ lat: 25, lng: -80 }, { lat: 25.006, lng: -80 });
    assert.ok(d > 660 && d < 675);
  });
});

describe('isSortedByNormalizedName', () => {
  it('ordena por nombre normalizado, no por codepoint', () => {
    assert.equal(isSortedByNormalizedName(['Añelo', 'Anzola', 'Ñandú', 'Nube']), true);
    assert.equal(isSortedByNormalizedName(['Anzola', 'Añelo', 'Nube', 'Ñandú']), false);
  });
});
