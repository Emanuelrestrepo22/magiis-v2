// Unit de perfiles de chofer: solo fakes y archivos temporales con valores inventados.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { PrepApp } from '../../../config/carrier-profiles.js';
import {
  createFileDriverIdentityReader,
  driverIdentityFromValues,
  driverProfileFromPrepApp,
  DRIVER_PROFILES,
  getDriverProfile,
  readDriverPreflightExpectation,
  selectDriverProfile,
  type DriverIdentityReader
} from './driverProfiles.js';

const dir = mkdtempSync(path.join(tmpdir(), 'driverProfiles-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const SECRET = 'SECRETO-NO-LOGUEAR';

function write(name: string, lines: string[]): string {
  const file = path.join(dir, name);
  writeFileSync(file, lines.join('\n'));
  return file;
}

describe('selección de perfil', () => {
  it('sin selector → test-default; con selector → ese perfil', () => {
    assert.equal(selectDriverProfile().id, 'test-default');
    assert.equal(selectDriverProfile('  ').id, 'test-default');
    assert.equal(selectDriverProfile('fr-1901').carrierId, 1901);
    assert.equal(selectDriverProfile('test-mp').emailKey, 'DRIVER_EMAIL_MP');
  });

  it('mantiene los nombres de clave de V1', () => {
    assert.deepEqual(
      Object.values(DRIVER_PROFILES).map((p) => [p.emailKey, p.passwordKey, p.displayNameKey]),
      [
        ['DRIVER_EMAIL_FR', 'DRIVER_PASSWORD_FR', 'DRIVER_DISPLAY_NAME_FR'],
        ['DRIVER_EMAIL', 'DRIVER_PASSWORD', 'DRIVER_DISPLAY_NAME'],
        ['DRIVER_EMAIL_MP', 'DRIVER_PASSWORD_MP', 'DRIVER_DISPLAY_NAME_MP']
      ]
    );
  });

  it('perfil desconocido lista los disponibles', () => {
    assert.throws(
      () => getDriverProfile('nope'),
      /desconocido "nope".*fr-1901, test-default, test-mp/
    );
  });
});

describe('driverIdentityFromValues', () => {
  it('nombra TODAS las claves faltantes y nunca valores', () => {
    const p = getDriverProfile('fr-1901');
    assert.throws(
      () => driverIdentityFromValues(p, {}),
      (e) =>
        e instanceof Error &&
        e.message.includes('DRIVER_EMAIL_FR, DRIVER_PASSWORD_FR, DRIVER_DISPLAY_NAME_FR')
    );
    assert.throws(
      () =>
        driverIdentityFromValues(p, {
          DRIVER_EMAIL_FR: 'x@example.invalid',
          DRIVER_PASSWORD_FR: SECRET
        }),
      (e) =>
        e instanceof Error &&
        /DRIVER_DISPLAY_NAME_FR/.test(e.message) &&
        !e.message.includes(SECRET) &&
        !e.message.includes('x@example.invalid')
    );
  });

  it('resuelve con todas las claves (recorta espacios)', () => {
    const id = driverIdentityFromValues(getDriverProfile('test-default'), {
      DRIVER_EMAIL: ' a@example.invalid ',
      DRIVER_PASSWORD: SECRET,
      DRIVER_DISPLAY_NAME: ' Chofer Prueba '
    });
    assert.deepEqual(id, {
      email: 'a@example.invalid',
      password: SECRET,
      displayName: 'Chofer Prueba'
    });
  });
});

describe('driverProfileFromPrepApp', () => {
  const app: PrepApp = {
    package: 'com.magiis.app.test.driver',
    version: '2.6.17',
    udid: 'emulator-5554',
    driverLabel: 'Prueba, Chofer',
    credentialEnv: { email: 'FAKE_DRV_EMAIL', password: 'FAKE_DRV_PASS' },
    credentialEnvFile: '.env.fake',
    credentialsMatchPair: true
  };

  it('mapea claves, archivo y etiqueta sin tocar la PrepApp', () => {
    const p = driverProfileFromPrepApp(app);
    assert.equal(p.emailKey, 'FAKE_DRV_EMAIL');
    assert.equal(p.passwordKey, 'FAKE_DRV_PASS');
    assert.equal(p.displayName, 'Prueba, Chofer');
    assert.equal(p.credentialsFile, '.env.fake');
    assert.equal(p.id, 'prep:com.magiis.app.test.driver');
  });

  it('el nombre literal no exige displayNameKey', () => {
    const id = driverIdentityFromValues(driverProfileFromPrepApp(app), {
      FAKE_DRV_EMAIL: 'a@example.invalid',
      FAKE_DRV_PASS: SECRET
    });
    assert.equal(id.displayName, 'Prueba, Chofer');
  });
});

describe('readDriverPreflightExpectation (lector inyectado)', () => {
  it('arma la expectativa desde el fake, con expectedTravelId opcional', () => {
    const reader: DriverIdentityReader = () => ({
      email: 'a@example.invalid',
      password: SECRET,
      displayName: 'Chofer Prueba'
    });
    const p = getDriverProfile('test-default');
    const base = readDriverPreflightExpectation(p, 'pkg', undefined, reader);
    assert.equal('expectedTravelId' in base, false);
    assert.equal(base.driverDisplayName, 'Chofer Prueba');
    assert.equal(readDriverPreflightExpectation(p, 'pkg', 71510, reader).expectedTravelId, 71510);
  });
});

describe('createFileDriverIdentityReader (archivo temporal inventado)', () => {
  it('lee email, password y nombre por clave', () => {
    const file = write('ok', [
      'DRIVER_EMAIL=a@example.invalid',
      `DRIVER_PASSWORD=${SECRET}`,
      'DRIVER_DISPLAY_NAME=Chofer Prueba'
    ]);
    const id = createFileDriverIdentityReader({ file })(getDriverProfile('test-default'));
    assert.deepEqual(id, {
      email: 'a@example.invalid',
      password: SECRET,
      displayName: 'Chofer Prueba'
    });
  });

  it('clave faltante: el error nombra la clave y no filtra valores', () => {
    const file = write('sin-nombre', [
      'DRIVER_EMAIL=a@example.invalid',
      `DRIVER_PASSWORD=${SECRET}`
    ]);
    assert.throws(
      () => createFileDriverIdentityReader({ file })(getDriverProfile('test-default')),
      (e) =>
        e instanceof Error &&
        e.message.includes('DRIVER_DISPLAY_NAME') &&
        !e.message.includes(SECRET) &&
        !e.message.includes('a@example.invalid')
    );
  });

  it('el archivo del perfil (PrepApp) gana sobre la opción', () => {
    const file = write('prep', ['K_E=b@example.invalid', `K_P=${SECRET}`]);
    const id = createFileDriverIdentityReader({ file: path.join(dir, 'otro') })({
      id: 'prep:x',
      description: 'x',
      carrierId: null,
      emailKey: 'K_E',
      passwordKey: 'K_P',
      displayName: 'Prueba, Chofer',
      credentialsFile: file
    });
    assert.equal(id.email, 'b@example.invalid');
  });
});
