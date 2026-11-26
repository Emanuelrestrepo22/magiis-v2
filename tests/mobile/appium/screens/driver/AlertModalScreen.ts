/**
 * AlertModalScreen (POM) — modales de aviso/error del Driver que bloquean el home (p. ej. errores al cambiar la
 * disponibilidad): `app-alert-modal` (Aceptar = `button.btn-outlined-red`, visto en trip-lost), `ion-modal.alert-modal-atention`
 * (declinaciones de cobro) y los de confirmación/Ionic (`app-confirm-modal`, `ion-alert`).
 * Solo lectura del texto + tap del botón de cierre. NO decide nada de negocio: el llamador interpreta el texto.
 * Locators relevados en `docs/mobile/driver-app-appium-flow-map.md`; el texto del aviso por código de error
 * NO está catalogado (se lee en vivo y se registra como observación).
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { webDriver } from './driverWeb.js';

export const ALERT_MODAL_LOCATORS = {
  container: defineLocator({
    id: 'driver.alert.container',
    web: ['app-alert-modal', 'ion-modal.alert-modal-atention', 'app-confirm-modal', 'ion-alert']
  }),
  /** Botón de cierre: por orden, el de `app-alert-modal`, los de ion-modal/ion-alert y el primario de confirm. */
  closeButton: defineLocator({
    id: 'driver.alert.closeButton',
    web: [
      'app-alert-modal button.btn-outlined-red',
      'app-alert-modal button',
      'ion-modal.alert-modal-atention button',
      'app-confirm-modal button.btn.primary',
      'ion-alert button'
    ]
  })
} as const;

export type AlertState = { shown: boolean; text: string };

export class AlertModalScreen {
  constructor(private readonly session: MobileSession) {}

  /** Hay un aviso visible y su texto normalizado ('' si no hay). */
  async read(): Promise<AlertState> {
    const driver = await webDriver(this.session);
    return driver
      .execute<AlertState, [string[]]>((sels: string[]) => {
        for (const s of sels) {
          const el = (Array.from(document.querySelectorAll(s)) as HTMLElement[]).find((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (el) {
            return {
              shown: true,
              text: String(el.innerText ?? el.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 300)
            };
          }
        }
        return { shown: false, text: '' };
      }, resolveWebSelectors(ALERT_MODAL_LOCATORS.container))
      .catch(() => ({ shown: false, text: '' }));
  }

  /** Toca el botón de cierre del aviso visible (JS click). Devuelve si había algo que cerrar. */
  async tapClose(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>((sels: string[]) => {
        const btn = sels
          .flatMap((s) => Array.from(document.querySelectorAll(s)) as HTMLElement[])
          .find((b) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled);
        if (!btn) return false;
        btn.click();
        return true;
      }, resolveWebSelectors(ALERT_MODAL_LOCATORS.closeButton))
      .catch(() => false);
  }
}
