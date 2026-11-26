/**
 * WalletCardRowsScreen (POM, PAX) — filas de tarjetas de la billetera: lectura y baja de UNA fila.
 *
 * REGLA DE SEGURIDAD: `tapTrashAt` es un tap IRREVERSIBLE de bajo nivel (en develop NO hay diálogo de
 * confirmación: el tap en el tacho llama `removeCard()` y elimina la tarjeta del backend). NO debe llamarse desde
 * un spec: solo `pbo/PassengerWalletPBO` lo invoca, tras `assertConfirmed` y tras decidir con `planCardDelete`.
 * Aun así re-verifica EN EL DOM, antes de tocar, que la fila elegida sigue siendo la que se pidió (last4 único y,
 * salvo permiso explícito, no «Principal»). No existe aquí «borrar todas» ni «borrar la primera».
 *
 * Relevado del código (`magiis-mobile-passenger-v2@develop`, `cards.page.html`; NO validado en vivo):
 *  - Fila: `ion-item-sliding > ion-item.card-item`; etiqueta `span.card-item-label` («VISA ...4242»); «Principal» =
 *    `ion-icon[name="star"]` dentro de `.card-data .type`; vencida = `.card-expired`.
 *  - Acciones: `ion-item-options > button` con `ion-icon.icono_favorite|icono_isFavorite` (estrella, `setPrincipalCard`)
 *    y `ion-icon.icono_trash` (`showRemoveCardDialog` -> `removeCard`, sin confirmación). V1 buscaba un menú
 *    (`button.card-item-opts` / popover) que en develop ya no se usa (`showPopoverCard` no se invoca desde la plantilla).
 *  - Con varios países la plantilla repite `ion-item-sliding` sin `ion-item` para los países ajenos: por eso las filas
 *    se indexan por `ion-item.card-item`, no por `ion-item-sliding`.
 */

import { defineLocator, resolveWebSelectors } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { webDriver } from './passengerWeb.js';
import { parseCardLabel, type WalletCardRow } from './walletParsing.js';

export const WALLET_ROW_LOCATORS = {
  // código: fila visible de tarjeta
  row: defineLocator({ id: 'passenger.wallet.row', web: 'ion-item.card-item' })
} as const;

export type TrashResult = 'tapped' | 'mismatch' | 'ambiguous' | 'default-refused' | 'no-trash';

export class WalletCardRowsScreen {
  constructor(private readonly session: MobileSession) {}

  /** SOLO LECTURA: filas visibles, en orden del DOM. */
  async readRows(): Promise<WalletCardRow[]> {
    const driver = await webDriver(this.session);
    const raw = await driver
      .execute<Array<{ label: string; isDefault: boolean; expired: boolean }>, [string]>(
        (sel: string) => {
          const visible = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          return (Array.from(document.querySelectorAll(sel)) as HTMLElement[])
            .filter(visible)
            .map((item) => ({
              label: (item.querySelector('span.card-item-label')?.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim(),
              isDefault: item.querySelector('.card-data .type ion-icon[name="star"]') !== null,
              expired: item.querySelector('.card-expired') !== null
            }));
        },
        resolveWebSelectors(WALLET_ROW_LOCATORS.row)[0]!
      )
      .catch(() => []);
    const rows: WalletCardRow[] = [];
    for (const r of raw) {
      const parsed = parseCardLabel(r.label);
      if (!parsed) continue; // fila ilegible: no se inventa un last4
      rows.push({
        index: rows.length,
        label: r.label,
        brand: parsed.brand,
        last4: parsed.last4,
        isDefault: r.isDefault,
        expired: r.expired
      });
    }
    return rows;
  }

  /**
   * Toca el tacho de la fila `index` (IRREVERSIBLE). Antes re-verifica en el DOM: la fila `index` tiene ese
   * `last4`, ninguna otra visible lo tiene (`ambiguous`) y, si `allowDefault` es falso, no es «Principal».
   * Solo en caso afirmativo hace el click (JS click sobre el botón del tacho; las opciones están en el DOM aunque
   * la fila no esté deslizada). Devuelve por qué NO tocó si corresponde.
   */
  async tapTrashAt(
    index: number,
    expectedLast4: string,
    allowDefault: boolean
  ): Promise<TrashResult> {
    const driver = await webDriver(this.session);
    return driver
      .execute<TrashResult, [string, number, string, boolean]>(
        (sel: string, idx: number, last4: string, allowDef: boolean) => {
          const visible = (el: Element): boolean => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          };
          const items = (Array.from(document.querySelectorAll(sel)) as HTMLElement[]).filter(
            visible
          );
          const last4Of = (item: HTMLElement): string => {
            const t = (item.querySelector('span.card-item-label')?.textContent ?? '').replace(
              /\s+/g,
              ' '
            );
            const m = /(\d{4})\s*$/.exec(t.trim());
            return m ? m[1]! : '';
          };
          const item = items[idx];
          if (!item || last4Of(item) !== last4) return 'mismatch';
          if (items.filter((it) => last4Of(it) === last4).length !== 1) return 'ambiguous';
          const isDefault = item.querySelector('.card-data .type ion-icon[name="star"]') !== null;
          if (isDefault && !allowDef) return 'default-refused';
          const sliding = item.closest('ion-item-sliding');
          const trash = (
            Array.from(sliding?.querySelectorAll('ion-item-options button') ?? []) as HTMLElement[]
          ).find((b) => b.querySelector('ion-icon[name="trash"], ion-icon.icono_trash') !== null);
          if (!trash) return 'no-trash';
          trash.click();
          return 'tapped';
        },
        resolveWebSelectors(WALLET_ROW_LOCATORS.row)[0]!,
        index,
        expectedLast4,
        allowDefault
      )
      .catch(() => 'no-trash' as const);
  }
}
