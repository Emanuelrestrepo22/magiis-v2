// tests/utils/networkWatch.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeRequest,
  isWatchedPlacesUrl,
  redactUrl,
  splitOwnGetPlace
} from './networkWatch.js';
import { toViewportPoint } from './leafletMap.js';

describe('networkWatch (falla cerrado)', () => {
  it('vigila getPlace del backend y todo Google fuera de la lista benigna', () => {
    assert.equal(isWatchedPlacesUrl('https://x/magiis-v0.2/places/getPlace?placeId=1'), true);
    assert.equal(
      isWatchedPlacesUrl('https://maps.googleapis.com/maps/api/place/autocomplete/json'),
      true
    );
    assert.equal(isWatchedPlacesUrl('https://maps.googleapis.com/maps/api/geocode/json'), true);
    assert.equal(isWatchedPlacesUrl('https://places.googleapis.com/v1/places:autocomplete'), true);
    assert.equal(isWatchedPlacesUrl('https://geocode.googleapis.com/v4beta/geocode/address'), true);
    assert.equal(
      isWatchedPlacesUrl('https://addressvalidation.googleapis.com/v1:validateAddress'),
      true
    );
    assert.equal(
      isWatchedPlacesUrl('https://maps.googleapis.com/maps/api/js/GeocodeService.Search?x=1'),
      true
    );
    assert.equal(
      isWatchedPlacesUrl(
        'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/NuevoMetodo'
      ),
      true,
      'un metodo nuevo de Google sale rojo hasta clasificarlo'
    );
    assert.equal(isWatchedPlacesUrl('https://maps.google.com/maps/api/algo'), true);
  });
  it('no vigila el backend de la app salvo getPlace', () => {
    assert.equal(isWatchedPlacesUrl('https://x/magiis-v0.2/places/autocomplete?address=a'), false);
    assert.equal(isWatchedPlacesUrl('https://x/magiis-v0.2/places/checkPlace/ChIJ'), false);
    assert.equal(isWatchedPlacesUrl('https://apps-test.magiis.com/carrier/main.js'), false);
  });
  it('no vigila el trafico benigno medido del mapa', () => {
    for (const url of [
      'https://maps.googleapis.com/maps/api/js?libraries=places&loading=async',
      'https://maps.googleapis.com/maps-api-v3/api/js/67/1b/places_impl.js',
      'https://maps.googleapis.com/maps/vt?pb=1',
      'https://maps.googleapis.com/maps/api/mapsjs/gen_204?csp_test=true',
      'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo',
      'https://fonts.googleapis.com/css?family=Roboto'
    ]) {
      assert.equal(isWatchedPlacesUrl(url), false, url);
    }
  });
  it('redactUrl tacha key y sessionToken y conserva el resto', () => {
    assert.equal(
      redactUrl('https://x/places/getPlace?placeId=MGWP-1-1&sessionToken=abc&key=K'),
      'https://x/places/getPlace?placeId=MGWP-1-1&sessionToken=REDACTADO&key=REDACTADO'
    );
  });
  it('registra sin query', () => {
    assert.equal(describeRequest('GET', 'https://x/a?key=SECRET'), 'GET https://x/a');
  });
});

describe('splitOwnGetPlace', () => {
  it('separa el getPlace de un punto propio comparando el placeId completo', () => {
    const own = 'https://x/places/getPlace?placeId=MGWP-84-1';
    const prefixOnly = 'https://x/places/getPlace?placeId=MGWP-84-10';
    const google = 'https://x/places/getPlace?placeId=ChIJabc';
    assert.deepEqual(splitOwnGetPlace([own, prefixOnly, google], ['MGWP-84-1']), {
      own: [own],
      other: [prefixOnly, google]
    });
  });
});

describe('leafletMap', () => {
  it('toViewportPoint suma el origen del contenedor', () => {
    assert.deepEqual(toViewportPoint({ x: 100, y: 50 }, { x: 10, y: 5 }), { x: 110, y: 55 });
  });
});
