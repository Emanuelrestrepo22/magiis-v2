// tests/helpers/network-guard.ts
// Guarda de red de la PREPARACION de datos del circuito administrativo (plan
// docs/qa/f5-admin-circuit-multicarrier-plan.md D8). Allowlist + denylist de escrituras sobre el backend MAGIIS:
// - `allowed`: lo que el flujo de alta/cierre administrativo SI puede escribir.
// - `forbidden`: lo que NUNCA debe tocar (rendir, liquidar, autodispatch, editar propietario, DELETE): se ABORTA.
// - `unknown`: cualquier otra escritura: tambien se aborta y hace fallar el test (descubre endpoints nuevos sin
//   dejarlos pasar). GET/OPTIONS/HEAD y hosts que no son del backend MAGIIS son libres.
// `classifyWrite` es puro (unitarios); `installWriteGuard` lo instala en un contexto de Playwright y deja un log de
// metodo + ruta SIN query, headers ni cuerpos (nada de credenciales ni PII).
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserContext } from '@playwright/test';

export type WriteClass = 'free' | 'allowed' | 'forbidden' | 'unknown';

type Rule = { method: RegExp; path: RegExp };
const ANY = /^.*$/;

/** Escrituras prohibidas en la preparacion (lista portada del runner ad hoc del 10/11 + todo DELETE). */
const FORBIDDEN: readonly Rule[] = [
  { method: /^DELETE$/, path: ANY },
  { method: /^POST$/, path: /\/toTravelsSurrender$/i },
  { method: /^(PUT|POST)$/, path: /\/travelsSurrender$/i },
  { method: ANY, path: /\/vehicleOwners(\/|$)/i },
  { method: ANY, path: /\/carrierDriverLiquidations(\/|$)/i },
  { method: ANY, path: /\/carrierOwnerLiquidations(\/|$)/i },
  { method: /^(POST|PUT)$/, path: /autoDispatch/i }
];

/** Escrituras de NEGOCIO que el flujo de preparacion necesita (alta, cierre administrativo, tarifa final). */
const ALLOWED_BUSINESS: readonly Rule[] = [
  { method: /^POST$/, path: /\/carriers\/\d+\/travels$/ },
  { method: /^PUT$/, path: /\/travels\/\d+\/cancel$/ },
  { method: /^POST$/, path: /\/travels\/\d+\/finalizeAdmin$/ },
  { method: /^PUT$/, path: /\/travels\/\d+\/audit$/ },
  { method: /^PUT$/, path: /\/travels\/\d+\/updateFinalPrices$/ },
  { method: /^POST$/, path: /\/travels\/\d+\/updateFinalPricesProcess$/ },
  { method: /^PUT$/, path: /\/travels\/\d+\/notes$/ }
];

/** POST de solo lectura que dispara la propia pantalla (cotizacion, busquedas, grillas): no cuentan como escritura. */
const ALLOWED_READ_POSTS: readonly Rule[] = [
  { method: /^POST$/, path: /\/carriers\/\d+\/paymentMethodsByPax$/ },
  { method: /^POST$/, path: /\/carriers\/\d+\/travels\/simulate(All)?$/ },
  { method: /^POST$/, path: /\/otherCosts\/search$/ },
  { method: /^POST$/, path: /\/data\/genericReport\/[^/]+\/paginated$/ },
  { method: /^POST$/, path: /\/users\/searchEmailExists\/?$/ },
  { method: /^POST$/, path: /\/usertrail\/register$/ }
];

const MAGIIS_HOST = /magiis/i;

function matches(rules: readonly Rule[], method: string, path: string): boolean {
  return rules.some((r) => r.method.test(method) && r.path.test(path));
}

/** Clasifica una peticion: ver `WriteClass`. Solo mira metodo y ruta (la query nunca interviene). */
export function classifyWrite(method: string, url: string): WriteClass {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'OPTIONS' || m === 'HEAD') return 'free';
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    path = url.split('?')[0];
  }
  if (host && !MAGIIS_HOST.test(host)) return 'free';
  if (matches(FORBIDDEN, m, path)) return 'forbidden';
  if (matches(ALLOWED_BUSINESS, m, path) || matches(ALLOWED_READ_POSTS, m, path)) return 'allowed';
  return 'unknown';
}

/** true si la peticion es una escritura de NEGOCIO permitida (no un POST de lectura de la pantalla). */
export function isBusinessWrite(method: string, url: string): boolean {
  let path = url.split('?')[0];
  try {
    path = new URL(url).pathname;
  } catch {
    // ruta relativa
  }
  return matches(ALLOWED_BUSINESS, method.toUpperCase(), path);
}

/** Linea de log sin query ni credenciales: `<ISO> <CLASE> <METODO> <ruta>`. */
export function formatGuardLine(at: Date, klass: WriteClass, method: string, url: string): string {
  let path = url.split('?')[0];
  try {
    path = new URL(url).pathname;
  } catch {
    // url relativa: se conserva tal cual (sin query)
  }
  return `${at.toISOString()} ${klass.toUpperCase()} ${method.toUpperCase()} ${path}`;
}

export type GuardEvent = {
  klass: WriteClass;
  method: string;
  path: string;
  /** Escritura de negocio permitida (alta, cancelar, cierre, tarifa final), no un POST de lectura. */
  business: boolean;
};

export type WriteGuard = {
  /** Escrituras observadas (no incluye lecturas). */
  events(): readonly GuardEvent[];
  forbidden(): readonly GuardEvent[];
  unknown(): readonly GuardEvent[];
  /** Cantidad de escrituras permitidas efectivamente enviadas (incluye POST de lectura). */
  allowedCount(): number;
  /** Escrituras de NEGOCIO enviadas (0 en una verificacion de solo lectura). */
  businessWrites(): readonly GuardEvent[];
};

/**
 * Instala la guarda en un contexto (todas sus paginas). `forbidden` y `unknown` se abortan (`blockedbyclient`) y
 * quedan registradas; el spec debe asertar `forbidden().length === 0 && unknown().length === 0` al final.
 * `logPath` (opcional): archivo de log append-only (se crea la carpeta).
 */
export async function installWriteGuard(
  context: BrowserContext,
  opts: { logPath?: string } = {}
): Promise<WriteGuard> {
  const events: GuardEvent[] = [];
  if (opts.logPath) mkdirSync(dirname(opts.logPath), { recursive: true });
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    const klass = classifyWrite(method, url);
    if (klass === 'free') {
      await route.continue();
      return;
    }
    let path = url.split('?')[0];
    try {
      path = new URL(url).pathname;
    } catch {
      // se conserva la ruta sin query
    }
    events.push({
      klass,
      method: method.toUpperCase(),
      path,
      business: klass === 'allowed' && isBusinessWrite(method, url)
    });
    if (opts.logPath) {
      appendFileSync(opts.logPath, `${formatGuardLine(new Date(), klass, method, url)}\n`, 'utf-8');
    }
    if (klass === 'allowed') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  return {
    events: () => events,
    forbidden: () => events.filter((e) => e.klass === 'forbidden'),
    unknown: () => events.filter((e) => e.klass === 'unknown'),
    allowedCount: () => events.filter((e) => e.klass === 'allowed').length,
    businessWrites: () => events.filter((e) => e.business)
  };
}
