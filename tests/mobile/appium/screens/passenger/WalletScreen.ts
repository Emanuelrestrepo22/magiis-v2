/**
 * WalletScreen (POM, PAX) — pantalla «Billetera» (`/cards`): entrada desde el menú lateral, botón «Agregar», estado
 * vacío y aviso (toast). Sin aserciones de negocio. Las filas de tarjetas viven en `WalletCardRowsScreen` y el
 * formulario de alta en `WalletCardFormScreen`.
 *
 * Relevado del código (`magiis-mobile-passenger-v2@develop`, NO validado en vivo: login PAX bloqueado por FCM):
 *  - Entrada: `app.component.html` (`ion-menu side="end"`), ítem `ion-item[routerLink="/cards"]` con
 *    `ion-label` = `menu.label_cards` («Billetera» / «Wallet»). Queda `disabled` si el carrier activo no tiene
 *    `mpMagiisPublicKey` (la billetera no está disponible para ese carrier).
 *  - `cards.page.html`: encabezado por país con `button.btn.primary` = `cards.add` en mayúsculas («AGREGAR» /
 *    «ADD PAYMENT METHOD»); solo está habilitado el del país del carrier activo. Estado vacío:
 *    `.no-credit-cards` (`cards.no_credit_cards`). Toasts: `ion-toast` (propiedad `message`).
 *  - DIFERENCIA vs V1: no hay submenú «Mi cuenta» (V1 lo recorría) ni popover de fila (`card-item-opts`).
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { webDriver, webUrl } from './passengerWeb.js';
import { ADD_CARD_LABELS, WALLET_MENU_LABELS } from './walletParsing.js';

export const WALLET_LOCATORS = {
  // código: ítem del menú lateral (`ion-menu ion-item` con `ion-label`)
  menuItem: defineLocator({ id: 'passenger.wallet.menuItem', web: 'ion-menu ion-item' }),
  // código: botón «AGREGAR» del encabezado de cada país (dentro de `ion-list-header`)
  addButton: defineLocator({
    id: 'passenger.wallet.addButton',
    web: 'ion-list-header button.btn.primary'
  }),
  // código: estado vacío (`<div class="no-credit-cards">`)
  emptyState: defineLocator({ id: 'passenger.wallet.emptyState', web: '.no-credit-cards' }),
  // código: toast de Ionic (el texto es la propiedad `message` del elemento)
  toast: defineLocator({ id: 'passenger.wallet.toast', web: 'ion-toast' })
} as const;

export type MenuEntryResult = 'tapped' | 'disabled' | 'not-found';
export type AddButtonResult = 'tapped' | 'disabled' | 'not-found';
export type AddButtonInfo = { label: string; enabled: boolean };

export class WalletScreen {
  constructor(private readonly session: MobileSession) {}

  url(): Promise<string> {
    return webUrl(this.session);
  }

  /** Toca el ítem «Billetera»/«Wallet» del menú lateral (que ya debe estar abierto). JS click. */
  async tapMenuEntry(): Promise<MenuEntryResult> {
    const driver = await webDriver(this.session);
    return driver
      .execute<MenuEntryResult, [string, readonly string[]]>(
        (sel: string, labels: readonly string[]) => {
          const norm = (v: unknown): string =>
            String(v ?? '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          const item = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).find((el) =>
            labels.includes(norm(el.querySelector('ion-label')?.textContent ?? el.textContent))
          );
          if (!item) return 'not-found';
          if (item.hasAttribute('disabled') || item.classList.contains('item-disabled')) {
            return 'disabled';
          }
          item.click();
          return 'tapped';
        },
        resolveWebSelectors(WALLET_LOCATORS.menuItem)[0]!,
        WALLET_MENU_LABELS
      )
      .catch(() => 'not-found' as const);
  }

  /** SOLO LECTURA: botones «Agregar» visibles (uno por país) y si están habilitados. */
  async readAddButtons(): Promise<AddButtonInfo[]> {
    const driver = await webDriver(this.session);
    return driver
      .execute<AddButtonInfo[], [string, readonly string[]]>(
        (sel: string, labels: readonly string[]) => {
          const norm = (v: unknown): string =>
            String(v ?? '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          const visible = (el: HTMLElement): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
          };
          return (Array.from(document.querySelectorAll(sel)) as HTMLButtonElement[])
            .filter(visible)
            .map((b) => ({ label: (b.textContent ?? '').trim(), enabled: !b.disabled }))
            .filter((b) => labels.includes(norm(b.label)));
        },
        resolveWebSelectors(WALLET_LOCATORS.addButton)[0]!,
        ADD_CARD_LABELS
      )
      .catch(() => []);
  }

  /**
   * Toca el PRIMER «Agregar» habilitado (abre el formulario: es reversible, no crea nada). Con varios países solo
   * uno está habilitado (el del carrier activo).
   */
  async tapAdd(): Promise<AddButtonResult> {
    const driver = await webDriver(this.session);
    return driver
      .execute<AddButtonResult, [string, readonly string[]]>(
        (sel: string, labels: readonly string[]) => {
          const norm = (v: unknown): string =>
            String(v ?? '')
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();
          const visible = (el: HTMLElement): boolean => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const buttons = (
            Array.from(document.querySelectorAll(sel)) as HTMLButtonElement[]
          ).filter((b) => visible(b) && labels.includes(norm(b.textContent)));
          if (buttons.length === 0) return 'not-found';
          const enabled = buttons.find((b) => !b.disabled);
          if (!enabled) return 'disabled';
          enabled.scrollIntoView({ block: 'center' });
          enabled.click();
          return 'tapped';
        },
        resolveWebSelectors(WALLET_LOCATORS.addButton)[0]!,
        ADD_CARD_LABELS
      )
      .catch(() => 'not-found' as const);
  }

  /** SOLO LECTURA: el estado vacío (`.no-credit-cards`) está visible. */
  async isEmptyStateVisible(): Promise<boolean> {
    const driver = await webDriver(this.session);
    return driver
      .execute<boolean, [string]>((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }, resolveWebSelectors(WALLET_LOCATORS.emptyState)[0]!)
      .catch(() => false);
  }

  /** SOLO LECTURA: textos de los `ion-toast` presentes (`message`). */
  async readToasts(): Promise<string[]> {
    const driver = await webDriver(this.session);
    return driver
      .execute<string[], [string]>(
        (sel: string) =>
          (Array.from(document.querySelectorAll(sel)) as Array<HTMLElement & { message?: string }>)
            .map((t) =>
              String(t.message ?? t.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .filter((t) => t.length > 0),
        resolveWebSelectors(WALLET_LOCATORS.toast)[0]!
      )
      .catch(() => []);
  }
}
