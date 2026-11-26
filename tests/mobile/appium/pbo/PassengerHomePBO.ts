/**
 * PassengerHomePBO — home del pasajero: asegurar el modo de perfil (Personal ↔ Compañía). Verbos de negocio con
 * resultado tipado; NO tiene locators: compone `screens/passenger/HomeModeScreen`. No lee `process.env`.
 *
 * Cambiar de modo es local a la app (develop `profileSelected()`, home.page.ts:2197): guarda el perfil actual en
 * el storage del dispositivo y no llama al backend ni muestra diálogo de confirmación. Validación en vivo pendiente.
 */

import type { MobileSession } from '../core/MobileSession.js';
import { Waits } from '../core/Waits.js';
import { HomeModeScreen, type HomeMode } from '../screens/passenger/HomeModeScreen.js';

export type PassengerProfileMode = Exclude<HomeMode, 'none'>;
export type ProfileModeResult = {
  changed: boolean;
  from: PassengerProfileMode;
  to: PassengerProfileMode;
};

export type ProfileModeUnavailableReason = 'toggle-hidden' | 'toggle-disabled';

/** El usuario no puede cambiar de modo: sin interruptor (`personalModeDisabled`) o deshabilitado (sin perfil corporativo). */
export class ProfileModeUnavailableError extends Error {
  constructor(
    readonly reason: ProfileModeUnavailableReason,
    readonly wanted: PassengerProfileMode
  ) {
    super(
      `[PassengerHomePBO] no se puede pasar a modo ${wanted}: ${
        reason === 'toggle-hidden'
          ? 'el interruptor de modo no se muestra (personalModeDisabled)'
          : 'el interruptor está deshabilitado (el usuario no tiene perfil corporativo)'
      }.`
    );
    this.name = 'ProfileModeUnavailableError';
  }
}

export class ProfileModeSwitchError extends Error {
  constructor(detail: string) {
    super(`[PassengerHomePBO] ${detail}.`);
    this.name = 'ProfileModeSwitchError';
  }
}

export type PassengerHomePboDeps = {
  home: Pick<HomeModeScreen, 'readMode' | 'isToggleVisible' | 'isToggleDisabled' | 'tapToggle'>;
};

export class PassengerHomePBO {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: PassengerHomePboDeps,
    private readonly log: (message: string) => void = (m) => console.info(m),
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(session: MobileSession, log?: (message: string) => void): PassengerHomePBO {
    return new PassengerHomePBO({ home: new HomeModeScreen(session) }, log);
  }

  /** Modo visible hoy (`none` si la etiqueta aún no renderiza). */
  readMode(): Promise<HomeMode> {
    return this.deps.home.readMode();
  }

  /**
   * Deja el home en `mode`. Sondea la etiqueta antes de decidir (puede renderizar tarde y quedar `none`): si ya
   * está en el modo pedido no toca nada. Si no, exige interruptor visible y habilitado
   * (`ProfileModeUnavailableError`), lo toca y espera la etiqueta nueva (si no cambia, `ProfileModeSwitchError`).
   */
  async ensureProfileMode(
    mode: PassengerProfileMode,
    options: { timeoutMs?: number } = {}
  ): Promise<ProfileModeResult> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    let current = 'none' as HomeMode;
    await Waits.tryUntil(
      async () => {
        current = await this.deps.home.readMode();
        return current !== 'none';
      },
      {
        label: 'etiqueta de modo del home',
        timeout: Math.min(timeoutMs, 6_000),
        interval: this.pollIntervalMs
      }
    );
    if (current === mode) return { changed: false, from: mode, to: mode };

    if (!(await this.deps.home.isToggleVisible())) {
      throw new ProfileModeUnavailableError('toggle-hidden', mode);
    }
    if (current === 'none') {
      throw new ProfileModeSwitchError('no se pudo leer el modo actual del home');
    }
    if (await this.deps.home.isToggleDisabled()) {
      throw new ProfileModeUnavailableError('toggle-disabled', mode);
    }
    if (!(await this.deps.home.tapToggle())) {
      throw new ProfileModeSwitchError(`interruptor de modo no encontrado al pasar a ${mode}`);
    }
    try {
      await Waits.until(async () => (await this.deps.home.readMode()) === mode, {
        label: `etiqueta de modo «${mode}» tras tocar el interruptor`,
        timeout: timeoutMs,
        interval: this.pollIntervalMs
      });
    } catch {
      throw new ProfileModeSwitchError(`la etiqueta no cambió a ${mode} tras tocar el interruptor`);
    }
    this.log(`[PassengerHomePBO] modo ${current} -> ${mode}.`);
    return { changed: true, from: current, to: mode };
  }
}
