// Unit de DriverSessionPBO con deps fake (sin Appium). Run: npx tsx --test tests/mobile/appium/pbo/DriverSessionPBO.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DriverPreflightExpectation,
  DriverPreflightSnapshot
} from '../data/driverPreflightRules.js';
import type { AvailabilitySnapshot, AvailabilityState } from '../screens/driver/HomeScreen.js';
import {
  AvailabilityControlError,
  DriverNotOnlineError,
  DriverSessionPBO,
  LoginNotShownError,
  LoginSubmitError,
  LogoutError,
  SessionBusyError
} from './DriverSessionPBO.js';

const EXPECTED: DriverPreflightExpectation = {
  appPackage: 'com.test.driver',
  driverDisplayName: 'Chofer QA'
};
const SNAP: DriverPreflightSnapshot = {
  foregroundPackage: 'com.test.driver',
  webUrl: '',
  headerTexts: [],
  loggedOut: false
};

type World = {
  url: string;
  /** Estado de la etiqueta; el tap lo cambia salvo `tapChanges=false`. */
  state: AvailabilityState;
  disabled: boolean;
  visible: boolean;
  tapChanges: boolean;
  tapWorks: boolean;
  /** Tras el tap el control queda bloqueado. */
  tapBlocks: boolean;
  preflightFails: boolean;
  loginShown: boolean;
  submitted: boolean;
  logoutNeedsConfirm: boolean;
  alertText: string | null;
};

const LABELS: Record<AvailabilityState, string> = {
  available: 'Disponible',
  notAvailable: 'No disponible',
  unknown: '???'
};

function build(over: Partial<World> = {}) {
  const w: World = {
    url: 'http://localhost/navigator/home;FROM_LOGIN=true',
    state: 'notAvailable',
    disabled: false,
    visible: true,
    tapChanges: true,
    tapWorks: true,
    tapBlocks: false,
    preflightFails: false,
    loginShown: true,
    submitted: true,
    logoutNeedsConfirm: false,
    alertText: null,
    ...over
  };
  const calls: string[] = [];
  const snapshot = (): AvailabilitySnapshot => ({
    present: w.visible,
    visible: w.visible,
    disabled: w.disabled,
    label: LABELS[w.state],
    state: w.state
  });
  const pbo = new DriverSessionPBO(
    {
      preflight: async (_e, o) => {
        calls.push('preflight');
        if (w.preflightFails) throw new Error('Pre-flight abortado');
        await o.afterLogin();
        return SNAP;
      },
      login: {
        isShown: async () => w.loginShown,
        fillAndSubmit: async () => {
          calls.push('submit');
          if (w.submitted) w.url = 'http://localhost/pre-home';
          return { emailFilled: true, passwordFilled: true, submitted: w.submitted };
        }
      },
      preHome: {
        tapAccept: async () => {
          calls.push('accept');
          w.url = 'http://localhost/navigator/home;FROM_LOGIN=true';
          return true;
        }
      },
      home: {
        readAvailability: async () => snapshot(),
        tapAvailability: async () => {
          calls.push('tap');
          if (!w.tapWorks) return false;
          if (w.tapChanges) w.state = w.state === 'available' ? 'notAvailable' : 'available';
          if (w.tapBlocks) w.disabled = true;
          return true;
        }
      },
      alert: {
        read: async () => ({ shown: w.alertText !== null, text: w.alertText ?? '' }),
        tapClose: async () => {
          const had = w.alertText !== null;
          w.alertText = null;
          return had;
        }
      },
      menu: {
        open: async () => (calls.push('menu.open'), true),
        isLogoutVisible: async () => true,
        tapLogout: async () => {
          calls.push('logout');
          if (!w.logoutNeedsConfirm) w.url = 'http://localhost/login';
          return true;
        },
        confirmLogoutIfAsked: async () => {
          if (!w.logoutNeedsConfirm) return false;
          calls.push('logout.confirm');
          w.url = 'http://localhost/login';
          return true;
        }
      },
      url: async () => w.url
    },
    () => undefined,
    { pollIntervalMs: 5 }
  );
  return { pbo, calls, w };
}

test('startSession: login -> overlay -> online y devuelve identidad online', async () => {
  const { pbo, calls } = build({ url: 'http://localhost/pre-home' });
  const id = await pbo.startSession(EXPECTED);
  assert.deepEqual(id, {
    driverDisplayName: 'Chofer QA',
    appPackage: 'com.test.driver',
    online: true
  });
  assert.deepEqual(calls.slice(0, 3), ['preflight', 'accept', 'tap']);
});

