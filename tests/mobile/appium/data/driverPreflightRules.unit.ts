// Unit del pre-flight (reglas puras, sin Appium). Portado de V1 DriverTripPreflight.unit.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  confirmUrlMatchesTravel,
  driverNameMatches,
  evaluateDriverPreflight,
  type DriverPreflightSnapshot
} from './driverPreflightRules.js';

const PKG = 'com.magiis.app.test.driver';
const expected = { appPackage: PKG, driverDisplayName: 'Chofer Prueba' };
const ok: DriverPreflightSnapshot = {
  foregroundPackage: PKG,
  webUrl: 'http://localhost/#/navigator/home',
  headerTexts: ['CHÓFER prueba'],
  loggedOut: false
};

describe('evaluateDriverPreflight', () => {
  it('OK: paquete, chofer y sin viaje', () => {
    assert.deepEqual(evaluateDriverPreflight(ok, expected), []);
  });

  it('paquete equivocado (UAT en vez de TEST)', () => {
    const v = evaluateDriverPreflight(
      { ...ok, foregroundPackage: 'com.magiis.app.uat.driver' },
      expected
    );
    assert.equal(v.length, 1);
    assert.match(v[0]!, /primer plano/);
  });

  it('app deslogueada es violación (el login lo resuelve assertDriverPreflight)', () => {
    const v = evaluateDriverPreflight({ ...ok, loggedOut: true, headerTexts: [] }, expected);
    assert.match(v.join(), /deslogueada/);
  });

  it('chofer distinto o header vacío', () => {
    assert.match(
      evaluateDriverPreflight({ ...ok, headerTexts: ['Otro Chofer'] }, expected).join(),
      /chofer esperado/
    );
    assert.match(
      evaluateDriverPreflight({ ...ok, headerTexts: [] }, expected).join(),
      /chofer esperado/
    );
  });

  it('viaje en curso en cualquier stage no-cerrado', () => {
    for (const token of ['TravelConfirmPage', 'TravelInProgressPage', 'TravelResumePage']) {
      const v = evaluateDriverPreflight({ ...ok, webUrl: `http://x/#/${token}` }, expected);
      assert.match(v.join(), /viaje en curso/);
    }
  });

  it('oferta del viaje esperado: no cuenta como viaje en curso', () => {
    const url =
      'https://localhost/navigator/TravelConfirmPage;data=' +
      encodeURIComponent('{"travelId":71510,"simulatedPrice":2828}');
    const offer = { ...ok, webUrl: url, headerTexts: [] };
    assert.deepEqual(evaluateDriverPreflight(offer, { ...expected, expectedTravelId: 71510 }), []);
  });

  it('oferta de OTRO viaje: sigue abortando', () => {
    const url =
      'https://localhost/navigator/TravelConfirmPage;data=' +
      encodeURIComponent('{"travelId":71502}');
    const v = evaluateDriverPreflight(
      { ...ok, webUrl: url },
      { ...expected, expectedTravelId: 71510 }
    );
    assert.ok(v.some((x) => /viaje en curso/.test(x)));
  });
});

describe('confirmUrlMatchesTravel', () => {
  it('no confunde 7000 con 70001', () => {
    const url = 'x;data=' + encodeURIComponent('{"travelId":70001}');
    assert.equal(confirmUrlMatchesTravel(url, 7000), false);
    assert.equal(confirmUrlMatchesTravel(url, 70001), true);
  });
});

describe('driverNameMatches', () => {
  it('acepta el nombre del perfil V2 «Apellido, Nombre» contra el header «Nombre Apellido»', () => {
    assert.equal(driverNameMatches('pepe argentoinfoa', 'argentoinfoa, pepe'), true);
  });

  it('ignora mayúsculas, tildes y texto extra del header', () => {
    assert.equal(driverNameMatches('Hola, José Pérez · Disponible', 'Perez, Jose'), true);
  });

  it('rechaza si falta una de las palabras esperadas', () => {
    assert.equal(driverNameMatches('pepe gomez', 'argentoinfoa, pepe'), false);
  });

  it('rechaza un nombre esperado vacío', () => {
    assert.equal(driverNameMatches('pepe argentoinfoa', '  '), false);
  });
});
