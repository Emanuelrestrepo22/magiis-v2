/**
 * PassengerSessionPBO — sesión del pasajero: estado por URL, login, intento de login inválido y espera de
 * estado estable. Verbos de negocio con resultado tipado; NO tiene locators: compone
 * `screens/passenger/{LoginScreen,HomeModeScreen}`. No lee `process.env` ni imprime credenciales.
 *
 * Logout: relevado del código (develop), validación en vivo pendiente. `ensureLoggedOut` abre el menú lateral,
 * toca «Salir» y espera `/login`; con un viaje en curso la app muestra un aviso y NO cierra sesión: se cierra
 * el aviso y se lanza `PassengerSessionBusyError` (el spec lo convierte en skip con motivo).
 */

import type { MobileSession } from '../core/MobileSession.js';
import { Waits } from '../core/Waits.js';
import { HomeModeScreen, type HomeMode } from '../screens/passenger/HomeModeScreen.js';
import { LoginScreen, normalizeForMatch } from '../screens/passenger/LoginScreen.js';
import { SideMenuScreen } from '../screens/passenger/SideMenuScreen.js';
import { isHomeUrl, isLoginUrl, webUrl } from '../screens/passenger/passengerWeb.js';

export type PassengerCredentials = { email: string; password: string };

export type PassengerSessionKind = 'login' | 'home' | 'other' | 'unknown';
export type PassengerSessionState = { kind: PassengerSessionKind; url: string };

export type PassengerLoginOutcome = { homeUrl: string; mode: HomeMode };
export type InvalidLoginOutcome = { modalText: string; stayedOnLogin: boolean };

/** Aviso `log_out_warning` (es/en) normalizado: «No es posible cerrar sesión mientras el viaje está en curso.» */
const BUSY_DIALOG_PATTERNS = [
  'no es posible cerrar sesion mientras el viaje esta en curso',
  'you can’t sign out while the trip is in progress',
  "you can't sign out while the trip is in progress"
];

/** `true` si el texto del diálogo es el aviso de viaje en curso (es/en, sin acentos ni mayúsculas). */
export function isTripInProgressDialog(text: string): boolean {
  const n = normalizeForMatch(text);
  return BUSY_DIALOG_PATTERNS.some((p) => n.includes(p));
}

export class PassengerSessionBusyError extends Error {
  constructor(dialogText: string) {
    super(
      `[PassengerSessionPBO] logout: la app no permite cerrar sesión con un viaje en curso («${dialogText}»).`
    );
    this.name = 'PassengerSessionBusyError';
  }
}

export class PassengerLogoutError extends Error {
  constructor(reason: string) {
    super(`[PassengerSessionPBO] logout: ${reason}.`);
    this.name = 'PassengerLogoutError';
  }
}

export class PassengerLoginNotShownError extends Error {
  constructor() {
    super('[PassengerSessionPBO] login: el formulario de login no está visible (¿ya hay sesión?).');
    this.name = 'PassengerLoginNotShownError';
  }
}

export class PassengerLoginSubmitError extends Error {
  constructor(flags: { emailFilled: boolean; passwordFilled: boolean; submitted: boolean }) {
    super(
      `[PassengerSessionPBO] login: no se pudo enviar el formulario (email=${flags.emailFilled} password=${flags.passwordFilled} submitted=${flags.submitted}).`
    );
    this.name = 'PassengerLoginSubmitError';
  }
}

export class PassengerLoginRejectedError extends Error {
  constructor(modalText: string) {
    super(`[PassengerSessionPBO] login: la app rechazó las credenciales («${modalText}»).`);
    this.name = 'PassengerLoginRejectedError';
  }
}

export type PassengerSessionPboDeps = {
  login: Pick<
    LoginScreen,
    | 'isShown'
    | 'fillAndSubmit'
    | 'readErrorModal'
    | 'waitForErrorModal'
    | 'closeErrorModal'
    | 'waitForErrorModalClosed'
  >;
  home: Pick<HomeModeScreen, 'readMode'>;
  menu: Pick<SideMenuScreen, 'open' | 'isLogoutVisible' | 'tapLogout' | 'close'>;
  /** URL actual del WebView. */
  url: () => Promise<string>;
};

export class PassengerSessionPBO {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: PassengerSessionPboDeps,
    private readonly log: (message: string) => void = (m) => console.info(m),
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(session: MobileSession, log?: (message: string) => void): PassengerSessionPBO {
    return new PassengerSessionPBO(
      {
        login: new LoginScreen(session),
        home: new HomeModeScreen(session),
        menu: new SideMenuScreen(session),
        url: () => webUrl(session)
      },
      log
    );
  }

  private wait(label: string, timeout: number) {
    return { label, timeout, interval: this.pollIntervalMs };
  }

  /** Dónde está la sesión según la URL del WebView (`unknown` si no se pudo leer). */
  async sessionState(): Promise<PassengerSessionState> {
    const url = await this.deps.url().catch(() => '');
    if (!url) return { kind: 'unknown', url };
    if (isLoginUrl(url)) return { kind: 'login', url };
    if (isHomeUrl(url)) return { kind: 'home', url };
    return { kind: 'other', url };
  }

