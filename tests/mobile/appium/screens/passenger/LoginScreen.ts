/**
 * LoginScreen (POM) — formulario de login de la app Pasajero (`/login`, Ionic) y su modal de error.
 * Solo locators + acciones atómicas + estado observable. Sin aserciones de negocio ni navegación.
 * Selectores relevados EN VIVO el 24/11/2026 (app `com.magiis.app.test.passenger` 2.5.21).
 * Las credenciales entran como argumentos de `fillAndSubmit` y NUNCA se loguean ni se devuelven.
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { Waits, type UntilOptions } from '../../core/Waits.js';
import { isLoginUrl, webDriver, webUrl } from './passengerWeb.js';

export const PASSENGER_LOGIN_LOCATORS = {
  emailInput: defineLocator({
    id: 'passenger.login.emailInput',
    web: ['ion-input[formcontrolname="username"] input', 'input[type="email"]']
  }),
  passwordInput: defineLocator({
    id: 'passenger.login.passwordInput',
    web: ['ion-input[formcontrolname="password"] input', 'input[type="password"]']
  }),
  submitButton: defineLocator({ id: 'passenger.login.submitButton', web: 'button.btn-login' }),
  errorModal: defineLocator({
    id: 'passenger.login.errorModal',
    web: ['ion-modal.confirm-modal-simple', 'ion-modal']
  }),
  errorModalText: defineLocator({
    id: 'passenger.login.errorModalText',
    web: ['app-confirm-modal span.subtitle', 'ion-modal span.subtitle']
  }),
  errorModalClose: defineLocator({
    id: 'passenger.login.errorModalClose',
    web: ['app-confirm-modal button.btn.primary', 'ion-modal button.btn.primary']
  })
} as const satisfies Record<string, Locator>;

export type PassengerLoginSubmitResult = {
  emailFilled: boolean;
  passwordFilled: boolean;
  submitted: boolean;
};

export type ErrorModalState = { shown: boolean; text: string };

/** Pura: minúsculas, sin acentos, espacios colapsados (para comparar textos de la app sin depender del formato). */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export class LoginScreen {
  constructor(private readonly session: MobileSession) {}

  /** Hay formulario de login: URL `/login` o campo de contraseña visible. */
  async isShown(): Promise<boolean> {
    const driver = await webDriver(this.session);
    if (isLoginUrl(await webUrl(this.session))) return true;
    return driver
      .execute<
        boolean,
        [string[]]
      >((sels: string[]) => sels.some((s) => Array.from(document.querySelectorAll(s)).some((el) => (el as HTMLElement).offsetParent !== null)), resolveWebSelectors(PASSENGER_LOGIN_LOCATORS.passwordInput))
      .catch(() => false);
  }

  async waitUntilShown(options: UntilOptions = {}): Promise<void> {
    await Waits.until(() => this.isShown(), {
      label: 'formulario de login PAX visible',
      timeout: 20_000,
      ...options
    });
  }

  /** Completa email + contraseña (valor nativo + eventos `input`/`change`) y toca «Ingresar». */
  async fillAndSubmit(email: string, password: string): Promise<PassengerLoginSubmitResult> {
    const driver = await webDriver(this.session);
    const filled = await driver
      .execute<
        { emailFilled: boolean; passwordFilled: boolean },
        [string[], string[], string, string]
      >(
        (emailSels: string[], passSels: string[], em: string, pw: string) => {
          const set = (sels: string[], val: string): boolean => {
            for (const s of sels) {
              const el = document.querySelector(s) as HTMLInputElement | null;
              if (!el) continue;
              const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
              )?.set;
              setter?.call(el, val);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          };
          return { emailFilled: set(emailSels, em), passwordFilled: set(passSels, pw) };
        },
        resolveWebSelectors(PASSENGER_LOGIN_LOCATORS.emailInput),
        resolveWebSelectors(PASSENGER_LOGIN_LOCATORS.passwordInput),
        email,
        password
      )
      .catch(() => ({ emailFilled: false, passwordFilled: false }));
    if (!filled.emailFilled || !filled.passwordFilled) return { ...filled, submitted: false };
    const submitted = await this.clickFirstVisible(PASSENGER_LOGIN_LOCATORS.submitButton);
    return { ...filled, submitted };
  }

  /** Modal de error visible y su texto (`span.subtitle`); `{ shown: false, text: '' }` si no hay. */
  async readErrorModal(): Promise<ErrorModalState> {
    const driver = await webDriver(this.session);
    return driver
      .execute<ErrorModalState, [string[], string[]]>(
        (modalSels: string[], textSels: string[]) => {
          const visible = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const shown = modalSels.some((s) =>
            Array.from(document.querySelectorAll(s)).some(visible)
          );
          if (!shown) return { shown: false, text: '' };
          for (const s of textSels) {
            const el = Array.from(document.querySelectorAll(s)).find(visible);
            if (el) {
              return {
                shown: true,
                text: String((el as HTMLElement).innerText ?? el.textContent ?? '')
                  .replace(/\s+/g, ' ')
                  .trim()
              };
            }
          }
          return { shown: true, text: '' };
        },
        resolveWebSelectors(PASSENGER_LOGIN_LOCATORS.errorModal),
        resolveWebSelectors(PASSENGER_LOGIN_LOCATORS.errorModalText)
      )
      .catch(() => ({ shown: false, text: '' }));
  }

  /** Espera el modal de error con texto y lo devuelve. */
  async waitForErrorModal(options: UntilOptions = {}): Promise<ErrorModalState> {
    let state: ErrorModalState = { shown: false, text: '' };
    await Waits.until(
      async () => {
        state = await this.readErrorModal();
        return state.shown && state.text !== '';
      },
      { label: 'modal de error de login', timeout: 15_000, ...options }
    );
    return state;
  }

  /** Toca «Aceptar» del modal de error. Devuelve si había botón que tocar. */
  closeErrorModal(): Promise<boolean> {
    return this.clickFirstVisible(PASSENGER_LOGIN_LOCATORS.errorModalClose);
  }

  async waitForErrorModalClosed(options: UntilOptions = {}): Promise<void> {
    await Waits.until(async () => !(await this.readErrorModal()).shown, {
      label: 'modal de error de login cerrado',
      timeout: 10_000,
      ...options
    });
  }

  private async clickFirstVisible(locator: Locator): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>((sels: string[]) => {
        for (const s of sels) {
          const el = Array.from(document.querySelectorAll(s)).find(
            (e) => (e as HTMLElement).offsetParent !== null
          ) as HTMLElement | undefined;
          if (el) {
            el.click();
            return true;
          }
        }
        return false;
      }, resolveWebSelectors(locator))
      .catch(() => false);
  }
}
