// Unit de PassengerSessionPBO con deps fake (sin Appium).
// Run: npx tsx --test tests/mobile/appium/pbo/PassengerSessionPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HomeMode } from '../screens/passenger/HomeModeScreen.js';
import {
  PassengerLoginNotShownError,
  PassengerLoginRejectedError,
  PassengerLoginSubmitError,
  PassengerLogoutError,
  PassengerSessionBusyError,
  PassengerSessionPBO,
  isTripInProgressDialog,
  type PassengerSessionPboDeps
} from './PassengerSessionPBO.js';

type World = {
  url: string;
  /** Urls sucesivas; si hay, cada lectura consume una (la última se repite). */
  urls?: string[];
  /** Con urls: repetir en ciclo en vez de fijar la última. */
  cycle?: boolean;
  fill: { emailFilled: boolean; passwordFilled: boolean; submitted: boolean };
  /** Tras el submit: a dónde navega ('' = se queda). */
  navigateTo: string;
  modal: { shown: boolean; text: string };
  /** El submit muestra el modal. */
  submitShowsModal: boolean;
  mode: HomeMode;
  /** Cantidad de `open()` ignorados antes de que el menú abra de verdad. */
  menuIgnoredOpens: number;
  /** Tocar «Salir»: 'login' navega a /login; 'busy' muestra el aviso de viaje en curso. */
  logoutResult: 'login' | 'busy';
};

const HOME = 'https://localhost/navigator/HomePage';
const LOGIN = 'https://localhost/login';

function build(over: Partial<World> = {}) {
  const w: World = {
    url: LOGIN,
    fill: { emailFilled: true, passwordFilled: true, submitted: true },
    navigateTo: '',
    modal: { shown: false, text: '' },
    submitShowsModal: false,
    mode: 'personal',
    menuIgnoredOpens: 0,
    logoutResult: 'login',
    ...over
  };
  const calls: string[] = [];
  let menuOpen = false;
  let opens = 0;
  let urlReads = 0;
  const deps: PassengerSessionPboDeps = {
    login: {
      isShown: async () => /\/login/.test(w.url),
      fillAndSubmit: async () => {
        calls.push('submit');
        if (w.fill.submitted) {
          if (w.navigateTo) w.url = w.navigateTo;
          if (w.submitShowsModal) {
            w.modal = { shown: true, text: 'Usuario o Contraseña Inválidos, verifica tus datos.' };
          }
        }
        return w.fill;
      },
      readErrorModal: async () => w.modal,
      waitForErrorModal: async () => w.modal,
      closeErrorModal: async () => {
        calls.push('close');
        w.modal = { shown: false, text: '' };
        return true;
      },
      waitForErrorModalClosed: async () => undefined
    },
    home: { readMode: async () => w.mode },
    menu: {
      open: async () => {
        calls.push('menu-open');
        if (opens++ >= w.menuIgnoredOpens) menuOpen = true;
        return true;
      },
      isLogoutVisible: async () => menuOpen,
      tapLogout: async () => {
        calls.push('logout');
        if (w.logoutResult === 'login') w.url = LOGIN;
        else
          w.modal = {
            shown: true,
            text: 'No es posible cerrar sesión mientras el viaje está en curso.'
          };
        return true;
      },
      close: async () => {
        calls.push('menu-close');
        menuOpen = false;
        return true;
      }
    },
    url: async () =>
      w.urls
        ? w.urls[w.cycle ? urlReads++ % w.urls.length : Math.min(urlReads++, w.urls.length - 1)]!
        : w.url
  };
  return { pbo: new PassengerSessionPBO(deps, () => undefined, { pollIntervalMs: 1 }), w, calls };
}

test('sessionState: login | home | other | unknown por URL', async () => {
  assert.equal((await build({ url: LOGIN }).pbo.sessionState()).kind, 'login');
  assert.equal((await build({ url: `${HOME};x=1` }).pbo.sessionState()).kind, 'home');
  assert.equal(
    (await build({ url: 'https://localhost/navigator/Other' }).pbo.sessionState()).kind,
    'other'
  );
  assert.equal((await build({ url: '' }).pbo.sessionState()).kind, 'unknown');
  assert.equal(
    (await build({ url: `${HOME}?invalid_token=true` }).pbo.sessionState()).kind,
    'login'
  );
});

test('loginOrFail: envía, sale de /login y devuelve home + modo', async () => {
  const { pbo, calls } = build({ navigateTo: HOME, mode: 'company' });
  const out = await pbo.loginOrFail({ email: 'a', password: 'b' }, { timeoutMs: 2_000 });
  assert.equal(out.homeUrl, HOME);
  assert.equal(out.mode, 'company');
  assert.deepEqual(calls, ['submit']);
});

