/**
 * DriverSessionPBO — sesión del chofer: login, salida del overlay `/pre-home`, disponibilidad
 * («Disponible» / «No disponible») y logout. Verbos de negocio con resultado tipado; NO tiene locators:
 * compone `screens/driver/{LoginScreen,PreHomeScreen,HomeScreen,SideMenuScreen}`.
 *
 * Quedan en legado (solo lectura de identidad): el pre-flight `assertDriverPreflight`
 * (`driver/DriverTripPreflight`) que verifica app en primer plano, nombre del chofer y que no haya un viaje
 * en curso; el envío del formulario de login ya NO usa su `loginDriver` sino `LoginScreen`.
 * Las credenciales viajan dentro de `DriverPreflightExpectation` o como argumento de `login`; este PBO no
 * lee `process.env` ni las imprime.
 */

import type { I18n } from '../core/I18n.js';
import type { MobileSession } from '../core/MobileSession.js';
import { Waits } from '../core/Waits.js';
import type {
  DriverPreflightExpectation,
  DriverPreflightSnapshot
} from '../data/driverPreflightRules.js';
import { assertDriverPreflight } from './driverPreflight.js';
import {
  HomeScreen,
  type AvailabilitySnapshot,
  type AvailabilityState
} from '../screens/driver/HomeScreen.js';
import { AlertModalScreen, type AlertState } from '../screens/driver/AlertModalScreen.js';
import { LoginScreen } from '../screens/driver/LoginScreen.js';
import { PreHomeScreen } from '../screens/driver/PreHomeScreen.js';
import { SideMenuScreen } from '../screens/driver/SideMenuScreen.js';
import {
  isHomeUrl,
  isLoginUrl,
  isNavigatorUrl,
  isPreHomeUrl,
  webUrl
} from '../screens/driver/driverWeb.js';

export type DriverIdentity = {
  driverDisplayName: string;
  appPackage: string;
  online: boolean;
};

export type DriverCredentials = { email: string; password: string };

/** Resultado de `login`: nunca incluye credenciales. */
export type LoginOutcome = {
  /** Se vio el overlay `/pre-home` entre el submit y el home. */
  sawPreHome: boolean;
  /** URL del home al terminar. */
  homeUrl: string;
};

/** Resultado de un cambio de disponibilidad. */
export type ToggleOutcome = {
  before: AvailabilityState;
  after: AvailabilityState;
  /** El estado cambió (y el control quedó habilitado) dentro del plazo. */
  changed: boolean;
  /** El control volvió a estar habilitado (no quedó bloqueado). */
  released: boolean;
  labelBefore: string;
  labelAfter: string;
};

export type PreHomeStep = 'home' | 'login' | 'pre-home' | 'other';

/** Dónde está la sesión: formulario, overlay, home, o dentro de un viaje/otra pantalla de /navigator. */
export type SessionKind = 'login' | 'pre-home' | 'home' | 'trip-or-other' | 'unknown';
export type SessionState = { kind: SessionKind; url: string };

export class SessionBusyError extends Error {
  constructor(url: string) {
    super(
      `[DriverSessionPBO] la app está en una pantalla de viaje/otra (${url}); no se cierra sesión con un viaje en curso.`
    );
    this.name = 'SessionBusyError';
  }
}

export class DriverNotOnlineError extends Error {
  constructor() {
    super('[DriverSessionPBO] El chofer no quedó «Disponible» tras ensureOnline().');
    this.name = 'DriverNotOnlineError';
  }
}

export class LoginNotShownError extends Error {
  constructor() {
    super(
      '[DriverSessionPBO] login: el formulario de login no está visible (¿la app ya tiene sesión?).'
    );
    this.name = 'LoginNotShownError';
  }
}

export class LoginSubmitError extends Error {
  constructor(flags: { emailFilled: boolean; passwordFilled: boolean; submitted: boolean }) {
    super(
      `[DriverSessionPBO] login: no se pudo enviar el formulario (email=${flags.emailFilled} password=${flags.passwordFilled} submitted=${flags.submitted}).`
    );
    this.name = 'LoginSubmitError';
  }
}

export class AvailabilityControlError extends Error {
  constructor(reason: string) {
    super(`[DriverSessionPBO] disponibilidad: ${reason}.`);
    this.name = 'AvailabilityControlError';
  }
}

export class LogoutError extends Error {
  constructor(reason: string) {
    super(`[DriverSessionPBO] logout: ${reason}.`);
    this.name = 'LogoutError';
  }
}

