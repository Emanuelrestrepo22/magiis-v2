/**
 * Interpretación de montos visibles en la app (puro, sin Appium). Portado de V1 `contracts/f5AppHandoff.ts`.
 */

/**
 * Interpreta un monto visible de la app. Admite `$1,645.00`, `1.645,00 €`, `1 645,00`, `€ 12,5`.
 * El separador decimal es el ÚLTIMO `.` o `,` seguido de 1-2 dígitos; el resto son miles.
 * Devuelve `null` si no hay un número claro.
 */
export function parseMoneyText(text: string): number | null {
  const m = text.replace(/[  ]/g, ' ').match(/-?\d[\d.,\s]*/);
  if (!m) return null;
  let s = m[0].trim().replace(/\s+/g, '');
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let decimals = '';
  if (lastSep >= 0 && /^\d{1,2}$/.test(s.slice(lastSep + 1))) {
    decimals = s.slice(lastSep + 1);
    s = s.slice(0, lastSep);
  }
  const intPart = s.replace(/[.,]/g, '');
  if (!/^-?\d+$/.test(intPart)) return null;
  const n = Number(decimals ? `${intPart}.${decimals}` : intPart);
  return Number.isFinite(n) ? n : null;
}
