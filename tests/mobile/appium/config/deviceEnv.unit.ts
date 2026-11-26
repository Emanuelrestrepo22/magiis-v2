import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { loadDeviceEnv, readMobileCredentials } from './deviceEnv.js';

const dir = mkdtempSync(path.join(tmpdir(), 'deviceEnv-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, lines: string[]): string {
  const file = path.join(dir, name);
  writeFileSync(file, lines.join('\n'));
  return file;
}

const missing = (): string => path.join(dir, 'no-existe');

describe('loadDeviceEnv (decisión provisional G-04)', () => {
  it('la shell nunca se pisa, ni por el archivo base ni por el overlay', () => {
    const base = write('base1', ['ANDROID_UDID=emulator-base']);
    const overlay = write('overlay1', ['ANDROID_UDID=emulator-overlay']);
    const env: NodeJS.ProcessEnv = { ANDROID_UDID: 'emulator-shell' };
    loadDeviceEnv({
      env,
      shellKeys: new Set(['ANDROID_UDID']),
      baseFile: base,
      overlayFile: overlay
    });
    assert.equal(env.ANDROID_UDID, 'emulator-shell');
  });

  it('el overlay pisa un valor cargado desde el archivo base para claves ANDROID_/APPIUM_', () => {
    const base = write('base2', [
      'ANDROID_UDID=emulator-base',
      'APPIUM_SERVER_URL=http://base:4723'
    ]);
    const overlay = write('overlay2', [
      'ANDROID_UDID=emulator-fake',
      'APPIUM_SERVER_URL=http://fake:4723'
    ]);
    const env: NodeJS.ProcessEnv = {};
    const result = loadDeviceEnv({
      env,
      shellKeys: new Set(),
      baseFile: base,
      overlayFile: overlay
    });
    assert.equal(env.ANDROID_UDID, 'emulator-fake');
    assert.equal(env.APPIUM_SERVER_URL, 'http://fake:4723');
    assert.deepEqual([...result.applied].sort(), ['ANDROID_UDID', 'APPIUM_SERVER_URL']);
  });

  it('el overlay pisa un valor que ya estaba en env y no es de la shell', () => {
    const overlay = write('overlay3', ['ANDROID_UDID=emulator-fake']);
    const env: NodeJS.ProcessEnv = { ANDROID_UDID: 'from-dotenv' };
    loadDeviceEnv({ env, shellKeys: new Set(), baseFile: missing(), overlayFile: overlay });
    assert.equal(env.ANDROID_UDID, 'emulator-fake');
  });

  it('ignora claves fuera de la allowlist (ENV, credenciales, URLs)', () => {
    const overlay = write('overlay4', [
      'ENV=prod',
      'BASE_URL=https://other.example.test',
      'DRIVER_EMAIL=fake@example.test',
      'ANDROID_LANGUAGE=es'
    ]);
    const env: NodeJS.ProcessEnv = { ENV: 'test' };
    const result = loadDeviceEnv({
      env,
      shellKeys: new Set(['ENV']),
      baseFile: missing(),
      overlayFile: overlay
    });
    assert.equal(env.ENV, 'test');
    assert.equal(env.BASE_URL, undefined);
    assert.equal(env.DRIVER_EMAIL, undefined);
    assert.equal(env.ANDROID_LANGUAGE, 'es');
    assert.deepEqual([...result.ignored].sort(), ['BASE_URL', 'DRIVER_EMAIL', 'ENV']);
  });

  it('archivos inexistentes no fallan', () => {
    const env: NodeJS.ProcessEnv = {};
    const result = loadDeviceEnv({
      env,
      shellKeys: new Set(),
      baseFile: missing(),
      overlayFile: missing()
    });
    assert.deepEqual(result.applied, []);
  });
});

describe('readMobileCredentials', () => {
  const file = write('creds', [
    'DRIVER_EMAIL=fake@example.test',
    'DRIVER_PASSWORD=fake-pass',
    'USER_EMAIL=generic@example.test',
    'USER_PASSWORD=generic-pass',
    'EMPTY_EMAIL='
  ]);

  it('devuelve credenciales sin escribirlas en process.env', () => {
    const before = Object.keys(process.env).sort();
    const creds = readMobileCredentials({
      emailKey: 'DRIVER_EMAIL',
      passwordKey: 'DRIVER_PASSWORD',
      file
    });
    assert.deepEqual(creds, {
      email: 'fake@example.test',
      password: 'fake-pass',
      source: 'custom',
      file
    });
    assert.equal(process.env.DRIVER_EMAIL, undefined);
    assert.equal(process.env.DRIVER_PASSWORD, undefined);
    assert.deepEqual(Object.keys(process.env).sort(), before);
  });

  it('toma el archivo de MOBILE_CREDENTIALS_FILE como V1 (V2 inexistente se omite)', () => {
    const creds = readMobileCredentials({
      emailKey: 'DRIVER_EMAIL',
      passwordKey: 'DRIVER_PASSWORD',
      env: { MOBILE_V2_ENV_FILE: missing(), MOBILE_CREDENTIALS_FILE: file }
    });
    assert.equal(creds.email, 'fake@example.test');
    assert.equal(creds.source, 'v1');
    assert.equal(creds.file, file);
  });

  it('respeta el orden de claves de fallback (y salta vacías)', () => {
    const creds = readMobileCredentials({
      emailKey: 'MISSING_EMAIL',
      emailFallbackKeys: ['EMPTY_EMAIL', 'USER_EMAIL', 'DRIVER_EMAIL'],
      passwordKey: 'MISSING_PASSWORD',
      passwordFallbackKeys: ['DRIVER_PASSWORD', 'USER_PASSWORD'],
      file
    });
    assert.equal(creds.email, 'generic@example.test');
    assert.equal(creds.password, 'fake-pass');
  });

  it('clave faltante: el error nombra la clave y no contiene valores', () => {
    assert.throws(
      () => readMobileCredentials({ emailKey: 'DRIVER_EMAIL', passwordKey: 'NOPE_PASSWORD', file }),
      (err: Error) => {
        assert.match(err.message, /NOPE_PASSWORD/);
        assert.doesNotMatch(err.message, /fake/);
        return true;
      }
    );
  });

  it('archivo único faltante: el error nombra el archivo', () => {
    assert.throws(
      () => readMobileCredentials({ emailKey: 'A', passwordKey: 'B', file: missing() }),
      /no-existe/
    );
  });

  describe('orden V2 -> V1 (par del mismo archivo)', () => {
    const keys = { emailKey: 'USER_PASSENGER', passwordKey: 'PASS_PASSENGER' };

    it('V2 tiene el par: gana v2 aunque V1 también lo tenga', () => {
      const v2 = write('v2-full', ['USER_PASSENGER=v2@example.test', 'PASS_PASSENGER=v2-pass']);
      const v1 = write('v1-full', ['USER_PASSENGER=v1@example.test', 'PASS_PASSENGER=v1-pass']);
      const creds = readMobileCredentials({
        ...keys,
        env: { MOBILE_V2_ENV_FILE: v2, MOBILE_CREDENTIALS_FILE: v1 }
      });
      assert.deepEqual(creds, {
        email: 'v2@example.test',
        password: 'v2-pass',
        source: 'v2',
        file: v2
      });
    });

    it('archivo V2 inexistente: cae a v1', () => {
      const v1 = write('v1-only', ['USER_PASSENGER=v1@example.test', 'PASS_PASSENGER=v1-pass']);
      const creds = readMobileCredentials({
        ...keys,
        env: { MOBILE_V2_ENV_FILE: missing(), MOBILE_CREDENTIALS_FILE: v1 }
      });
      assert.equal(creds.source, 'v1');
      assert.equal(creds.email, 'v1@example.test');
    });

    it('V2 solo con email: se omite y el par completo sale de v1 (sin mezclar)', () => {
      const v2 = write('v2-email', ['USER_PASSENGER=v2@example.test']);
      const v1 = write('v1-pair', ['USER_PASSENGER=v1@example.test', 'PASS_PASSENGER=v1-pass']);
      const creds = readMobileCredentials({
        ...keys,
        env: { MOBILE_V2_ENV_FILE: v2, MOBILE_CREDENTIALS_FILE: v1 }
      });
      assert.equal(creds.source, 'v1');
      assert.equal(creds.email, 'v1@example.test');
      assert.equal(creds.password, 'v1-pass');
    });

    it('ENV_FILE se usa como archivo V2 si no hay MOBILE_V2_ENV_FILE', () => {
      const v2 = write('envfile', ['USER_PASSENGER=ef@example.test', 'PASS_PASSENGER=ef-pass']);
      const creds = readMobileCredentials({ ...keys, env: { ENV_FILE: v2 } });
      assert.equal(creds.source, 'v2');
      assert.equal(creds.file, v2);
    });

    it('cadena uat: toma USER_PASSENGER de V2', () => {
      const v2 = write('v2-uat', ['USER_PASSENGER=uat@example.test', 'PASS_PASSENGER=uat-pass']);
      const creds = readMobileCredentials({
        emailKey: 'PASSENGER_EMAIL_UAT',
        emailFallbackKeys: ['USER_PASSENGER_UAT', 'PASSENGER_EMAIL', 'USER_PASSENGER'],
        passwordKey: 'PASSENGER_PASSWORD_UAT',
        passwordFallbackKeys: ['PASS_PASSENGER_UAT', 'PASSENGER_PASSWORD', 'PASS_PASSENGER'],
        env: { MOBILE_V2_ENV_FILE: v2 }
      });
      assert.equal(creds.email, 'uat@example.test');
      assert.equal(creds.source, 'v2');
    });

    it('nada resuelve: el error lista archivos y claves, sin valores', () => {
      const v2 = write('v2-partial', ['USER_PASSENGER=SECRETO-V2']);
      const gone = missing();
      assert.throws(
        () =>
          readMobileCredentials({
            ...keys,
            env: { MOBILE_V2_ENV_FILE: v2, MOBILE_CREDENTIALS_FILE: gone }
          }),
        (err: Error) => {
          assert.ok(err.message.includes(v2));
          assert.ok(err.message.includes(gone));
          assert.match(err.message, /USER_PASSENGER/);
          assert.match(err.message, /PASS_PASSENGER/);
          assert.doesNotMatch(err.message, /SECRETO/);
          return true;
        }
      );
    });

    it('sin MOBILE_CREDENTIALS_FILE el error lo menciona', () => {
      assert.throws(
        () => readMobileCredentials({ ...keys, env: { MOBILE_V2_ENV_FILE: missing() } }),
        /MOBILE_CREDENTIALS_FILE/
      );
    });
  });
});
