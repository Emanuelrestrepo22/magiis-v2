// tests/helpers/zone-coverage.unit.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coordinateInArea, parsePolygon, pointInPolygon } from './zone-coverage.js';

const USA = '[{48.5,-124.7};{32.8,-117.5};{25.8,-97.1};{25.0,-80.6};{44.5,-67.1};{48.5,-95.0}]';

describe('zone-coverage', () => {
  it('parsea el poligono y detecta puntos dentro y fuera', () => {
    const polygon = parsePolygon(USA);
    assert.equal(polygon.length, 6);
    assert.equal(pointInPolygon({ lat: 39.0, lng: -98.0 }, polygon), true);
    assert.equal(pointInPolygon({ lat: -34.35, lng: -61.3 }, polygon), false);
  });
  it('circulo: dentro del radio sí, fuera no; zip sin geometria = null', () => {
    const circle = { AREA_TYPE: 'C', CIRCLE: '{-34.47,-58.72,62.5}', POLYGON: null, ZIPCODE: 0 };
    assert.equal(coordinateInArea({ lat: -34.47, lng: -58.9 }, circle), true);
    assert.equal(coordinateInArea({ lat: -34.35, lng: -61.3 }, circle, 2), false);
    assert.equal(
      coordinateInArea(
        { lat: 0, lng: 0 },
        { AREA_TYPE: 'Z', CIRCLE: null, POLYGON: null, ZIPCODE: 5521 }
      ),
      null
    );
  });
});
