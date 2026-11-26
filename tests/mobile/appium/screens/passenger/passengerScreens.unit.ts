// Unit de LoginScreen / HomeModeScreen PAX con driver fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/passenger/passengerScreens.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import type { MobileActorConfig } from '../../config/appiumRuntime.js';
import { MobileSession } from '../../core/MobileSession.js';
import { classifyHomeMode, HomeModeScreen, PASSENGER_HOME_LOCATORS } from './HomeModeScreen.js';
import { LoginScreen, normalizeForMatch, PASSENGER_LOGIN_LOCATORS } from './LoginScreen.js';
import { PASSENGER_SIDE_MENU_LOCATORS, SideMenuScreen } from './SideMenuScreen.js';

const CONFIG = {
  actor: 'passenger',
  environment: 'test',
  appiumServerUrl: 'http://127.0.0.1:4723',
  appiumBasePath: '/',
  appPath: null,
  appPackage: 'com.example.passenger',
  appActivity: '.MainActivity',
  deviceName: 'emulator-5554',
  platformVersion: '14',
  udid: 'emulator-5554',
  newCommandTimeout: 60,
  noReset: true,
  fullReset: false,
  chromedriverAutodownload: false,
  chromedriverExecutable: null
} as MobileActorConfig;

type Call = { args: unknown[] };

/** Driver fake: `execute` responde con `handler(args, n)` y registra las llamadas. */
function fake(handler: (args: unknown[], n: number) => unknown) {
  const calls: Call[] = [];
  const driver = {
    getContext: async () => 'WEBVIEW_com.example',
    execute: async (_fn: unknown, ...args: unknown[]) => {
      calls.push({ args });
      return handler(args, calls.length - 1);
    }
  } as unknown as Browser;
  return { session: new MobileSession(CONFIG, { driver, log: () => undefined }), calls };
}

test('normalizeForMatch quita acentos, mayúsculas y espacios repetidos', () => {
  assert.equal(
    normalizeForMatch('  Usuario o Contraseña   Inválidos, verifica '),
    'usuario o contrasena invalidos, verifica'
  );
});

test('locators PAX usan los selectores relevados en vivo', () => {
  assert.deepEqual(PASSENGER_LOGIN_LOCATORS.submitButton.web, 'button.btn-login');
  assert.ok(
    (PASSENGER_LOGIN_LOCATORS.emailInput.web as readonly string[])[0]?.includes(
      'formcontrolname="username"'
    )
  );
  assert.ok(
    (PASSENGER_LOGIN_LOCATORS.passwordInput.web as readonly string[])[0]?.includes(
      'formcontrolname="password"'
    )
  );
});

test('fillAndSubmit: completa ambos campos y envía; las credenciales viajan solo como argumento', async () => {
  const { session, calls } = fake((_args, n) =>
    n === 0 ? { emailFilled: true, passwordFilled: true } : true
  );
  const out = await new LoginScreen(session).fillAndSubmit('a@b.test', 'pw');
  assert.deepEqual(out, { emailFilled: true, passwordFilled: true, submitted: true });
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.args.includes('a@b.test') && calls[0]!.args.includes('pw'));
});

test('fillAndSubmit: si falta un campo NO envía', async () => {
  const { session, calls } = fake(() => ({ emailFilled: true, passwordFilled: false }));
  const out = await new LoginScreen(session).fillAndSubmit('a@b.test', 'pw');
  assert.deepEqual(out, { emailFilled: true, passwordFilled: false, submitted: false });
  assert.equal(calls.length, 1);
});

test('fillAndSubmit: botón no encontrado -> submitted=false', async () => {
  const { session } = fake((_a, n) =>
    n === 0 ? { emailFilled: true, passwordFilled: true } : false
  );
  const out = await new LoginScreen(session).fillAndSubmit('a', 'b');
  assert.equal(out.submitted, false);
});

test('readErrorModal: devuelve estado del modal y {false,""} ante error del driver', async () => {
  const shown = fake(() => ({
    shown: true,
    text: 'Usuario o Contraseña Inválidos, verifica tus datos.'
  }));
  assert.deepEqual(await new LoginScreen(shown.session).readErrorModal(), {
    shown: true,
    text: 'Usuario o Contraseña Inválidos, verifica tus datos.'
  });
  const broken = fake(() => {
    throw new Error('boom');
  });
  assert.deepEqual(await new LoginScreen(broken.session).readErrorModal(), {
    shown: false,
    text: ''
  });
});

test('closeErrorModal: refleja si había botón', async () => {
  assert.equal(await new LoginScreen(fake(() => true).session).closeErrorModal(), true);
  assert.equal(await new LoginScreen(fake(() => false).session).closeErrorModal(), false);
});

