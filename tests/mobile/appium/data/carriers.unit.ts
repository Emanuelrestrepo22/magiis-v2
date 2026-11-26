// Unit test del delta móvil por carrier y su resolución (sin Appium, sin env).
// Run: npx tsx --test tests/mobile/appium/data/carriers.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  GPS_ROUTES_DIR,
  MOBILE_CARRIERS,
  V2_ROUTE_ALIASES,
  findMobileCarrier,
  getMobileCarrier,
  loadCarrierRoute,
  resolveDriverProfileId,
  type MobileCarrierRegistry
} from './carriers.js';
import { DRIVER_PROFILES } from './driverProfiles.js';
import {
  knownCircuitCarriers,
  peekCarrierProfile,
  type CarrierProfile
} from '../../../config/carrier-profiles.js';
import { analyzeRoutePlan } from '../gps/RoutePlan.js';
import { haversineMeters } from '../gps/GpsRouteFeeder.js';

test('cada carrier apunta a un perfil V2, a perfiles de chofer y a una ruta existentes', () => {
  for (const id of Object.keys(MOBILE_CARRIERS)) {
    assert.ok(knownCircuitCarriers().includes(id), `perfil V2 ${id}`);
    const c = getMobileCarrier(id);
    assert.ok(c.appLocale.length >= 2, `appLocale ${id}`);
    for (const p of Object.values(c.driverProfiles))
      assert.ok(p! in DRIVER_PROFILES, `perfil de chofer ${p}`);
    assert.ok(loadCarrierRoute(c).length >= 2, `ruta ${c.routeId}`);
  }
});

test('el delta no duplica hechos del perfil V2: moneda y región se leen de carrier-profiles', () => {
  const us = getMobileCarrier('1521');
  assert.equal(us.appLocale, 'en-US');
  assert.equal(resolveDriverProfileId(us, 'test'), 'test-default');
  const fr = getMobileCarrier('1901');
  assert.equal(fr.appLocale, 'fr-FR');
  assert.equal(resolveDriverProfileId(fr, 'test'), 'fr-1901');
  const usV2 = peekCarrierProfile('1521') as CarrierProfile;
  const frV2 = peekCarrierProfile('1901') as CarrierProfile;
  assert.deepEqual([usV2.region, usV2.currency.code], ['US', 'USD']);
  assert.deepEqual([frV2.region, frV2.currency.code], ['FR', 'EUR']);
  const duplicated = ['carrierId', 'name', 'region', 'currency'];
  for (const delta of Object.values(MOBILE_CARRIERS)) {
    assert.deepEqual(
      Object.keys(delta).filter((k) => duplicated.includes(k)),
      []
    );
  }
  assert.equal(findMobileCarrier(1901).profileId, '1901');
  assert.equal(findMobileCarrier(1521).profileId, '1521');
});

test('carrier o perfil inexistente falla nombrando el problema', () => {
  assert.throws(() => getMobileCarrier('9999'), /Carrier "9999" sin datos móviles/);
  assert.throws(() => findMobileCarrier(9999), /Carrier 9999 sin datos móviles/);
  assert.throws(() => resolveDriverProfileId(getMobileCarrier('1901'), 'uat'), /1901.*"uat"/);
  assert.throws(
    () => loadCarrierRoute(getMobileCarrier('1901'), '../../package.json'),
    /fuera de gps\/routes/
  );
});

test('segundo carrier = 1 entrada de datos, 0 cambios de código', () => {
  const registry: MobileCarrierRegistry = {
    ...MOBILE_CARRIERS,
    '7777': {
      appLocale: 'pt-BR',
      routeId: 'us/miami-brickell.json',
      driverProfiles: { test: 'test-mp' }
    }
  };
  const c = getMobileCarrier('7777', registry);
  assert.equal(resolveDriverProfileId(c, 'test'), 'test-mp');
  assert.ok(loadCarrierRoute(c).length > 2);
});

test('la resolución de ruta es pura (mismo resultado, registro congelado) y acepta el alias V2 cannes-niza', () => {
  const frozen: MobileCarrierRegistry = Object.freeze({ ...MOBILE_CARRIERS });
  const c = getMobileCarrier('1521', frozen);
  assert.deepEqual(loadCarrierRoute(c), loadCarrierRoute(c));
  assert.equal(V2_ROUTE_ALIASES['cannes-niza'], 'cannes-nice.json');
  assert.deepEqual(loadCarrierRoute(c, 'cannes-niza'), loadCarrierRoute(c, 'cannes-nice.json'));
});

function listRoutes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listRoutes(path.join(dir, e.name))
      : e.name.endsWith('.json')
        ? [path.join(dir, e.name)]
        : []
  );
}

test('ruta US del 1521: paso constante, sin violaciones duras, 2-3 km y arranca/termina en el origen/destino del alta F5', () => {
  const route = loadCarrierRoute(getMobileCarrier('1521'));
  const plan = analyzeRoutePlan(route, { stepMeters: 30, intervalMs: 2_000 });
  assert.deepEqual(plan.violations, []);
  assert.equal(plan.shortSegments, 0);
  assert.ok(
    plan.theoreticalMeters > 2_000 && plan.theoreticalMeters < 3_000,
    `m=${plan.theoreticalMeters}`
  );
  assert.ok(plan.durationSeconds >= 90 && plan.durationSeconds <= 400, `s=${plan.durationSeconds}`);
  // Origen 900 Collins Ave y destino 1111 Lincoln Rd (Miami Beach): sin salto desde otro punto (11/11).
  assert.ok(haversineMeters(route[0], { lat: 25.7797, lng: -80.1311 }) < 100, 'origen');
  assert.ok(
    haversineMeters(route[route.length - 1], { lat: 25.7906, lng: -80.1393 }) < 100,
    'destino'
  );
});

test('todas las rutas del repo pasan RoutePlan sin violaciones duras', () => {
  const files = listRoutes(GPS_ROUTES_DIR);
  assert.ok(files.length >= 3);
  for (const f of files) {
    const rel = path.relative(GPS_ROUTES_DIR, f).split(path.sep).join('/');
    const plan = analyzeRoutePlan(loadCarrierRoute(getMobileCarrier('1901'), rel), {
      stepMeters: 30,
      intervalMs: 2_000
    });
    assert.deepEqual(plan.violations, [], rel);
  }
});