test('ensureLoggedIn: el afterLogin del preflight avanza el overlay pre-home', async () => {
  const { pbo, calls } = build({ url: 'http://localhost/pre-home' });
  const id = await pbo.ensureLoggedIn(EXPECTED);
  assert.deepEqual(calls, ['preflight', 'accept']);
  assert.equal(id.online, false);
});

test('ensureOnline: lanza DriverNotOnlineError si no queda disponible', async () => {
  const { pbo } = build({ tapChanges: false });
  await assert.rejects(() => pbo.ensureOnline({ timeoutMs: 60 }), DriverNotOnlineError);
});

test('ensureOnline: ya disponible no toca el control', async () => {
  const { pbo, calls } = build({ state: 'available' });
  assert.equal(await pbo.ensureOnline(), true);
  assert.ok(!calls.includes('tap'));
});

test('startSession: error del preflight corta antes de tocar home', async () => {
  const { pbo, calls } = build({ preflightFails: true });
  await assert.rejects(() => pbo.startSession(EXPECTED), /Pre-flight abortado/);
  assert.deepEqual(calls, ['preflight']);
});

test('login: submit -> sale de /login -> pre-home -> home, sin exponer credenciales', async () => {
  const { pbo, calls } = build({ url: 'http://localhost/login' });
  const out = await pbo.login(
    { email: 'qa@example.com', password: 'secreto-no-real' },
    { timeoutMs: 1_000 }
  );
  assert.deepEqual(calls, ['submit', 'accept']);
  assert.equal(out.sawPreHome, true);
  assert.match(out.homeUrl, /\/navigator\/home/);
  assert.ok(!JSON.stringify(out).includes('secreto-no-real'));
});

test('login: sin formulario visible lanza LoginNotShownError y no envía nada', async () => {
  const { pbo, calls } = build({ loginShown: false });
  await assert.rejects(() => pbo.login({ email: 'e', password: 'p' }), LoginNotShownError);
  assert.deepEqual(calls, []);
});

test('login: formulario no enviable lanza LoginSubmitError', async () => {
  const { pbo } = build({ submitted: false });
  await assert.rejects(() => pbo.login({ email: 'e', password: 'p' }), LoginSubmitError);
});

test('dismissPreHome: sesión vencida que rebota a /login falla con LogoutError', async () => {
  const { pbo } = build({ url: 'http://localhost/login' });
  await assert.rejects(() => pbo.dismissPreHome(500), LogoutError);
});

test('toggleAvailability: cambia notAvailable -> available y reporta etiquetas', async () => {
  const { pbo } = build();
  const out = await pbo.toggleAvailability({ timeoutMs: 500 });
  assert.deepEqual(out, {
    before: 'notAvailable',
    after: 'available',
    changed: true,
    released: true,
    labelBefore: 'No disponible',
    labelAfter: 'Disponible'
  });
});

test('toggleAvailability: cambio rechazado (estado igual, control liberado) -> changed=false released=true', async () => {
  const { pbo } = build({ tapChanges: false });
  const out = await pbo.toggleAvailability({ timeoutMs: 60 });
  assert.equal(out.changed, false);
  assert.equal(out.released, true);
  assert.equal(out.after, 'notAvailable');
});

test('toggleAvailability: control que queda bloqueado -> released=false', async () => {
  const { pbo } = build({ tapChanges: false, tapBlocks: true });
  const out = await pbo.toggleAvailability({ timeoutMs: 60 });
  assert.equal(out.changed, false);
  assert.equal(out.released, false);
});

test('toggleAvailability: etiqueta desconocida o control ausente lanza AvailabilityControlError', async () => {
  await assert.rejects(
    () => build({ state: 'unknown' }).pbo.toggleAvailability(),
    AvailabilityControlError
  );
  await assert.rejects(
    () => build({ visible: false }).pbo.toggleAvailability(),
    AvailabilityControlError
  );
});

test('tapAvailability: nada tocable lanza AvailabilityControlError', async () => {
  await assert.rejects(
    () => build({ tapWorks: false }).pbo.tapAvailability(),
    AvailabilityControlError
  );
});

test('setAvailability: idempotente (null si ya estaba) y falla si no alcanza el objetivo', async () => {
  assert.equal(await build({ state: 'available' }).pbo.setAvailability('available'), null);
  const out = await build({ state: 'notAvailable' }).pbo.setAvailability('available');
  assert.equal(out?.after, 'available');
  await assert.rejects(
    () => build({ tapChanges: false }).pbo.setAvailability('available', { timeoutMs: 60 }),
    AvailabilityControlError
  );
});

