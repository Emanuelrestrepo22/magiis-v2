/**
 * HomeModeScreen (POM) — home PAX: etiqueta de modo de perfil («Modo Personal» / «Compañía: <nombre>») y el
 * interruptor Personal ↔ Compañía. Sin aserciones de negocio.
 *
 * Locators relevados del código (develop, `home.page.html`) y de V1; pendientes de validar en vivo (el login PAX
 * está bloqueado en los emuladores por FCM). El bloque `div.toggle-container` solo existe si
 * `identityService.personalModeDisabled == false` y el `ion-toggle` queda `disabled` si el usuario no tiene
 * perfil corporativo (`!hasProfileCorp`).
 * Etiquetas i18n: es «Modo Personal» / «Compañía», en «Personal Mode» / «Company».
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver } from './passengerWeb.js';

export type HomeMode = 'personal' | 'company' | 'none';

export const PASSENGER_HOME_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo: `span.toggle_label` (label_personal o label_corporate + nombre)
  modeLabel: defineLocator({
    id: 'passenger.home.modeLabel',
    web: 'div.toggle-container .toggle_label'
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo: `<ion-toggle mode="ios" [disabled]="!hasProfileCorp">`
  modeToggle: defineLocator({
    id: 'passenger.home.modeToggle',
    web: 'div.toggle-container ion-toggle'
  })
} as const;

/** Pura: clasifica el texto visible del home (es/en). */
export function classifyHomeMode(visibleText: string): HomeMode {
  const t = normalizeForMatch(visibleText);
  if (t.includes('modo personal') || t.includes('personal mode')) return 'personal';
  if (t.includes('compania') || t.includes('company')) return 'company';
  return 'none';
}

export class HomeModeScreen {
  constructor(private readonly session: MobileSession) {}

  /** Modo según `.toggle_label`; si no hay etiqueta, cae al texto del body (marcador de sesión). */
  async readMode(): Promise<HomeMode> {
    const driver = await webDriver(this.session);
    const label = await driver
      .execute<
        string,
        [string]
      >((sel: string) => String(document.querySelector(sel)?.textContent ?? ''), resolveWebSelectors(PASSENGER_HOME_LOCATORS.modeLabel)[0]!)
      .catch(() => '');
    const fromLabel = classifyHomeMode(label);
    if (fromLabel !== 'none') return fromLabel;
    const body = await driver
      .execute<string, []>(() => String(document.body?.innerText ?? ''))
      .catch(() => '');
    return classifyHomeMode(body);
  }

  /** `true` si el interruptor existe y es visible (no lo es con `personalModeDisabled`). */
  async isToggleVisible(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<
        boolean,
        [string]
      >((sel: string) => (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).some((t) => t.offsetParent !== null), resolveWebSelectors(PASSENGER_HOME_LOCATORS.modeToggle)[0]!)
      .catch(() => false);
  }

  /** `true` si el interruptor está deshabilitado (sin perfil corporativo) o no existe. */
  async isToggleDisabled(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        const toggle = document.querySelector(sel) as (HTMLElement & { disabled?: boolean }) | null;
        if (!toggle) return true;
        return Boolean(toggle.disabled) || toggle.hasAttribute('disabled');
      }, resolveWebSelectors(PASSENGER_HOME_LOCATORS.modeToggle)[0]!)
      .catch(() => true);
  }

  /** Cambia el interruptor (JS click, como V1). Devuelve si existía. */
  async tapToggle(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        const toggle = document.querySelector(sel) as HTMLElement | null;
        if (!toggle) return false;
        toggle.click();
        return true;
      }, resolveWebSelectors(PASSENGER_HOME_LOCATORS.modeToggle)[0]!)
      .catch(() => false);
  }
}
