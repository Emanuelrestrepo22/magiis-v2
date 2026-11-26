/**
 * SideMenuScreen (POM) — menú lateral del Driver (`ion-menu`): solo lo que necesita la sesión, «Cerrar
 * sesión» (`button.log-out-menu`) y su eventual confirmación. Locators validados en device 2026-07-22
 * (`scripts/driver-validate-menu-destructive.ts`). Logout deja al chofer OFFLINE y navega a `/login`.
 * Sin aserciones de negocio.
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { webDriver } from './driverWeb.js';

export const SIDE_MENU_LOCATORS = {
  menu: defineLocator({ id: 'driver.menu.container', web: 'ion-menu' }),
  menuToggle: defineLocator({ id: 'driver.menu.toggle', web: 'ion-menu-toggle' }),
  logout: defineLocator({ id: 'driver.menu.logout', web: 'button.log-out-menu' }),
  /** Confirmación opcional de logout (el build puede no pedirla). */
  logoutConfirm: defineLocator({
    id: 'driver.menu.logoutConfirm',
    web: ['app-confirm-modal button.btn.primary', 'ion-alert button']
  })
} as const;

export class SideMenuScreen {
  constructor(private readonly session: MobileSession) {}

  /** Abre el menú con la API `ion-menu.open()` (más robusta que tocar el toggle); fallback: toggle visible. */
  async open(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string, string]>(
        (menuSel: string, toggleSel: string) => {
          const menu = document.querySelector(menuSel) as
            | (HTMLElement & { open?: () => Promise<boolean> })
            | null;
          if (menu && typeof menu.open === 'function') {
            void menu.open();
            return true;
          }
          const toggle = (Array.from(document.querySelectorAll(toggleSel)) as HTMLElement[]).find(
            (t) => t.offsetParent !== null
          );
          if (toggle) {
            toggle.click();
            return true;
          }
          return false;
        },
        resolveWebSelectors(SIDE_MENU_LOCATORS.menu)[0]!,
        resolveWebSelectors(SIDE_MENU_LOCATORS.menuToggle)[0]!
      )
      .catch(() => false);
  }

  async isLogoutVisible(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<
        boolean,
        [string]
      >((sel: string) => (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).some((b) => b.offsetParent !== null), resolveWebSelectors(SIDE_MENU_LOCATORS.logout)[0]!)
      .catch(() => false);
  }

  /** Toca «Cerrar sesión» (JS click). Devuelve si el botón estaba visible. */
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
      }, resolveWebSelectors(SIDE_MENU_LOCATORS.logout)[0]!)
      .catch(() => false);
  }

  /** Si el build pidió confirmación de logout, la acepta (primer botón primario visible). Devuelve si había. */
  async confirmLogoutIfAsked(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string[]]>((sels: string[]) => {
        const btn = sels
          .flatMap((s) => Array.from(document.querySelectorAll(s)) as HTMLElement[])
          .find((b) => b.offsetParent !== null);
        if (!btn) return false;
        btn.click();
        return true;
      }, resolveWebSelectors(SIDE_MENU_LOCATORS.logoutConfirm))
      .catch(() => false);
  }
}
