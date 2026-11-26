/**
 * PaymentSelectorScreen (POM) — selector de método de pago de `travel-info` en la app PAX (efectivo / cuenta
 * corriente / tarjeta) y lista de tarjetas. Sin aserciones de negocio ni navegación; NO toca ningún CTA de
 * confirmación (eso vive en `TripConfirmScreen`, tras compuerta en `TripRequestPBO`).
 *
 * Relevado del código (develop) y V1; pendiente de validar en vivo (el login PAX está bloqueado en los
 * emuladores por FCM):
 *  - travel-info.page.html:~148-190: `ion-row.payment-methods > ion-col.payment-method` (uno por método habilitado:
 *    efectivo `selectPaymentMethod('CASH')`, cuenta corriente `'CHECKING_ACCOUNT'`, tarjeta `addNewCard()`).
 *    Clases `payment-method-selected` / `payment-method-disabled`; etiqueta en `span.payment-method-name`.
 *    Etiquetas i18n: es «Efectivo» / «Cuenta Corriente» / «Tarjeta de Crédito»; en «Cash» / «Credit Account» /
 *    «Credit Card». Con tarjeta elegida la etiqueta pasa a `<MARCA> - <últimos4>` (travel-info.page.html:~172).
 *  - Tocar la columna de tarjeta NO abre un diálogo en develop: `addNewCard()` (travel-info.page.ts:980-1010) navega
 *    a `/cards?fromTravelInfo=true`, donde `ion-item.card-item` (cards.page.html:~48) con
 *    `span.card-item-label` = `<MARCA> ...<últimos4>` y `(click)="selectedCard(card)"` elige y vuelve (V1 usaba un
 *    `ion-modal`, versión 2.5.17): se dejan ambos selectores.
 */

import { defineLocator, resolveWebSelectors, type Locator } from '../../core/Locator.js';
import type { MobileSession } from '../../core/MobileSession.js';
import { normalizeForMatch } from './LoginScreen.js';
import { webDriver } from './passengerWeb.js';

export type PaymentKind = 'cash' | 'checking-account' | 'credit-card' | 'unknown';

export const PAYMENT_LOCATORS = {
  // relevado del código (develop) y V1, pendiente de validar en vivo
  methods: defineLocator({
    id: 'passenger.payment.methods',
    web: ['ion-row.payment-methods ion-col.payment-method', 'ion-col.payment-method']
  }),
  // relevado del código (develop) y V1, pendiente de validar en vivo
  cardItems: defineLocator({
    id: 'passenger.payment.cardItems',
    web: [
      'ion-item.card-item',
      'ion-modal ion-item.card-item, app-credit-card-dialog ion-item.card-item, ion-modal .card-item'
    ]
  })
} as const satisfies Record<string, Locator>;

export type PaymentOption = {
  index: number;
  kind: PaymentKind;
  text: string;
  selected: boolean;
  disabled: boolean;
};
export type CardOption = {
  index: number;
  text: string;
  brand: string;
  last4: string;
  expired: boolean;
};

/** Pura: clasifica la etiqueta de un método de pago (es/en; la tarjeta elegida es `MARCA - 1234`). */
export function classifyPaymentMethod(label: string): PaymentKind {
  const t = normalizeForMatch(label);
  if (/\befectivo\b|\bcash\b/.test(t)) return 'cash';
  if (/cuenta corriente|credit account|checking account/.test(t)) return 'checking-account';
  if (/tarjeta|credit card|\b[a-z]+ ?[-.*]+ ?\d{4}$/.test(t)) return 'credit-card';
  return 'unknown';
}

/** Pura: marca y últimos 4 de «VISA - 2224», «VISA ...2224» o «VISA ****2224» (vacíos si no matchea). */
export function parseCardLabel(label: string): { brand: string; last4: string } {
  const m = /([A-Za-z][A-Za-z ]*?)\s*(?:[-.*]+\s*)?(\d{4})\s*$/.exec(
    label.replace(/\s+/g, ' ').trim()
  );
  return m ? { brand: m[1]!.trim().toUpperCase(), last4: m[2]! } : { brand: '', last4: '' };
}

/** Pura: índice de la tarjeta con esos últimos 4 dígitos (`-1` si no hay). */
export function pickCardIndex(cards: readonly Pick<CardOption, 'last4'>[], last4: string): number {
  const digits = last4.replace(/\D/g, '').slice(-4);
  if (digits.length < 4) return -1;
  return cards.findIndex((c) => c.last4 === digits);
}

export class PaymentSelectorScreen {
  constructor(private readonly session: MobileSession) {}

  private async visibleElements(locator: Locator): Promise<WebdriverIO.Element[]> {
    const driver = await webDriver(this.session);
    for (const selector of resolveWebSelectors(locator)) {
      let found: WebdriverIO.Element[] = [];
      try {
        found = Array.from((await driver.$$(selector)) as Iterable<WebdriverIO.Element>);
      } catch {
        found = [];
      }
      const visible: WebdriverIO.Element[] = [];
      for (const el of found) if (await el.isDisplayed().catch(() => false)) visible.push(el);
      if (visible.length > 0) return visible;
    }
    return [];
  }

  /** Métodos de pago visibles, en orden, con su estado (seleccionado / deshabilitado) según las clases. */
  async readMethods(): Promise<PaymentOption[]> {
    const driver = await webDriver(this.session);
    const raw = await driver
      .execute<{ text: string; cls: string }[], [string[]]>((sels: string[]) => {
        for (const s of sels) {
          const items = (Array.from(document.querySelectorAll(s)) as HTMLElement[]).filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          if (items.length > 0)
            return items.map((el) => ({
              text: String(el.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim(),
              cls: el.className
            }));
        }
        return [];
      }, resolveWebSelectors(PAYMENT_LOCATORS.methods))
      .catch(() => []);
    return raw.map((r, index) => ({
      index,
      kind: classifyPaymentMethod(r.text),
      text: r.text,
      selected: /(^|\s)payment-method-selected(\s|$)/.test(r.cls),
      disabled: /(^|\s)payment-method-disabled(\s|$)/.test(r.cls)
    }));
  }

  /** Toca el método `index` (click real de WebdriverIO). `false` si no existe. NO es un CTA de confirmación. */
  async tapMethod(index: number): Promise<boolean> {
    const target = (await this.visibleElements(PAYMENT_LOCATORS.methods))[index];
    if (!target) return false;
    try {
      await target.click();
      return true;
    } catch {
      return false;
    }
  }

  /** Tarjetas visibles de la lista (`/cards`), en orden. */
  async readCards(): Promise<CardOption[]> {
    const items = await this.visibleElements(PAYMENT_LOCATORS.cardItems);
    const out: CardOption[] = [];
    for (const [index, el] of items.entries()) {
      const text = String(await el.getText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim();
      const { brand, last4 } = parseCardLabel(text.replace(/\(.*?\)/g, '').trim());
      out.push({ index, text, brand, last4, expired: /expir|vencid/i.test(text) });
    }
    return out;
  }

  /** Elige la tarjeta `index` de la lista (la app vuelve a `travel-info`). `false` si no existe. */
  async tapCard(index: number): Promise<boolean> {
    const target = (await this.visibleElements(PAYMENT_LOCATORS.cardItems))[index];
    if (!target) return false;
    try {
      await target.click();
      return true;
    } catch {
      return false;
    }
  }
}
