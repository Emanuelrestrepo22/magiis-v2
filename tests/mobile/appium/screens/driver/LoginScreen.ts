/**
 * LoginScreen (POM) — formulario de login de la app chofer (`/login`, ion-input con shadow DOM).
 * Solo locators + acciones atómicas + estado observable. Sin aserciones de negocio ni navegación.
 * Migrado de `driver/DriverTripPreflight.loginDriver` y `scripts/driver-relogin-and-home.ts`.
 * Las credenciales entran como argumentos de `fillAndSubmit` y NUNCA se loguean ni se devuelven.
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { Waits } from '../../core/Waits.js';
import { isLoginUrl, webDriver, webUrl } from './driverWeb.js';

export const LOGIN_LOCATORS = {
  passwordInput: defineLocator({
    id: 'driver.login.passwordInput',
    web: ['input[type="password"]', 'ion-input[type="password"] input']
  }),
  /** CTA principal del formulario; el texto («Entrar») no es el selector primario (depende del idioma). */
  submitButton: defineLocator({ id: 'driver.login.submitButton', web: 'button.btn.primary' })
} as const;

/**
 * Textos de CTA de login conocidos por el código legado (`/entrar|ingresar|login|iniciar/`). Solo desambiguan
 * cuando hay más de un candidato; con un único `button.btn.primary` visible no hace falta texto.
 */
export const LOGIN_SUBMIT_TEXT_HINTS: readonly RegExp[] = [
  /entrar/i,
  /ingresar/i,
  /login/i,
  /iniciar/i
];

export type LoginButtonCandidate = { index: number; text: string; primary: boolean };

/**
 * Pura: elige el botón de envío. Prefiere el que matchea un hint de texto; si ninguno matchea, acepta el
 * ÚNICO candidato `primary`; con ambigüedad devuelve null (no se adivina).
 */
export function pickLoginSubmit(candidates: readonly LoginButtonCandidate[]): number | null {
  for (const c of candidates) {
    if (LOGIN_SUBMIT_TEXT_HINTS.some((h) => h.test(c.text))) return c.index;
  }
  const primaries = candidates.filter((c) => c.primary);
  return primaries.length === 1 ? primaries[0]!.index : null;
}

export type LoginSubmitResult = {
  emailFilled: boolean;
  passwordFilled: boolean;
  submitted: boolean;
};

const SUBMIT_SELECTOR = 'button, [role="button"], ion-button';

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
      >((sels: string[]) => sels.some((s) => Array.from(document.querySelectorAll(s)).some((el) => (el as HTMLElement).offsetParent !== null)), resolveWebSelectors(LOGIN_LOCATORS.passwordInput))
      .catch(() => false);
  }

  async waitUntilShown(timeoutMs = 20_000): Promise<void> {
    await Waits.until(() => this.isShown(), {
      timeout: timeoutMs,
      label: 'formulario de login visible'
    });
  }

  /** Completa email + contraseña (ion-input, atravesando shadow DOM, con eventos Ionic) y envía. */
  async fillAndSubmit(email: string, password: string): Promise<LoginSubmitResult> {
    const driver = await webDriver(this.session);
    const filled = await driver
      .execute<{ emailFilled: boolean; passwordFilled: boolean }, [string, string]>(
        (em: string, pw: string) => {
          const set = (host: Element | null, val: string): boolean => {
            if (!host) return false;
            const inner = (host.querySelector('input') ||
              (host as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot?.querySelector(
                'input'
              )) as HTMLInputElement | null;
            if (!inner) return false;
            const setter = Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              'value'
            )?.set;
            setter?.call(inner, val);
            inner.dispatchEvent(new Event('input', { bubbles: true }));
            inner.dispatchEvent(new Event('change', { bubbles: true }));
            host.dispatchEvent(
              new CustomEvent('ionInput', { bubbles: true, detail: { value: val } })
            );
            host.dispatchEvent(
              new CustomEvent('ionChange', { bubbles: true, detail: { value: val } })
            );
            return true;
          };
          const ions = Array.from(document.querySelectorAll('ion-input')) as HTMLElement[];
          let emailHost: Element | null = null;
          let passHost: Element | null = null;
          for (const ion of ions) {
            const inner = ion.querySelector('input') || ion.shadowRoot?.querySelector('input');
            const type = inner?.getAttribute('type') || ion.getAttribute('type') || '';
            if (/password/i.test(type)) passHost = ion;
            else if (!emailHost) emailHost = ion;
          }
          if (!emailHost) {
            emailHost = document.querySelector(
              'input[type="email"], input[type="text"], input:not([type="password"])'
            );
          }
          if (!passHost) {
            passHost =
              document.querySelector('ion-input[type="password"]') ||
              document.querySelector('input[type="password"]')?.closest('ion-input') ||
              null;
          }
          return { emailFilled: set(emailHost, em), passwordFilled: set(passHost, pw) };
        },
        email,
        password
      )
      .catch(() => ({ emailFilled: false, passwordFilled: false }));
    if (!filled.emailFilled || !filled.passwordFilled) return { ...filled, submitted: false };

    const candidates = await driver
      .execute<LoginButtonCandidate[], [string]>((selector: string) => {
        const all = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
        const out: { index: number; text: string; primary: boolean }[] = [];
        all.forEach((el, index) => {
          if (el.offsetParent === null) return;
          out.push({
            index,
            text: String(el.innerText || el.textContent || '')
              .replace(/\s+/g, ' ')
              .trim(),
            primary: el.matches('button.btn.primary')
          });
        });
        return out;
      }, SUBMIT_SELECTOR)
      .catch(() => [] as LoginButtonCandidate[]);
    const chosen = pickLoginSubmit(candidates);
    if (chosen === null) return { ...filled, submitted: false };
    const submitted = await driver
      .execute<boolean, [string, number]>(
        (selector: string, index: number) => {
          const el = (Array.from(document.querySelectorAll(selector)) as HTMLElement[])[index];
          if (!el) return false;
          el.click();
          return true;
        },
        SUBMIT_SELECTOR,
        chosen
      )
      .catch(() => false);
    return { ...filled, submitted };
  }
}
