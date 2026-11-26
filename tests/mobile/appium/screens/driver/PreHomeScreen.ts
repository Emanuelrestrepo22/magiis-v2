/**
 * PreHomeScreen (POM) — overlay `/pre-home` («Cargando Servicios…» -> mensaje de continuar + «Aceptar»).
 * Tras el login la app cae acá (chofer OFFLINE, `#availability` no existe); «Aceptar»
 * (`app-pre-home button.btn.primary`) dispara `hideOverlay()`, que navega a `/navigator/home` SOLO cuando
 * los servicios terminaron de cargar. Con sesión vencida, continuar rebota a `/login`.
 * Migrado de `driver/DriverHomeScreen.dismissPreHomeOverlayIfPresent`. Sin aserciones de negocio.
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { I18n } from '../../core/I18n.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { isPreHomeUrl, webDriver, webUrl } from './driverWeb.js';

export const PRE_HOME_LOCATORS = {
  /** Mensaje «continuar» (servicios listos); con servicios cargando se ve «Cargando Servicios…». */
  continueMessage: defineLocator({ id: 'driver.preHome.continueMessage', web: '.continue-msg' }),
  acceptButton: defineLocator({
    id: 'driver.preHome.acceptButton',
    web: ['app-pre-home button.btn.primary', 'app-pre-home button'],
    textKey: 'driver.buttons.accept'
  })
} as const;

export class PreHomeScreen {
  constructor(
    private readonly session: MobileSession,
    private readonly i18n: I18n
  ) {}

  async isShown(): Promise<boolean> {
    return isPreHomeUrl(await webUrl(this.session));
  }

  /** Servicios cargados: hay un `.continue-msg` visible con texto. */
  async isReady(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<
        boolean,
        [string[]]
      >((sels: string[]) => sels.some((s) => (Array.from(document.querySelectorAll(s)) as HTMLElement[]).some((m) => m.offsetParent !== null && (m.innerText ?? '').trim().length > 0)), resolveWebSelectors(PRE_HOME_LOCATORS.continueMessage))
      .catch(() => false);
  }

  /** Texto visible del overlay (evidencia: «Cargando Servicios…» vs mensaje de continuar). */
  async readMessage(): Promise<string> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string, []>(() => {
        const el = document.querySelector('app-pre-home') as HTMLElement | null;
        return String(el?.innerText ?? '')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .catch(() => '');
  }

  /**
   * Toca «Aceptar» con JS click (el click coordinado se intercepta en este build). Prefiere el botón cuyo
   * texto coincide con una variante i18n de `driver.buttons.accept`; si la key no está disponible en el
   * locale, usa el primer botón visible del overlay. Devuelve si hubo algo que tocar.
   */
  async tapAccept(): Promise<boolean> {
    const driver = await webDriver(this.session);
    let variants: string[] = [];
    try {
      variants = this.i18n.variants(PRE_HOME_LOCATORS.acceptButton.textKey!);
    } catch {
      variants = []; // key pendiente/faltante: se cae al primer botón visible
    }
    return driver
      .execute<boolean, [string[], string[]]>(
        (sels: string[], accept: string[]) => {
          const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
          const wanted = accept.map(norm);
          const buttons = sels
            .flatMap((s) => Array.from(document.querySelectorAll(s)) as HTMLElement[])
            .filter((el) => el.offsetParent !== null);
          const btn = buttons.find((b) => wanted.includes(norm(b.innerText ?? ''))) ?? buttons[0];
          if (!btn) return false;
          btn.click();
          return true;
        },
        resolveWebSelectors(PRE_HOME_LOCATORS.acceptButton),
        variants
      )
      .catch(() => false);
  }
}