test('logout: sin confirmación llega a /login; con confirmación la acepta', async () => {
  const plain = build();
  await plain.pbo.logout({ timeoutMs: 500 });
  assert.deepEqual(plain.calls, ['menu.open', 'logout']);
  const confirm = build({ logoutNeedsConfirm: true });
  await confirm.pbo.logout({ timeoutMs: 500 });
  assert.deepEqual(confirm.calls, ['menu.open', 'logout', 'logout.confirm']);
});

test('sessionState: clasifica login / pre-home / home / viaje', async () => {
  assert.equal((await build({ url: 'http://localhost/login' }).pbo.sessionState()).kind, 'login');
  assert.equal(
    (await build({ url: 'http://localhost/pre-home' }).pbo.sessionState()).kind,
    'pre-home'
  );
  assert.equal((await build().pbo.sessionState()).kind, 'home');
  assert.equal(
    (await build({ url: 'http://localhost/navigator/TravelInProgressPage' }).pbo.sessionState())
      .kind,
    'trip-or-other'
  );
  assert.equal((await build({ url: '' }).pbo.sessionState()).kind, 'unknown');
});

test('ensureLoggedOut: en /login no hace nada; en home cierra sesión; en pre-home pasa por home primero', async () => {
  const atLogin = build({ url: 'http://localhost/login' });
  assert.deepEqual(await atLogin.pbo.ensureLoggedOut(), { loggedOutNow: false });
  assert.deepEqual(atLogin.calls, []);
  const atHome = build();
  assert.deepEqual(await atHome.pbo.ensureLoggedOut(), { loggedOutNow: true });
  assert.deepEqual(atHome.calls, ['menu.open', 'logout']);
  const atPreHome = build({ url: 'http://localhost/pre-home' });
  assert.deepEqual(await atPreHome.pbo.ensureLoggedOut(), { loggedOutNow: true });
  assert.deepEqual(atPreHome.calls, ['accept', 'menu.open', 'logout']);
});

test('ensureLoggedOut: con un viaje en curso lanza SessionBusyError y no toca el menú', async () => {
  const { pbo, calls } = build({ url: 'http://localhost/navigator/TravelInProgressPage' });
  await assert.rejects(() => pbo.ensureLoggedOut(), SessionBusyError);
  assert.deepEqual(calls, []);
});

test('readAlert / acknowledgeAlert: lee el aviso y lo cierra', async () => {
  const { pbo } = build({ alertText: 'No se pudo cambiar el estado' });
  assert.deepEqual(await pbo.readAlert(), { shown: true, text: 'No se pudo cambiar el estado' });
  assert.equal(await pbo.acknowledgeAlert(), true);
  assert.deepEqual(await pbo.readAlert(), { shown: false, text: '' });
  assert.equal(await pbo.acknowledgeAlert(), false);
});

test('reachHome: desde pre-home cruza el overlay, verifica sesión y devuelve el control habilitado', async () => {
  const { pbo, calls } = build({ url: 'http://localhost/pre-home' });
  const snap = await pbo.reachHome(EXPECTED, { timeoutMs: 500 });
  assert.deepEqual(calls, ['accept', 'preflight']);
  assert.equal(snap.visible, true);
  assert.equal(snap.disabled, false);
});

test('reachHome: sin pantalla reconocible vence con timeout explícito', async () => {
  const { pbo } = build({ url: '' });
  await assert.rejects(() => pbo.reachHome(EXPECTED, { timeoutMs: 60 }), /pantalla reconocible/);
});

test('waitForStableSessionState: ignora un /login momentáneo y devuelve el home cuando se estabiliza', async () => {
  const { pbo, w: world } = build({ url: 'http://localhost/login' });
  const sequence = [
    'http://localhost/login',
    'http://localhost/pre-home',
    'http://localhost/navigator/home;FROM_LOGIN=true'
  ];
  let reads = 0;
  const original = pbo.sessionState.bind(pbo);
  pbo.sessionState = async () => {
    world.url = sequence[Math.min(reads, sequence.length - 1)]!;
    reads += 1;
    return original();
  };
  const state = await pbo.waitForStableSessionState(2_000, 3, 1);
  assert.equal(state.kind, 'home');
  assert.ok(reads >= 5, 'debe haber leído hasta estabilizarse');
});
