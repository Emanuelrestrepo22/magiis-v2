/**
 * AvailabilityFaults — ramas de error del cambio de disponibilidad (`#availability`) del Driver por inyección
 * de fallas en el WebView (`core/WebViewFaultInjection`): la request de estado recibe una respuesta HTTP
 * sintética sin tocar el backend, así que el estado real del chofer NO cambia por la prueba.
 *
 * Ramas (docs/mobile/driver-app-flow-map.md, flujo «Toggle Disponible / No disponible»): errores 400 / 428 / 409
 * -> modales de la app. El texto de cada modal NO está catalogado: se lee en vivo y se registra como observación.
 *
 * ENDPOINT: `setFromAppDriverStatus` sale del script de diagnóstico en cuarentena
 * (`scripts/_quarantine/driver-availability-hang-repro.ts`, «p. ej.») y NO está confirmado contra tráfico real.
 * El spec lo confirma antes de afirmar nada: el test del toggle exitoso exige ver ≥1 request que lo contenga con
 * status 2xx, y cada rama exige que la regla haya hecho match (si no, falla con un mensaje explícito en vez de
 * pasar en falso). Si el endpoint real difiere, se corrige SOLO esta constante.
 */

import type {
  WebViewFaultInjectionRule,
  WebViewNetworkCaptureRecord
} from '../core/WebViewNetworkCaptureTypes.js';

export const AVAILABILITY_ENDPOINT_PATTERN = 'setFromAppDriverStatus';

export type AvailabilityErrorBranch = { status: 400 | 428 | 409; meaning: string };

/** Ramas a cubrir; `meaning` es solo descriptivo (el significado exacto de negocio lo define el backend). */
export const AVAILABILITY_ERROR_BRANCHES: readonly AvailabilityErrorBranch[] = [
  { status: 400, meaning: 'solicitud inválida' },
  { status: 428, meaning: 'precondición requerida' },
  { status: 409, meaning: 'conflicto de estado' }
];

export function availabilityRuleId(status: number): string {
  return `availability-http-${status}`;
}

/** Regla de inyección de UNA falla HTTP (`times: 1`) sobre la request de estado. Estado fuera de 400-599 = error. */
export function buildAvailabilityFaultRule(
  status: number,
  pattern: string = AVAILABILITY_ENDPOINT_PATTERN
): WebViewFaultInjectionRule {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new Error(`buildAvailabilityFaultRule: status ${status} no es un error HTTP (400-599).`);
  }
  if (!pattern.trim())
    throw new Error('buildAvailabilityFaultRule: el patrón de endpoint no puede estar vacío.');
  return {
    id: availabilityRuleId(status),
    urlPattern: pattern,
    mode: 'status',
    status,
    contentType: 'application/json',
    body: JSON.stringify({ injected: true, reason: `availability error branch ${status}` }),
    times: 1
  };
}

/** Requests del capture cuyo URL contiene el patrón (no las inyectadas salvo `includeInjected`). */
export function findAvailabilityRequests(
  entries: readonly WebViewNetworkCaptureRecord[],
  options: { pattern?: string; includeInjected?: boolean } = {}
): WebViewNetworkCaptureRecord[] {
  const pattern = options.pattern ?? AVAILABILITY_ENDPOINT_PATTERN;
  return entries.filter(
    (e) => e.url.includes(pattern) && (options.includeInjected === true || !e.injected)
  );
}

/** true si alguna de esas requests terminó con 2xx. */
export function anySucceeded(entries: readonly WebViewNetworkCaptureRecord[]): boolean {
  return entries.some((e) => typeof e.status === 'number' && e.status >= 200 && e.status < 300);
}

/** `<último tramo del path>` sin query ni host, para listar endpoints vistos sin exponer tokens ni ids. */
export function endpointTail(url: string): string {
  const path = url.split('?')[0] ?? url;
  return path.split('/').filter(Boolean).slice(-2).join('/');
}

/** Resumen `método status tail` (sin query, sin headers, sin cuerpos) de las requests del capture. */
export function summarizeRequests(
  entries: readonly WebViewNetworkCaptureRecord[],
  limit = 15
): string[] {
  return entries
    .slice(0, limit)
    .map(
      (e) =>
        `${e.method} ${e.status ?? '-'} ${endpointTail(e.url)}${e.injected ? ' [inyectada]' : ''}`
    );
}
