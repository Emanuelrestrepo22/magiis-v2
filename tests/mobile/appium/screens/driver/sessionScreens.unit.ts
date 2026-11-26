// Unit de LoginScreen / PreHomeScreen / HomeScreen / SideMenuScreen con driver fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/screens/driver/sessionScreens.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import type { MobileActorConfig } from '../../config/appiumRuntime.js';
import { I18n, type I18nDictionaries } from '../../core/I18n.js';
import { MobileSession } from '../../core/MobileSession.js';
import { HomeScreen, classifyAvailability } from './HomeScreen.js';
import { LoginScreen, pickLoginSubmit } from './LoginScreen.js';
import { PreHomeScreen } from './PreHomeScreen.js';
import { SideMenuScreen } from './SideMenuScreen.js';
import { isHomeUrl, isLoginUrl, isNavigatorUrl, isPreHomeUrl } from './driverWeb.js';

const CONFIG = { actor: 'driver', environment: 'test' } as unknown as MobileActorConfig;

/** Driver fake: `execute` responde con `handler(args, n)`; el primer arg es la función (se ignora). */
function fake(handler: (args: unknown[], n: number) => unknown) {
  const calls: unknown[][] = [];
  const driver = {
    getContext: async () => 'WEBVIEW_com.example',
    execute: async (_fn: unknown, ...args: unknown[]) => {
      calls.push(args);
      return handler(args, calls.length - 1);
    }
  } as unknown as Browser;
  return { session: new MobileSession(CONFIG, { driver, log: () => undefined }), calls };
}

const DICTS: I18nDictionaries = {
  es: {
    'driver.home.available': ['Disponible'],
    'driver.home.notAvailable': ['No disponible'],
    'driver.buttons.accept': ['Aceptar', 'Tomar viaje']
  },
  en: {
    'driver.home.available': ['Available'],
    'driver.home.notAvailable': ['Not Available'],
    'driver.buttons.accept': ['Accept']
  },
  fr: {
    'driver.home.available': ['TODO-verificar'],
    'driver.home.notAvailable': ['TODO-verificar'],
    'driver.buttons.accept': ['TODO-verificar']
  }
};
const ES = new I18n('es', DICTS);

test('clasificadores de URL: login / pre-home / navigator / home', () => {
  assert.ok(isLoginUrl('http://localhost/login'));
  assert.ok(isPreHomeUrl('http://localhost/pre-home'));
  assert.ok(isNavigatorUrl('http://localhost/navigator/TravelConfirmPage'));
  assert.ok(!isHomeUrl('http://localhost/navigator/TravelConfirmPage'));
  assert.ok(isHomeUrl('http://localhost/navigator/home;FROM_LOGIN=true'));
  assert.ok(!isNavigatorUrl('http://localhost/pre-home'));
});

test('pickLoginSubmit: prefiere el hint de texto; si no, el único primary; con ambigüedad null', () => {
  assert.equal(
    pickLoginSubmit([
      { index: 0, text: 'Recuperar contraseña', primary: false },
      { index: 3, text: 'Entrar', primary: true }
    ]),
    3
  );
  assert.equal(pickLoginSubmit([{ index: 2, text: 'Sign in', primary: true }]), 2);
  assert.equal(
    pickLoginSubmit([
      { index: 0, text: 'A', primary: true },
      { index: 1, text: 'B', primary: true }
    ]),
    null
  );
  assert.equal(pickLoginSubmit([]), null);
});

test('classifyAvailability: exacto por locale; vacío/desconocido = unknown; fr pendiente falla', () => {
  assert.equal(classifyAvailability('No disponible', ES), 'notAvailable');
  assert.equal(classifyAvailability(' disponible ', ES), 'available');
  assert.equal(classifyAvailability('', ES), 'unknown');
  assert.equal(classifyAvailability('Available', ES), 'unknown');
  assert.equal(classifyAvailability('Not Available', new I18n('en', DICTS)), 'notAvailable');
  assert.throws(() => classifyAvailability('x', new I18n('fr', DICTS)), /TODO-verificar/);
});

test('HomeScreen.readAvailability: control visible + estado; ausente = unknown', async () => {
  const visible = fake(() => ({
    present: true,
    visible: true,
    disabled: false,
    label: 'Disponible'
  }));
  const snap = await new HomeScreen(visible.session, ES).readAvailability();
  assert.deepEqual(snap, {
    present: true,
    visible: true,
    disabled: false,
    label: 'Disponible',
    state: 'available'
  });
  const absent = fake(() => ({ present: false, visible: false, disabled: false, label: '' }));
  assert.equal((await new HomeScreen(absent.session, ES).readAvailability()).state, 'unknown');
});

test('HomeScreen.tapAvailability: devuelve lo que informa la página (tocado / nada tocable)', async () => {
  assert.equal(await new HomeScreen(fake(() => true).session, ES).tapAvailability(), true);
  assert.equal(await new HomeScreen(fake(() => false).session, ES).tapAvailability(), false);
});

test('LoginScreen.fillAndSubmit: no envía si no se pudieron llenar los campos y no filtra credenciales al resultado', async () => {
  const noFields = fake(() => ({ emailFilled: true, passwordFilled: false }));
  const r1 = await new LoginScreen(noFields.session).fillAndSubmit('qa@example.com', 'no-real');
  assert.deepEqual(r1, { emailFilled: true, passwordFilled: false, submitted: false });
  assert.equal(noFields.calls.length, 1, 'no busca botón si faltó un campo');

  const ok = fake((_a, n) => {
    if (n === 0) return { emailFilled: true, passwordFilled: true };
    if (n === 1) return [{ index: 4, text: 'Entrar', primary: true }];
    return true;
  });
  const r2 = await new LoginScreen(ok.session).fillAndSubmit('qa@example.com', 'no-real');
  assert.deepEqual(r2, { emailFilled: true, passwordFilled: true, submitted: true });
  assert.ok(!JSON.stringify(r2).includes('no-real'));
});

test('LoginScreen.fillAndSubmit: botón ambiguo = no enviado', async () => {
  const ambiguous = fake((_a, n) => {
    if (n === 0) return { emailFilled: true, passwordFilled: true };
    return [
      { index: 0, text: 'A', primary: true },
      { index: 1, text: 'B', primary: true }
    ];
  });
  const r = await new LoginScreen(ambiguous.session).fillAndSubmit('e', 'p');
  assert.equal(r.submitted, false);
});

test('PreHomeScreen.tapAccept: pasa variantes i18n; con key pendiente cae al primer botón (variantes vacías)', async () => {
  const es = fake(() => true);
  assert.equal(await new PreHomeScreen(es.session, ES).tapAccept(), true);
  assert.deepEqual(es.calls[0]![1], ['Aceptar', 'Tomar viaje']);
  const fr = fake(() => true);
  await new PreHomeScreen(fr.session, new I18n('fr', DICTS)).tapAccept();
  assert.deepEqual(fr.calls[0]![1], []);
});

test('SideMenuScreen: open / logout / confirmación devuelven el booleano de la página', async () => {
  const { session } = fake(() => true);
  const menu = new SideMenuScreen(session);
  assert.equal(await menu.open(), true);
  assert.equal(await menu.isLogoutVisible(), true);
  assert.equal(await menu.tapLogout(), true);
  assert.equal(await menu.confirmLogoutIfAsked(), true);
  const none = new SideMenuScreen(fake(() => false).session);
  assert.equal(await none.tapLogout(), false);
  assert.equal(await none.confirmLogoutIfAsked(), false);
});
