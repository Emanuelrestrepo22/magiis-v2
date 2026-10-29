// tests/utils/units.ts
// Utilidad AGNÓSTICA de unidades de distancia (MG-1189: métrico/imperial). Sin Playwright ni
// dependencias del repo: se prueba con `npx tsx --test tests/utils/units.unit.ts`.
//
// Contrato de la épica: el backend sigue entregando kilómetros; el front convierte a millas
// cuando el carrier es imperial (1 mi = 1,60934 km). Estas funciones son el oráculo de los specs:
// el crudo en km que el propio front pide es la entrada, la pantalla es la salida.

/** Factor de conversión del producto (MG-1190): 1 milla = 1,60934 km. */
export const KM_PER_MILE = 1.60934;

/** Tolerancia por defecto al comparar un valor mostrado (2 decimales) con el esperado. */
export const DISPLAY_TOLERANCE = 0.01;

export type DistanceUnit = 'Mi' | 'km';
export type UnitSystem = 'imperial' | 'metric';

export interface DistanceReading {
  value: number;
  unit: DistanceUnit;
}

/** Redondea half-up a `decimals` decimales (evita el `toFixed` binario de 1.005). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Convierte kilómetros a millas con el factor del producto. */
export function kmToMiles(km: number, decimals = 2): number {
  return roundTo(km / KM_PER_MILE, decimals);
}

/** Rótulo de unidad que debe mostrar la pantalla para cada sistema. */
export function unitLabel(system: UnitSystem): DistanceUnit {
  return system === 'imperial' ? 'Mi' : 'km';
}

/**
 * Valor esperado en pantalla a partir del crudo en km: millas convertidas (imperial) o el
 * mismo crudo redondeado (métrico).
 */
export function expectedDistance(rawKm: number, system: UnitSystem, decimals = 2): number {
  return system === 'imperial' ? kmToMiles(rawKm, decimals) : roundTo(rawKm, decimals);
}

/**
 * Parsea un número tal como lo imprime la UI, en formato en-US (`1,234.56`) o es-AR
 * (`1.234,56`). Si aparecen ambos separadores, el último es el decimal. Con uno solo:
 * repetido ⇒ miles; único ⇒ decimal, salvo `1,234` / `1.234` (exactamente 3 dígitos tras el
 * separador), que es ambiguo y se resuelve con `hint` (el separador decimal del locale).
 * Sin `hint`, un único `,` + 3 dígitos se toma como miles y un único `.` + 3 dígitos como
 * decimal (el formato en-US y el que usa el carrier imperial).
 */
export function parseLocalizedNumber(text: string, hint?: '.' | ','): number {
  const raw = text.replace(/[\s ]/g, '');
  if (!/^-?[\d.,]+$/.test(raw) || !/\d/.test(raw)) return Number.NaN;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let decimal: '.' | ',' | null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimal = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep: '.' | ',' = lastDot >= 0 ? '.' : ',';
    const occurrences = raw.split(sep).length - 1;
    const digitsAfter = raw.length - raw.lastIndexOf(sep) - 1;
    if (occurrences > 1) decimal = null;
    else if (digitsAfter === 3 && hint !== undefined) decimal = hint === sep ? sep : null;
    else if (digitsAfter === 3) decimal = sep === '.' ? '.' : null;
    else decimal = sep;
  } else {
    decimal = null;
  }
  let normalized: string;
  if (decimal === '.') normalized = raw.replace(/,/g, '');
  else if (decimal === ',') normalized = raw.replace(/\./g, '').replace(',', '.');
  else normalized = raw.replace(/[.,]/g, '');
  return Number(normalized);
}

// Número + rótulo de unidad con borde de palabra: «Mi» no debe confundirse con «Min» / «min».
const DISTANCE_PATTERN = /(-?\d[\d.,]*)[\s ]*(Mi|km|Km)(?![A-Za-z])/;

/** Primera lectura «número + unidad» de un texto, o `null` si no hay ninguna. */
export function parseDistance(text: string, hint?: '.' | ','): DistanceReading | null {
  const match = DISTANCE_PATTERN.exec(text);
  if (!match) return null;
  const value = parseLocalizedNumber(match[1], hint);
  if (Number.isNaN(value)) return null;
  return { value, unit: match[2] === 'Mi' ? 'Mi' : 'km' };
}

/** ¿El texto contiene el rótulo de esa unidad con borde de palabra («Mi» ≠ «min»)? */
export function containsUnit(text: string, unit: DistanceUnit): boolean {
  return unit === 'Mi'
    ? /(?<![A-Za-z])Mi(?![A-Za-z])/.test(text)
    : /(?<![A-Za-z])km(?![A-Za-z])/i.test(text);
}

/** ¿`actual` coincide con `expected` dentro de la tolerancia de visualización? */
export function isWithin(actual: number, expected: number, tolerance = DISPLAY_TOLERANCE): boolean {
  return Math.abs(actual - expected) <= tolerance + 1e-9;
}
