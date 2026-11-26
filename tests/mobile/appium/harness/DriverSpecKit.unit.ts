// Unit de las piezas puras de DriverSpecKit (sin Appium ni Playwright runner; solo fakes y valores inventados).
// Run: npx tsx --test tests/mobile/appium/harness/DriverSpecKit.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDriverProfile } from '../data/driverProfiles.js';
import {
  attachEvidence,
  credentialsSkipReason,
  environmentSkipReason,
  isPendingXrayKey,
  missingProfileKeys,
  newRunLabel,
  resolveDriverSpecProfile,
  resolveSpecLocale,
  xrayKeyAnnotations
} from './DriverSpecKit.js';

test('xrayKeyAnnotations: key real -> annotation tms; placeholder/inválida -> nada', () => {
  assert.deepEqual(xrayKeyAnnotations('TM-1234'), [{ type: 'tms', description: 'TM-1234' }]);
  assert.deepEqual(xrayKeyAnnotations(' MG-7 '), [{ type: 'tms', description: 'MG-7' }]);
  assert.deepEqual(xrayKeyAnnotations('TODO_TM_KEY_DRIVER_LOGIN'), []);
  assert.deepEqual(xrayKeyAnnotations(''), []);
  assert.deepEqual(xrayKeyAnnotations('tm-12'), []);
  assert.equal(isPendingXrayKey('TODO_TM_KEY_X'), true);
  assert.equal(isPendingXrayKey('TM-1'), false);
});

test('resolveDriverSpecProfile: default = app Chofer de 1521; DRIVER_PROFILE y carrier se respetan; desconocidos fallan', () => {
  const def = resolveDriverSpecProfile({});
  assert.equal(def.id, 'prep:com.magiis.app.test.driver');
  assert.equal(def.emailKey, 'DRIVER_EMAIL');
  assert.equal(def.passwordKey, 'DRIVER_PASSWORD');
  assert.ok(def.displayName);
  assert.equal(def.credentialsFile, undefined, 'las credenciales salen de MOBILE_CREDENTIALS_FILE');
  assert.equal(resolveDriverSpecProfile({ CIRCUIT_CARRIER: '1521' }).id, def.id);
  assert.equal(resolveDriverSpecProfile({ F5_CARRIER: '1521', CIRCUIT_CARRIER: '9' }).id, def.id);
  assert.equal(resolveDriverSpecProfile({ DRIVER_PROFILE: ' fr-1901 ' }).id, 'fr-1901');
  assert.throws(() => resolveDriverSpecProfile({ DRIVER_PROFILE: 'nope' }), /desconocido/);
  assert.throws(() => resolveDriverSpecProfile({ CIRCUIT_CARRIER: 'nope' }), /desconocido/);
});

test('resolveSpecLocale: APP_LOCALE gana; perfil conocido por mapa; derivado asume es; inválido falla', () => {
  const derived = resolveDriverSpecProfile({});
  assert.equal(resolveSpecLocale(derived, {}), 'es');
  assert.equal(resolveSpecLocale(derived, { APP_LOCALE: ' en ' }), 'en');
  assert.equal(resolveSpecLocale(getDriverProfile('fr-1901'), {}), 'fr');
  assert.throws(() => resolveSpecLocale(derived, { APP_LOCALE: 'pt' }), /inválido/);
});

test('environmentSkipReason: prod bloqueado; test/uat/savio permitidos', () => {
  assert.match(environmentSkipReason('prod') ?? '', /PROD/);
  for (const e of ['test', 'uat', 'savio'] as const) assert.equal(environmentSkipReason(e), null);
});

test('missingProfileKeys / credentialsSkipReason: nombran claves, nunca valores', () => {
  const p = getDriverProfile('test-default');
  assert.deepEqual(missingProfileKeys(p, {}), [
    'DRIVER_EMAIL',
    'DRIVER_PASSWORD',
    'DRIVER_DISPLAY_NAME'
  ]);
  assert.deepEqual(
    missingProfileKeys(p, { DRIVER_EMAIL: 'a', DRIVER_PASSWORD: 'b', DRIVER_DISPLAY_NAME: 'c' }),
    []
  );
  assert.equal(
    credentialsSkipReason(p, () => ({ email: 'a', password: 'b', displayName: 'c' })),
    null
  );
  const reason = credentialsSkipReason(p, () => {
    throw new Error('Falta la clave de email en archivo: DRIVER_EMAIL');
  });
  assert.match(reason ?? '', /DRIVER_EMAIL/);
});

test('newRunLabel: <spec>-<yyyymmddThhmmss>', () => {
  assert.equal(
    newRunLabel('driver-login', new Date('2026-11-13T10:20:30.456Z')),
    'driver-login-20261113T102030'
  );
});

test('attachEvidence: delega en Evidence.attachTo con la etiqueta de respaldo y devuelve las capturas', async () => {
  const calls: string[] = [];
  const shots = [{ label: 'x', relPath: 'evidence/x.png' }];
  const evidence = {
    attachTo: async (_a: unknown, fallback?: string) => {
      calls.push(fallback ?? '');
      return shots;
    }
  };
  const testInfo = { attach: async () => undefined };
  assert.deepEqual(await attachEvidence(testInfo, evidence as never, 'final'), shots);
  assert.deepEqual(calls, ['final']);
});