export type DriverSessionPboDeps = {
  /** Login condicional + verificación de identidad (legado). `login`/`afterLogin` los inyecta el PBO. */
  preflight: (
    expected: DriverPreflightExpectation,
    options: {
      afterLogin: () => Promise<unknown>;
      login: (email: string, password: string) => Promise<boolean>;
    }
  ) => Promise<DriverPreflightSnapshot>;
  login: Pick<LoginScreen, 'isShown' | 'fillAndSubmit'>;
  preHome: Pick<PreHomeScreen, 'tapAccept'>;
  home: Pick<HomeScreen, 'readAvailability' | 'tapAvailability'>;
  alert: Pick<AlertModalScreen, 'read' | 'tapClose'>;
  menu: Pick<SideMenuScreen, 'open' | 'isLogoutVisible' | 'tapLogout' | 'confirmLogoutIfAsked'>;
  /** URL actual del WebView. */
  url: () => Promise<string>;
};

export type DriverSessionPboRuntime = {
  log: (message: string) => void;
  /** Pausa entre intentos de las esperas (default 500 ms). */
  pollIntervalMs: number;
};

export class DriverSessionPBO {
  private readonly log: (message: string) => void;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: DriverSessionPboDeps,
    log: (message: string) => void = (m) => console.info(m),
    options: Partial<Pick<DriverSessionPboRuntime, 'pollIntervalMs'>> = {}
  ) {
    this.log = log;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(
    session: MobileSession,
    i18n: I18n,
    log?: (message: string) => void
  ): DriverSessionPBO {
    const login = new LoginScreen(session);
    return new DriverSessionPBO(
      {
        preflight: (expected, options) => assertDriverPreflight(session.driver, expected, options),
        login,
        preHome: new PreHomeScreen(session, i18n),
        home: new HomeScreen(session, i18n),
        alert: new AlertModalScreen(session),
        menu: new SideMenuScreen(session),
        url: () => webUrl(session)
      },
      log
    );
  }

  private wait(label: string, timeout: number) {
    return { label, timeout, interval: this.pollIntervalMs };
  }

  // ---------------------------------------------------------------- sesión

  /** Un paso del overlay: si está en `/pre-home` toca «Aceptar». Devuelve dónde quedó la app. */
  async stepPreHome(): Promise<PreHomeStep> {
    const url = await this.deps.url();
    if (isLoginUrl(url)) return 'login';
    if (isNavigatorUrl(url)) return 'home';
    if (isPreHomeUrl(url)) {
      await this.deps.preHome.tapAccept();
      return 'pre-home';
    }
    return 'other';
  }

  /**
   * Sale de `/pre-home` hacia `/navigator/*` (idempotente: si ya está en home retorna). Lanza si vence el
   * plazo o si una sesión vencida rebota a `/login`. Devuelve si pasó por el overlay.
   */
  async dismissPreHome(timeoutMs = 40_000): Promise<{ sawPreHome: boolean }> {
    let sawPreHome = false;
    let bouncedToLogin = false;
    await Waits.until(
      async () => {
        const step = await this.stepPreHome();
        if (step === 'pre-home') sawPreHome = true;
        if (step === 'login') bouncedToLogin = true;
        return step === 'home' || step === 'login';
      },
      this.wait('salir de /pre-home hacia /navigator/*', timeoutMs)
    );
    if (bouncedToLogin) {
      throw new LogoutError(
        'el overlay /pre-home rebotó a /login (sesión vencida); hay que volver a iniciar sesión'
      );
    }
    return { sawPreHome };
  }

  /** Dónde está la sesión ahora (solo lectura). */
  async sessionState(): Promise<SessionState> {
    const url = await this.deps.url();
    if (!url) return { kind: 'unknown', url };
    if (isLoginUrl(url)) return { kind: 'login', url };
    if (isPreHomeUrl(url)) return { kind: 'pre-home', url };
    if (isHomeUrl(url)) return { kind: 'home', url };
    if (isNavigatorUrl(url)) return { kind: 'trip-or-other', url };
    return { kind: (await this.deps.login.isShown()) ? 'login' : 'unknown', url };
  }

  /**
   * Deja la app en `/login`. Si ya está ahí no hace nada; desde pre-home/home cierra sesión; con un viaje en
   * curso (otra ruta de /navigator) lanza `SessionBusyError` sin tocar nada. Devuelve si hizo logout.
   */
  async ensureLoggedOut(): Promise<{ loggedOutNow: boolean }> {
    let state = await this.sessionState();
    if (state.kind === 'pre-home') {
      // Con sesión válida pasa a home; con sesión vencida rebota a /login (y ya no hay nada que cerrar).
      await this.dismissPreHome().catch(() => undefined);
      state = await this.sessionState();
    }
    if (state.kind === 'login') return { loggedOutNow: false };
    if (state.kind === 'trip-or-other') throw new SessionBusyError(state.url);
    if (state.kind !== 'home')
      throw new LogoutError(`estado de sesión no reconocido (${state.kind}: ${state.url})`);
    await this.logout();
    return { loggedOutNow: true };
  }

  /**
   * Deja la app en el home con el control de disponibilidad listo, desde cualquier punto de arranque (también
   * tras relanzar la app): espera una pantalla reconocible, cruza `/pre-home`, inicia sesión si hace falta
   * (verificando identidad y que no haya viaje en curso) y espera el control habilitado.
   */
  async reachHome(
    expected: DriverPreflightExpectation,
    options: { timeoutMs?: number } = {}
  ): Promise<AvailabilitySnapshot> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    await this.waitForStableSessionState(timeoutMs);
    if ((await this.sessionState()).kind === 'pre-home') await this.dismissPreHome(timeoutMs);
    await this.ensureLoggedIn(expected);
    await this.dismissPreHome(timeoutMs);
    return this.waitUntilAvailabilityIdle(timeoutMs);
  }

  /**
   * Espera una pantalla reconocible que se mantenga igual en `stableReads` lecturas seguidas. Tras relanzar la app,
   * el WebView muestra un instante `/login` mientras restaura la sesión y después pasa a `/pre-home` o al home;
   * actuar sobre esa primera lectura intentaba un login sobre un formulario que desaparecía (medido 24/11/2026).
   */
  async waitForStableSessionState(
    timeoutMs = 60_000,
    stableReads = 4,
    intervalMs = this.pollIntervalMs
  ): Promise<SessionState> {
    let last: SessionState['kind'] | null = null;
    let streak = 0;
    let current: SessionState | null = null;
    await Waits.until(
      async () => {
        current = await this.sessionState();
        streak = current.kind !== 'unknown' && current.kind === last ? streak + 1 : 1;
        last = current.kind;
        return current.kind !== 'unknown' && streak >= stableReads;
      },
      {
        ...this.wait('app con WebView y una pantalla reconocible y estable', timeoutMs),
        interval: intervalMs
      }
    );
    return current!;
  }

  /** Aviso/modal bloqueante visible (solo lectura). */
  readAlert(): Promise<AlertState> {
    return this.deps.alert.read();
  }

  /** Cierra el aviso visible. Devuelve si había algo que cerrar. */
  acknowledgeAlert(): Promise<boolean> {
    return this.deps.alert.tapClose();
  }

  /** Asegura sesión iniciada con la identidad esperada (login solo si hace falta). */
  async ensureLoggedIn(expected: DriverPreflightExpectation): Promise<DriverIdentity> {
    await this.deps.preflight(expected, {
      afterLogin: () => this.stepPreHome(),
      login: async (email, password) =>
        (await this.deps.login.fillAndSubmit(email, password)).submitted
    });
    this.log(`[DriverSessionPBO] Sesión verificada para «${expected.driverDisplayName}».`);
    return {
      driverDisplayName: expected.driverDisplayName,
      appPackage: expected.appPackage,
      online: false
    };
  }

  /**
   * Login explícito desde el formulario `/login`: envía credenciales, espera salir de `/login`, atraviesa
   * `/pre-home` y confirma que quedó en `/navigator/*`. Lanza si el formulario no está o no se pudo enviar.
   */
  async login(
    credentials: DriverCredentials,
    options: { timeoutMs?: number } = {}
  ): Promise<LoginOutcome> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!(await this.deps.login.isShown())) throw new LoginNotShownError();
    const result = await this.deps.login.fillAndSubmit(credentials.email, credentials.password);
    if (!result.submitted) throw new LoginSubmitError(result);
    await Waits.until(
      async () => !isLoginUrl(await this.deps.url()),
      this.wait('salir de /login tras el submit', timeoutMs)
    );
    const { sawPreHome } = await this.dismissPreHome(timeoutMs);
    const homeUrl = await this.deps.url();
    this.log(`[DriverSessionPBO] Login completado (pre-home=${sawPreHome}).`);
    return { sawPreHome, homeUrl };
  }

  /** «Cerrar sesión» desde el menú lateral y espera `/login`. El chofer queda OFFLINE por la app. */
  async logout(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!(await this.deps.menu.open())) throw new LogoutError('no se pudo abrir el menú lateral');
    // Tras relanzar la app (forceAppLaunch) el primer `ion-menu.open()` puede llegar antes de que Ionic tenga el
    // menú listo y no abrir nada (medido 24/11/2026, build 2.6.18): se reintenta la apertura mientras se espera.
    await Waits.until(
      async () => {
        if (await this.deps.menu.isLogoutVisible()) return true;
        await this.deps.menu.open();
        return false;
      },
      this.wait('«Cerrar sesión» visible en el menú', 20_000)
    );
    if (!(await this.deps.menu.tapLogout()))
      throw new LogoutError('«Cerrar sesión» no estaba visible');
    // El build puede pedir confirmación; si la pide se acepta, si no se sigue.
    await Waits.tryUntil(
      async () => {
        if (isLoginUrl(await this.deps.url())) return 'login';
        return (await this.deps.menu.confirmLogoutIfAsked()) ? 'confirmed' : false;
      },
      this.wait('confirmación opcional de logout', 5_000)
    );
    await Waits.until(
      async () => isLoginUrl(await this.deps.url()),
      this.wait('llegar a /login tras cerrar sesión', timeoutMs)
    );
    this.log('[DriverSessionPBO] Sesión cerrada (URL /login).');
  }

  // ---------------------------------------------------------------- disponibilidad

  /** Lee el control de disponibilidad (no toca nada). */
  readAvailability(): Promise<AvailabilitySnapshot> {
    return this.deps.home.readAvailability();
  }

  /** Espera a que el control exista, sea visible y esté habilitado (no en cambio de estado). */
  async waitUntilAvailabilityIdle(timeoutMs = 30_000): Promise<AvailabilitySnapshot> {
    return Waits.until(
      async () => {
        const s = await this.deps.home.readAvailability();
        return s.visible && !s.disabled ? s : false;
      },
      this.wait('control de disponibilidad habilitado', timeoutMs)
    );
  }

  /** Un toque crudo sobre `#availability`. Lanza si no hay nada tocable. No espera resultado. */
  async tapAvailability(): Promise<void> {
    if (!(await this.deps.home.tapAvailability())) {
      throw new AvailabilityControlError(
        'el control no está visible o está deshabilitado; no se tocó'
      );
    }
  }

  /**
   * Alterna la disponibilidad y espera el nuevo estado. `changed=false` + `released=true` = el cambio fue
   * rechazado/ignorado y el control se liberó; `released=false` = el control quedó bloqueado.
   */
  async toggleAvailability(options: { timeoutMs?: number } = {}): Promise<ToggleOutcome> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const before = await this.deps.home.readAvailability();
    if (!before.visible)
      throw new AvailabilityControlError(
        'no hay control #availability visible (¿fuera de /navigator/home?)'
      );
    if (before.state === 'unknown') {
      throw new AvailabilityControlError(
        `etiqueta «${before.label}» no reconocida (ni «Disponible» ni «No disponible» del locale)`
      );
    }
    await this.tapAvailability();
    const changed = await Waits.tryUntil(
      async () => {
        const s = await this.deps.home.readAvailability();
        return s.visible && !s.disabled && s.state !== 'unknown' && s.state !== before.state
          ? s
          : false;
      },
      this.wait(`cambio de estado desde ${before.state}`, timeoutMs)
    );
    if (changed) {
      return {
        before: before.state,
        after: changed.state,
        changed: true,
        released: true,
        labelBefore: before.label,
        labelAfter: changed.label
      };
    }
    const last = await this.deps.home.readAvailability();
    return {
      before: before.state,
      after: last.state,
      changed: false,
      released: last.visible && !last.disabled,
      labelBefore: before.label,
      labelAfter: last.label
    };
  }

  /** Lleva la disponibilidad a `target`; `null` si ya estaba. Lanza si el cambio no se logra. */
  async setAvailability(
    target: 'available' | 'notAvailable',
    options: { timeoutMs?: number } = {}
  ): Promise<ToggleOutcome | null> {
    const current = await this.deps.home.readAvailability();
    if (current.state === target) return null;
    const outcome = await this.toggleAvailability(options);
    if (outcome.after !== target) {
      throw new AvailabilityControlError(
        `no se alcanzó «${target}» (quedó «${outcome.after}», liberado=${outcome.released})`
      );
    }
    return outcome;
  }

  /** Cierra el overlay pre-home y deja al chofer «Disponible». Lanza si no queda online. */
  async ensureOnline(options: { timeoutMs?: number } = {}): Promise<boolean> {
    await this.dismissPreHome();
    await this.waitUntilAvailabilityIdle();
    await this.setAvailability('available', options).catch(() => undefined);
    if ((await this.deps.home.readAvailability()).state !== 'available')
      throw new DriverNotOnlineError();
    return true;
  }

  /** Login (si hace falta) + online; devuelve la identidad con `online: true`. */
  async startSession(expected: DriverPreflightExpectation): Promise<DriverIdentity> {
    const identity = await this.ensureLoggedIn(expected);
    const online = await this.ensureOnline();
    return { ...identity, online };
  }
}
