/**
 * SideMenuScreen (POM) — menú lateral de la app Pasajero (`ion-menu`, lado derecho): abrirlo, ver y tocar
 * «Salir» (`button.log-out-menu`) y cerrarlo. Sin aserciones de negocio.
 *
 * Todos los locators fueron relevados del código (`magiis-mobile-passenger-v2@develop`, `app.component.html` y
 * `navigator.page.html`), pendientes de validar en vivo (el login PAX está bloqueado en los emuladores).
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { webDriver } from './passengerWeb.js';

export const PASSENGER_SIDE_MENU_LOCATORS = {
  // relevado del código (develop), pendiente de validar en vivo: `<ion-menu contentId="main-content" side="end">`
  menu: defineLocator({ id: 'passenger.menu.container', web: 'ion-menu' }),
  // relevado del código (develop), pendiente de validar en vivo: pestaña inferior «Cuenta» con `ion-menu-toggle`
  menuToggle: defineLocator({
    id: 'passenger.menu.toggle',
    web: ['#app-tab-bar ion-menu-toggle', '#app-tab-bar .menu-tab-bottom']
  }),
  // relevado del código (develop), pendiente de validar en vivo: botón «Salir» (`select_carrier.button_logout`)
  logout: defineLocator({ id: 'passenger.menu.logout', web: 'ion-menu button.log-out-menu' })
} as const;

export class SideMenuScreen {
  constructor(private readonly session: MobileSession) {}

  /** Abre el menú con la API `ion-menu.open()`; fallback: toggle visible de la barra inferior. */
  async open(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string, string[]]>(
        (menuSel: string, toggleSels: string[]) => {
          const menu = document.querySelector(menuSel) as
            | (HTMLElement & { open?: () => Promise<boolean> })
            | null;
          if (menu && typeof menu.open === 'function') {
            void menu.open();
            return true;
          }
          for (const s of toggleSels) {
            const toggle = (Array.from(document.querySelectorAll(s)) as HTMLElement[]).find(
              (t) => t.offsetParent !== null
            );
            if (toggle) {
              toggle.click();
              return true;
            }
          }
          return false;
        },
        resolveWebSelectors(PASSENGER_SIDE_MENU_LOCATORS.menu)[0]!,
        resolveWebSelectors(PASSENGER_SIDE_MENU_LOCATORS.menuToggle)
      )
      .catch(() => false);
  }

  /** Cierra el menú con `ion-menu.close()`. Devuelve si había menú. */
  async close(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((menuSel: string) => {
        const menu = document.querySelector(menuSel) as
          | (HTMLElement & { close?: () => Promise<boolean> })
          | null;
        if (!menu || typeof menu.close !== 'function') return false;
        void menu.close();
        return true;
      }, resolveWebSelectors(PASSENGER_SIDE_MENU_LOCATORS.menu)[0]!)
      .catch(() => false);
  }

  async isLogoutVisible(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<
        boolean,
        [string]
      >((sel: string) => (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).some((b) => b.offsetParent !== null), resolveWebSelectors(PASSENGER_SIDE_MENU_LOCATORS.logout)[0]!)
      .catch(() => false);
  }

  /** Toca «Salir» (JS click). Devuelve si el botón estaba visible. */
  async tapLogout(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        const btn = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).find(
          (b) => b.offsetParent !== null
        );
        if (!btn) return false;
        btn.click();
        return true;
      }, resolveWebSelectors(PASSENGER_SIDE_MENU_LOCATORS.logout)[0]!)
      .catch(() => false);
  }
}