test('loginOrFail: sin formulario lanza PassengerLoginNotShownError', async () => {
  const { pbo } = build({ url: HOME });
  await assert.rejects(pbo.loginOrFail({ email: 'a', password: 'b' }), PassengerLoginNotShownError);
});

test('loginOrFail: submit fallido lanza PassengerLoginSubmitError', async () => {
  const { pbo } = build({ fill: { emailFilled: true, passwordFilled: true, submitted: false } });
  await assert.rejects(pbo.loginOrFail({ email: 'a', password: 'b' }), PassengerLoginSubmitError);
});

test('loginOrFail: credenciales rechazadas lanza PassengerLoginRejectedError (sin credenciales en el mensaje)', async () => {
  const { pbo } = build({ submitShowsModal: true });
  await assert.rejects(
    pbo.loginOrFail({ email: 'secreto@x.test', password: 'clave-secreta' }, { timeoutMs: 2_000 }),
    (e: unknown) =>
      e instanceof PassengerLoginRejectedError &&
      !e.message.includes('secreto@x.test') &&
      !e.message.includes('clave-secreta')
  );
});

test('loginOrFail: vence el plazo si nunca llega al home', async () => {
  const { pbo } = build();
  await assert.rejects(
    pbo.loginOrFail({ email: 'a', password: 'b' }, { timeoutMs: 40 }),
    /home PAX/
  );
});

test('attemptInvalidLogin: devuelve el texto del aviso, cierra el modal y sigue en /login', async () => {
  const { pbo, calls } = build({ submitShowsModal: true });
  const out = await pbo.attemptInvalidLogin('x@example.test', 'nope');
  assert.match(out.modalText, /Inválidos/);
  assert.equal(out.stayedOnLogin, true);
  assert.deepEqual(calls, ['submit', 'close']);
});

test('attemptInvalidLogin: si la app navega fuera de /login, stayedOnLogin=false', async () => {
  const { pbo } = build({ submitShowsModal: true, navigateTo: HOME });
  assert.equal((await pbo.attemptInvalidLogin('x', 'y')).stayedOnLogin, false);
});

test('ensureLoggedOut: en /login no hace nada (no abre el menú)', async () => {
  const { pbo, calls } = build({ url: LOGIN });
  assert.deepEqual(await pbo.ensureLoggedOut(), { loggedOutNow: false });
  assert.deepEqual(calls, []);
});

test('ensureLoggedOut: desde el home abre el menú, toca «Salir» y llega a /login', async () => {
  const { pbo, calls, w } = build({ url: HOME });
  assert.deepEqual(await pbo.ensureLoggedOut(), { loggedOutNow: true });
  assert.deepEqual(calls, ['menu-open', 'logout']);
  assert.equal(w.url, LOGIN);
});

test('ensureLoggedOut: reintenta abrir el menú si el primer open() se ignora', async () => {
  const { pbo, calls } = build({ url: HOME, menuIgnoredOpens: 2 });
  assert.deepEqual(await pbo.ensureLoggedOut(), { loggedOutNow: true });
  assert.equal(calls.filter((c) => c === 'menu-open').length, 3);
  assert.equal(calls.at(-1), 'logout');
});

test('ensureLoggedOut: con viaje en curso cierra el aviso y lanza PassengerSessionBusyError', async () => {
  const { pbo, calls, w } = build({ url: HOME, logoutResult: 'busy' });
  await assert.rejects(pbo.ensureLoggedOut(), PassengerSessionBusyError);
  assert.ok(calls.includes('close'), 'cerró el aviso');
  assert.equal(calls.at(-1), 'menu-close');
  assert.equal(w.modal.shown, false);
  assert.notEqual(w.url, LOGIN);
});

test('ensureLoggedOut: estado no reconocido lanza PassengerLogoutError', async () => {
  await assert.rejects(
    build({ url: 'https://localhost/navigator/Other' }).pbo.ensureLoggedOut(),
    PassengerLogoutError
  );
});

test('isTripInProgressDialog: reconoce el aviso es/en y descarta otros textos', () => {
  assert.equal(
    isTripInProgressDialog('No es posible cerrar sesión mientras el viaje está en curso.'),
    true
  );
  assert.equal(isTripInProgressDialog('You can’t sign out while the trip is in progress.'), true);
  assert.equal(isTripInProgressDialog('Usuario o Contraseña Inválidos'), false);
});

test('waitForStableSessionState: ignora el /login transitorio y exige N lecturas iguales', async () => {
  const { pbo } = build({ urls: ['', LOGIN, HOME, HOME, HOME, HOME, HOME] });
  const s = await pbo.waitForStableSessionState(2_000, 4, 1);
  assert.equal(s.kind, 'home');
});

test('waitForStableSessionState: vence si nunca es estable', async () => {
  const { pbo } = build({ urls: [LOGIN, HOME], cycle: true });
  await assert.rejects(pbo.waitForStableSessionState(60, 4, 1), /estable/);
});
