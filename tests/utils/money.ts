// tests/utils/money.ts
// Parser de importes leidos de la UI del portal (formato US y AR) y redondeo a 2 decimales.
// El portal formatea con `currencySymbolFormat` usando los separadores del locale del carrier:
// UAT carrier 1481 (USD) muestra «$ 1,234.56»; un carrier AR muestra «$ 1.234,56»
// (docs/analysis/migration-evidence/new-trip-other-costs-2026-09-29.md §6, punto 7).

/**
 * Convierte un importe de pantalla a number.
 *
 * Regla del separador decimal: el ULTIMO `.` o `,` es decimal solo si lo siguen exactamente
 * dos digitos al final del numero (el portal siempre muestra 2 decimales). Cualquier otro
 * separador se toma como separador de miles.
 *
 * Ejemplos: «$ 1,234.56» → 1234.56 · «$ 1.234,56» → 1234.56 · «-$ 5.00» → -5 ·
 * «$ -5.00» → -5 · «$ 1,234» → 1234 · «25» → 25.
 *
 * Lanza un Error si el texto no contiene un importe reconocible (nunca devuelve NaN).
 */
export function parseMoney(text: string): number {
  const raw = text.trim();
  const negative = /-/.test(raw);
  // Solo digitos y separadores: descarta simbolo de moneda, espacios, signo y texto.
  const body = raw.replace(/[^0-9.,]/g, '');
  if (!/\d/.test(body)) {
    throw new Error(`parseMoney: no se reconoce un importe en «${text}»`);
  }

  const lastSeparator = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  let integerPart = body;
  let decimalPart = '';
  if (lastSeparator >= 0 && /^\d{2}$/.test(body.slice(lastSeparator + 1))) {
    integerPart = body.slice(0, lastSeparator);
    decimalPart = body.slice(lastSeparator + 1);
  }

  // Los separadores de miles restantes deben agrupar de a 3 digitos («1,234,567»); un grupo
  // de otro largo («1.5», «12,34,5») es ambiguo y se rechaza en lugar de adivinar.
  const groups = integerPart.split(/[.,]/);
  if (groups.length > 1 && (groups[0] === '' || groups.slice(1).some((g) => g.length !== 3))) {
    throw new Error(`parseMoney: separadores ambiguos en «${text}»`);
  }
  const digits = groups.join('');
  if (!/^\d*$/.test(digits) || (digits === '' && decimalPart === '')) {
    throw new Error(`parseMoney: importe mal formado en «${text}»`);
  }

  const value = Number(`${digits || '0'}${decimalPart ? `.${decimalPart}` : ''}`);
  return negative ? -value : value;
}

/**
 * Redondea a 2 decimales, mitad hacia arriba en valor absoluto (1.005 → 1.01, -1.005 → -1.01).
 * El `Number.EPSILON` corrige la representacion binaria (1.005 * 100 = 100.49999…).
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`round2: valor no finito (${value})`);
  }
  const sign = value < 0 ? -1 : 1;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return rounded === 0 ? 0 : sign * rounded;
}
