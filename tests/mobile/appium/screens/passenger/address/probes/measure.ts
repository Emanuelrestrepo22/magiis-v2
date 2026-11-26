/**
 * Utilidades PURAS compartidas por las probes: constantes del oráculo, lectura de parámetros de URL, sellos de
 * tiempo y armado del `ProbeResult`. Sin driver ni I/O.
 */

import type { BehaviorId, EvidenceLevel, Evaluation, ProbeResult } from './types.js';

/** Subconjunto de `WebViewNetworkCaptureRecord` que las probes necesitan. */
export type CapturedCall = {
  url: string;
  /** ISO-8601 sellado DENTRO del WebView por el hook de captura. */
  startedAt?: string;
  responseBody?: string;
};

/** Path del endpoint propio de autocompletado (MG-116, `GET places/autocomplete`). */
export const AUTOCOMPLETE_PATH = 'places/autocomplete';

export const GOOGLE_HOST_RE = /maps\.googleapis\.com|places\.googleapis\.com/i;

/**
 * Campos del `PredictionDTO` de `GET places/autocomplete` (contrato MX-5851 §7.3, medido en vivo el 2026-08-12 y
 * confirmado contra `MagiisAutocompletePrediction` de develop). El booleano viaja como `airport` (Lombok), NO
 * `isAirport` como nombra el AC de MG-116: se verifica contra el contrato real y se deja constancia.
 */
export const CONTRACT_FIELDS = [
  'placeId',
  'mainText',
  'secondaryText',
  'shortName',
  'latitude',
  'longitude',
  'airport',
  'iataCode',
  'source'
] as const;

/** AC MG-116 CA-04: debounce ~300 ms tras la última tecla. */
export const DEBOUNCE_TARGET_MS = 300;
/**
 * Hasta cuánto se acepta como «hay debounce». Es una tolerancia del HARNESS (no del AC): por encima se reporta FAIL
 * con el valor medido. No se ajusta a lo que hoy hace develop.
 */
export const DEBOUNCE_TOLERANCE_MS = 900;
/** AC MG-116: se consulta desde 3 caracteres (un código IATA mide 3). Perfil › Direcciones acordó 4 (2026-08-20). */
export const MIN_CHARS_TRIP_FLOW = 3;
export const MIN_CHARS_PROFILE = 4;

/** Espera tras tipear antes de leer la captura (ventana de AUSENCIA de requests; ver `autocompleteCapture.ts`). */
export const DEFAULT_SETTLE_MS = 4200;

/** Valor decodificado del parámetro `name` de una URL (`''` si no está). */
export function queryParam(url: string, name: string): string {
  const m = new RegExp(`[?&]${name}=([^&]*)`).exec(url);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1] ?? '');
  } catch {
    return m[1] ?? '';
  }
}

export function hasQueryParam(url: string, name: string): boolean {
  return new RegExp(`[?&]${name}=`).test(url);
}

/**
 * ISO -> epoch ms. El sello de la captura sale del reloj del WebView y el de la última pulsación también: restarlos
 * mide la ventana real del debounce. Restar contra el reloj de Node compararía relojes distintos (ruido).
 */
export function toEpochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function isAutocompleteUrl(url: string): boolean {
  return String(url).includes(AUTOCOMPLETE_PATH);
}

export function isGoogleUrl(url: string): boolean {
  return GOOGLE_HOST_RE.test(String(url));
}

export function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export type ProbeMeta = {
  behavior: BehaviorId;
  title: string;
  level?: EvidenceLevel;
  variant?: string;
};

/** Une la evaluación pura con su metadato y las mediciones para dejar el resultado auditable. */
export function toResult(
  meta: ProbeMeta,
  evaluation: Evaluation,
  measured: Record<string, unknown>
): ProbeResult {
  const level = meta.level ?? 'real-ui';
  return {
    behavior: meta.behavior,
    ...(meta.variant ? { variant: meta.variant } : {}),
    title: meta.title,
    level,
    reportableAsBug: level === 'real-ui',
    status: evaluation.status,
    detail: evaluation.detail,
    measured
  };
}
