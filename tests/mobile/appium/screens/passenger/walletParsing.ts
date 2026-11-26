/**
 * walletParsing — helpers PUROS (sin Appium) de la billetera del pasajero: etiquetas es/en, URL, fila de tarjeta
 * y textos de toast. Los usan `WalletScreen`, `WalletCardRowsScreen`, `WalletCardFormScreen` y el PBO.
 *
 * Textos relevados de `magiis-mobile-passenger-v2@develop` (`src/assets/i18n/{es,en}.json`), pendientes de validar
 * en vivo: `menu.label_cards` («Billetera» / «Wallet»), `cards.add` («Agregar» / «Add payment method», se muestra en
 * mayúsculas por `| uppercase`), `credit_card.save_card` («Guardar» / «Save»), `cards.add_card_success`,
 * `cards.remove_card_success_1/2`.
 */

import { normalizeForMatch } from './LoginScreen.js';

/** Una fila de tarjeta tal como la muestra `cards.page.html` (`ion-item.card-item`). */
export type WalletCardRow = {
  /** Posición entre las filas visibles (orden del DOM). */
  index: number;
  /** Texto de `span.card-item-label` (p. ej. «VISA ...4242»). */
  label: string;
  brand: string;
  last4: string;
  /** Muestra la estrella de «Principal» junto a la marca (`ion-icon[name="star"]` dentro de `.card-data .type`). */
  isDefault: boolean;
  /** Muestra «(Vencida)» / «(Expired)». */
  expired: boolean;
};

export const WALLET_MENU_LABELS = ['billetera', 'wallet'] as const;
export const ADD_CARD_LABELS = ['agregar', 'add payment method'] as const;
export const SAVE_CARD_LABELS = ['guardar', 'save'] as const;

const matches = (labels: readonly string[], text: string): boolean =>
  labels.includes(normalizeForMatch(text));

export const isWalletMenuLabel = (text: string): boolean => matches(WALLET_MENU_LABELS, text);
export const isAddCardLabel = (text: string): boolean => matches(ADD_CARD_LABELS, text);
export const isSaveCardLabel = (text: string): boolean => matches(SAVE_CARD_LABELS, text);

/** Ruta de la billetera: `/cards` (menú lateral `menu.label_cards`). */
export const isWalletUrl = (url: string): boolean => /\/cards(?:[/?#;]|$)/i.test(url);

/** Últimos 4 dígitos de un valor (acepta «VISA ...4242», «4242», un PAN completo). `null` si hay menos de 4 dígitos. */
export function last4Of(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Parte la etiqueta «VISA ...4242» en marca + last4. `null` si no termina en 4 dígitos. */
export function parseCardLabel(label: string): { brand: string; last4: string } | null {
  const text = label.replace(/\s+/g, ' ').trim();
  const m = /^(.*?)[\s.*•·]*(\d{4})$/.exec(text);
  if (!m) return null;
  return { brand: (m[1] ?? '').trim().toUpperCase(), last4: m[2]! };
}

/** Toast de alta correcta (`cards.add_card_success`). */
export function isAddSuccessText(text: string): boolean {
  const t = normalizeForMatch(text);
  return t.includes('se anadio su tarjeta') || t.includes('credit card was successfully added');
}

/**
 * Toast de baja correcta (`cards.remove_card_success_1` + «MARCA ...1234» + `_2`): devuelve el last4 citado o
 * `null` si el texto no es un aviso de baja.
 */
export function parseRemovalToast(text: string): string | null {
  const m = /(\d{4}) (?:ha sido eliminado|has been removed)/.exec(normalizeForMatch(text));
  return m ? m[1]! : null;
}

/** Last4 ordenados (multiconjunto) de una lista de filas: sirve para comparar «las demás tarjetas no cambiaron». */
export function last4Multiset(rows: readonly Pick<WalletCardRow, 'last4'>[]): string[] {
  return rows.map((r) => r.last4).sort();
}

export function sameLast4Multiset(
  a: readonly Pick<WalletCardRow, 'last4'>[],
  b: readonly Pick<WalletCardRow, 'last4'>[]
): boolean {
  const x = last4Multiset(a);
  const y = last4Multiset(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