test('waitForErrorModal: espera hasta que aparece con texto', async () => {
  let n = 0;
  const { session } = fake(() =>
    n++ < 2 ? { shown: false, text: '' } : { shown: true, text: 'X' }
  );
  const out = await new LoginScreen(session).waitForErrorModal({ interval: 1, timeout: 2_000 });
  assert.deepEqual(out, { shown: true, text: 'X' });
});

test('classifyHomeMode: «Modo Personal» y «Compañía» (con/sin acento)', () => {
  assert.equal(classifyHomeMode('Hola\nModo Personal\nViajes'), 'personal');
  assert.equal(classifyHomeMode('Compañía'), 'company');
  assert.equal(classifyHomeMode('COMPANIA'), 'company');
  assert.equal(classifyHomeMode('Ingresar'), 'none');
});

test('HomeModeScreen.readMode lee el texto del body', async () => {
  const { session } = fake(() => 'Modo Personal');
  assert.equal(await new HomeModeScreen(session).readMode(), 'personal');
});

test('classifyHomeMode: etiquetas en inglés («Personal Mode» / «Company: X»)', () => {
  assert.equal(classifyHomeMode('Personal Mode'), 'personal');
  assert.equal(classifyHomeMode('Company: Acme'), 'company');
  assert.equal(classifyHomeMode('Compañía: Acme'), 'company');
});

test('locators del home PAX relevados del código (div.toggle-container)', () => {
  assert.equal(PASSENGER_HOME_LOCATORS.modeLabel.web, 'div.toggle-container .toggle_label');
  assert.equal(PASSENGER_HOME_LOCATORS.modeToggle.web, 'div.toggle-container ion-toggle');
});

test('HomeModeScreen.readMode: usa la etiqueta y solo cae al body si la etiqueta no clasifica', async () => {
  const byLabel = fake(() => 'Compañía: Acme');
  assert.equal(await new HomeModeScreen(byLabel.session).readMode(), 'company');
  assert.equal(byLabel.calls.length, 1);
  const fallback = fake((_a, n) => (n === 0 ? '' : 'Modo Personal'));
  assert.equal(await new HomeModeScreen(fallback.session).readMode(), 'personal');
  assert.equal(fallback.calls.length, 2);
  const broken = fake(() => {
    throw new Error('boom');
  });
  assert.equal(await new HomeModeScreen(broken.session).readMode(), 'none');
});

test('HomeModeScreen: isToggleVisible/isToggleDisabled/tapToggle reflejan el driver y toleran errores', async () => {
  const yes = new HomeModeScreen(fake(() => true).session);
  assert.equal(await yes.isToggleVisible(), true);
  assert.equal(await yes.isToggleDisabled(), true);
  assert.equal(await yes.tapToggle(), true);
  const no = new HomeModeScreen(fake(() => false).session);
  assert.equal(await no.isToggleVisible(), false);
  assert.equal(await no.isToggleDisabled(), false);
  assert.equal(await no.tapToggle(), false);
  const broken = new HomeModeScreen(
    fake(() => {
      throw new Error('boom');
    }).session
  );
  assert.equal(await broken.isToggleVisible(), false);
  assert.equal(await broken.isToggleDisabled(), true);
  assert.equal(await broken.tapToggle(), false);
});

test('SideMenuScreen: locators relevados del código (ion-menu, toggle de la barra, button.log-out-menu)', () => {
  assert.equal(PASSENGER_SIDE_MENU_LOCATORS.menu.web, 'ion-menu');
  assert.ok(
    (PASSENGER_SIDE_MENU_LOCATORS.menuToggle.web as readonly string[])[0]?.includes(
      'ion-menu-toggle'
    )
  );
  assert.ok(String(PASSENGER_SIDE_MENU_LOCATORS.logout.web).includes('button.log-out-menu'));
});

test('SideMenuScreen: open/close/isLogoutVisible/tapLogout reflejan el resultado del driver y toleran errores', async () => {
  const yes = new SideMenuScreen(fake(() => true).session);
  assert.equal(await yes.open(), true);
  assert.equal(await yes.close(), true);
  assert.equal(await yes.isLogoutVisible(), true);
  assert.equal(await yes.tapLogout(), true);
  const no = new SideMenuScreen(fake(() => false).session);
  assert.equal(await no.isLogoutVisible(), false);
  assert.equal(await no.tapLogout(), false);
  const broken = new SideMenuScreen(
    fake(() => {
      throw new Error('boom');
    }).session
  );
  assert.equal(await broken.open(), false);
  assert.equal(await broken.tapLogout(), false);
});