  /**
   * Espera una pantalla reconocible que se mantenga igual en `stableReads` lecturas seguidas (tras relanzar la
   * app el WebView muestra un instante `/login` mientras restaura la sesión).
   */
  async waitForStableSessionState(
    timeoutMs = 60_000,
    stableReads = 4,
    intervalMs = this.pollIntervalMs
  ): Promise<PassengerSessionState> {
    let last: PassengerSessionKind | null = null;
    let streak = 0;
    let current: PassengerSessionState | null = null;
    await Waits.until(
      async () => {
        current = await this.sessionState();
        streak = current.kind !== 'unknown' && current.kind === last ? streak + 1 : 1;
        last = current.kind;
        return current.kind !== 'unknown' && streak >= stableReads;
      },
      {
        ...this.wait('app con WebView y una pantalla PAX estable', timeoutMs),
        interval: intervalMs
      }
    );
    return current!;
  }

  /** Inicia sesión y espera el home. Lanza si no hay formulario, no se envía, se rechazan las credenciales o vence el plazo. */
  async loginOrFail(
    credentials: PassengerCredentials,
    options: { timeoutMs?: number } = {}
  ): Promise<PassengerLoginOutcome> {
    const timeoutMs = options.timeoutMs ?? 60_000;
    if (!(await this.deps.login.isShown())) throw new PassengerLoginNotShownError();
    const result = await this.deps.login.fillAndSubmit(credentials.email, credentials.password);
    if (!result.emailFilled || !result.passwordFilled || !result.submitted) {
      throw new PassengerLoginSubmitError(result);
    }
    let homeUrl = '';
    let rejectedText: string | null = null;
    await Waits.until(
      async () => {
        const modal = await this.deps.login.readErrorModal();
        if (modal.shown && modal.text) {
          rejectedText = modal.text; // Waits.until traga excepciones del callback: se lanza después
          return true;
        }
        const state = await this.sessionState();
        if (state.kind === 'home') {
          homeUrl = state.url;
          return true;
        }
        return false;
      },
      this.wait('salir de /login y llegar al home PAX', timeoutMs)
    );
    if (rejectedText !== null) throw new PassengerLoginRejectedError(rejectedText);
    const mode = await this.deps.home.readMode();
    this.log(`[PassengerSessionPBO] login OK; home alcanzado (modo: ${mode}).`);
    return { homeUrl, mode };
  }

  /** Envía credenciales (inválidas) y devuelve el aviso mostrado; cierra el modal. No lanza por el rechazo. */
  async attemptInvalidLogin(email: string, password: string): Promise<InvalidLoginOutcome> {
    if (!(await this.deps.login.isShown())) throw new PassengerLoginNotShownError();
    const result = await this.deps.login.fillAndSubmit(email, password);
    if (!result.emailFilled || !result.passwordFilled || !result.submitted) {
      throw new PassengerLoginSubmitError(result);
    }
    const modal = await this.deps.login.waitForErrorModal({ interval: this.pollIntervalMs });
    await this.deps.login.closeErrorModal();
    await this.deps.login.waitForErrorModalClosed({ interval: this.pollIntervalMs });
    const state = await this.sessionState();
    return { modalText: modal.text, stayedOnLogin: state.kind === 'login' };
  }

  /** Marcador de modo del home («Modo Personal» / «Compañía»). */
  readHomeMode(): Promise<HomeMode> {
    return this.deps.home.readMode();
  }

  /**
   * Deja la app en `/login`. En `/login` no hace nada; con sesión abre el menú lateral, toca «Salir» y espera
   * `/login`. Con un viaje en curso la app muestra un aviso y no cierra sesión: se cierra el aviso y se lanza
   * `PassengerSessionBusyError`. Devuelve si hizo logout.
   */
  async ensureLoggedOut(options: { timeoutMs?: number } = {}): Promise<{ loggedOutNow: boolean }> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const state = await this.sessionState();
    if (state.kind === 'login') return { loggedOutNow: false };
    if (state.kind !== 'home') {
      throw new PassengerLogoutError(
        `estado de sesión no reconocido (${state.kind}: ${state.url})`
      );
    }
    if (!(await this.deps.menu.open())) {
      throw new PassengerLogoutError('no se pudo abrir el menú lateral');
    }
    // Tras relanzar la app el primer `ion-menu.open()` puede ignorarse: se reintenta mientras se espera.
    await Waits.until(
      async () => {
        if (await this.deps.menu.isLogoutVisible()) return true;
        await this.deps.menu.open();
        return false;
      },
      this.wait('«Salir» visible en el menú', 20_000)
    );
    if (!(await this.deps.menu.tapLogout())) {
      throw new PassengerLogoutError('«Salir» no estaba visible');
    }
    let busyText: string | null = null;
    await Waits.until(
      async () => {
        if (isLoginUrl(await this.deps.url())) return true;
        const modal = await this.deps.login.readErrorModal();
        if (modal.shown && isTripInProgressDialog(modal.text)) {
          busyText = modal.text; // Waits.until traga excepciones del callback: se lanza después
          return true;
        }
        return false;
      },
      this.wait('llegar a /login o ver el aviso de viaje en curso', timeoutMs)
    );
    if (busyText !== null) {
      await this.deps.login.closeErrorModal();
      await this.deps.login.waitForErrorModalClosed({ interval: this.pollIntervalMs });
      await this.deps.menu.close();
      throw new PassengerSessionBusyError(busyText);
    }
    this.log('[PassengerSessionPBO] Sesión cerrada (URL /login).');
    return { loggedOutNow: true };
  }
}
