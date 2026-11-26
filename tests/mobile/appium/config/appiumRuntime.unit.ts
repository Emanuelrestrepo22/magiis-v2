import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  buildAndroidCapabilities,
  buildAppiumRemoteConnection,
  getDriverAppConfig,
  getPassengerAppConfig
} from './appiumRuntime.js';

const MANAGED = [
  'ENV',
  'APPIUM_SERVER_URL',
  'APPIUM_BASE_PATH',
  'ANDROID_DRIVER_APP_PATH',
  'ANDROID_PASSENGER_APP_PATH',
  'ANDROID_DRIVER_APP_PACKAGE',
  'ANDROID_PASSENGER_APP_PACKAGE',
  'ANDROID_UDID',
  'ANDROID_DRIVER_UDID',
  'ANDROID_SYSTEM_PORT',
  'ANDROID_DRIVER_SYSTEM_PORT',
  'ANDROID_PASSENGER_SYSTEM_PORT',
  'ANDROID_LANGUAGE',
  'ANDROID_LOCALE',
  'APPIUM_FORCE_APP_LAUNCH',
  'APPIUM_CHROMEDRIVER_AUTODOWNLOAD',
  'APPIUM_CHROMEDRIVER_EXECUTABLE',
  'APPIUM_CHROMEDRIVER_DISABLE_BUILD_CHECK',
  'APPIUM_ADB_EXEC_TIMEOUT'
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(MANAGED.map((k) => [k, process.env[k]]));
  for (const k of MANAGED) delete process.env[k];
  process.env.APPIUM_SERVER_URL = 'http://localhost:4723';
});

afterEach(() => {
  for (const k of MANAGED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('appiumRuntime', () => {
  it('sin variables opcionales: capabilities base sin claves opcionales', () => {
    const caps = buildAndroidCapabilities(getDriverAppConfig());
    assert.equal(caps['appium:automationName'], 'UiAutomator2');
    assert.equal(caps['appium:appActivity'], '.MainActivity');
    assert.equal(caps['appium:appPackage'], 'com.magiis.app.test.driver');
    assert.equal(caps['appium:noReset'], true);
    for (const key of [
      'appium:systemPort',
      'appium:language',
      'appium:locale',
      'appium:forceAppLaunch',
      'appium:udid',
      'appium:chromedriverExecutable',
      'appium:chromedriverAutodownload',
      'appium:chromedriverDisableBuildCheck',
      'appium:adbExecTimeout',
      'appium:app'
    ]) {
      assert.equal(key in caps, false, key);
    }
  });

  it('con variables: incluye cada capability opcional exactamente una vez', () => {
    Object.assign(process.env, {
      ANDROID_UDID: 'emulator-fake',
      ANDROID_DRIVER_SYSTEM_PORT: '8201',
      ANDROID_LANGUAGE: 'es',
      ANDROID_LOCALE: 'AR',
      APPIUM_FORCE_APP_LAUNCH: 'true',
      APPIUM_CHROMEDRIVER_EXECUTABLE: '/fake/chromedriver',
      APPIUM_CHROMEDRIVER_DISABLE_BUILD_CHECK: 'true',
      APPIUM_ADB_EXEC_TIMEOUT: '60000'
    });
    const caps = buildAndroidCapabilities(getDriverAppConfig());
    assert.equal(caps['appium:adbExecTimeout'], 60000);
    assert.equal(caps['appium:udid'], 'emulator-fake');
    assert.equal(caps['appium:systemPort'], 8201);
    assert.equal(caps['appium:language'], 'es');
    assert.equal(caps['appium:locale'], 'AR');
    assert.equal(caps['appium:forceAppLaunch'], true);
    assert.equal(caps['appium:chromedriverExecutable'], '/fake/chromedriver');
    assert.equal(caps['appium:chromedriverDisableBuildCheck'], true);
    const keys = Object.keys(caps);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('ENV desconocido lanza error', () => {
    process.env.ENV = 'uta';
    assert.throws(() => getDriverAppConfig(), /uta/);
  });

  it('package map por ambiente y actor', () => {
    const expected: Array<[string, string, string]> = [
      ['test', 'com.magiis.app.test.driver', 'com.magiis.app.test.passenger'],
      ['uat', 'com.magiis.app.uat.driver', 'com.magiis.app.uat.passenger'],
      ['prod', 'com.magiis.app.driver', 'com.magiis.app.passenger']
    ];
    for (const [env, driver, passenger] of expected) {
      process.env.ENV = env;
      assert.equal(getDriverAppConfig().appPackage, driver);
      assert.equal(getPassengerAppConfig().appPackage, passenger);
    }
    process.env.ENV = 'savio';
    assert.equal(getPassengerAppConfig().appPackage, 'com.magiis.app.savio.passenger');
    assert.equal(getDriverAppConfig().appPackage, null);
  });

  it('modo APK con ANDROID_DRIVER_APP_PATH', () => {
    process.env.ANDROID_DRIVER_APP_PATH = '/fake/app.apk';
    const config = getDriverAppConfig();
    assert.equal(config.noReset, false);
    const caps = buildAndroidCapabilities(config);
    assert.equal(caps['appium:app'], '/fake/app.apk');
    assert.equal(caps['appium:appPackage'], 'com.magiis.app.test.driver');
  });

  it('la conexión se deriva de la URL y falta APPIUM_SERVER_URL lanza error', () => {
    process.env.APPIUM_SERVER_URL = 'http://fake-host:4444/wd/hub';
    const conn = buildAppiumRemoteConnection(getDriverAppConfig());
    assert.deepEqual(conn, {
      protocol: 'http',
      hostname: 'fake-host',
      port: 4444,
      path: '/wd/hub'
    });
    delete process.env.APPIUM_SERVER_URL;
    assert.throws(() => getDriverAppConfig(), /APPIUM_SERVER_URL/);
  });
});

describe('appiumRuntime · adbExecTimeout', () => {
  it('APPIUM_ADB_EXEC_TIMEOUT inválido lanza error con el nombre de la clave', () => {
    process.env.APPIUM_ADB_EXEC_TIMEOUT = '20s';
    assert.throws(() => getDriverAppConfig(), /APPIUM_ADB_EXEC_TIMEOUT/);
  });
});
