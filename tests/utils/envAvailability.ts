// tests/utils/envAvailability.ts
// Disponibilidad del ambiente: distingue "el servidor no respondio" de "el test fallo".
//
// Origen: corrida TM-1361 del 2026-10-06 en TEST. TC162/TC163 (Destino Abierto) fallaron en el
// primer intento con `page.goto: net::ERR_TIMED_OUT` en /carrier/#/travel/create y pasaron en el
// reintento; en aislamiento pasaron 8/8 (2026-10-08). El fallo era del ambiente, pero quedaba
// registrado como "flaky" del test. Este modulo es la pieza comun de la capa 1 del plan de
// remediacion: gate en global-setup, reintento acotado en BasePage y clasificacion en el reporter.
//
// Sin dependencias de Playwright para que los unit tests corran con node:test.

/** Variable que global-setup deja en '1' cuando el ambiente no respondio (la lee el reporter). */
export const ENV_DOWN_FLAG = 'MAGIIS_ENVIRONMENT_DOWN';

/** Annotation que BasePage agrega cuando reintento la navegacion inicial por un error de red. */
export const ENV_RETRY_ANNOTATION = 'env-retry';

/** Annotation que NewTripPage.goto() agrega cuando extiende el timeout por carga lenta del front. */
export const ENV_SLOW_LOAD_ANNOTATION = 'env-slow-load';

/**
 * Carga "normal" de New Trip (techo del regimen normal, ~5-10 s segun H-03: el front de TEST es un
 * build de desarrollo y tarda 19-30 s). Solo el exceso sobre este valor se compensa en el timeout.
 */
export const ENV_NORMAL_LOAD_MS = 10_000;

/** Formatea la medicion y la compensacion para la annotation `env-slow-load` (informativa). */
export function formatSlowLoadDescription(loadMs: number, addedMs: number): string {
  return `Nuevo Viaje tardo ${Math.round(loadMs / 1000)}s en quedar listo; timeout del test extendido ${Math.round(addedMs / 1000)}s (exceso sobre ${ENV_NORMAL_LOAD_MS / 1000}s) [loadMs=${Math.round(loadMs)}]`;
}

/** Marca de clasificacion que el reporter escribe en el comment del run. */
export const ENV_FLAKY_LABEL = 'env-flaky';

// Errores de Chromium que indican que el servidor (o la red) no respondio. No incluye errores de
// certificado ni respuestas HTTP: esos son fallas reales que no deben reintentarse.
const NETWORK_ERROR =
  /net::ERR_(TIMED_OUT|CONNECTION_(?:TIMED_OUT|REFUSED|RESET|CLOSED|ABORTED|FAILED)|NAME_NOT_RESOLVED|NETWORK_CHANGED|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|EMPTY_RESPONSE)/;

/** Codigo `net::ERR_*` del mensaje, o null si el error no es de red. */
export function networkErrorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  const match = NETWORK_ERROR.exec(message);
  return match ? `net::ERR_${match[1]}` : null;
}

/**
 * True si el error es una navegacion (`page.goto`) que no obtuvo respuesta del servidor.
 * Un timeout de asercion o de locator NO califica: eso si es una falla del test o del producto.
 */
export function isNavigationNetworkError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /page\.goto:/.test(message) && networkErrorCode(message) !== null;
}

/** Error que global-setup lanza cuando el ambiente no respondio al gate. */
export class EnvironmentUnavailableError extends Error {
  readonly code = 'ENVIRONMENT_DOWN';

  constructor(
    readonly baseURL: string,
    readonly attempts: ProbeAttempt[]
  ) {
    const last = attempts[attempts.length - 1];
    super(
      `[ENVIRONMENT_DOWN] ${baseURL} no respondio tras ${attempts.length} intento(s)` +
        (last ? ` (ultimo: ${last.url} -> ${last.outcome})` : '') +
        '. No se corre la suite ni se publica nada en Xray: reintentar cuando el ambiente vuelva.'
    );
    this.name = 'EnvironmentUnavailableError';
  }
}

export interface ProbeAttempt {
  attempt: number;
  url: string;
  /** 'HTTP 200', 'HTTP 503', 'timeout 15000ms', 'error: <mensaje>' */
  outcome: string;
  ok: boolean;
}

export interface ProbeOptions {
  /** URLs que deben responder; se considera disponible si TODAS responden con status < 500. */
  urls: string[];
  /** Esperas antes de cada intento; la longitud define la cantidad de intentos. */
  backoffMs?: number[];
  /** Timeout por request. */
  timeoutMs?: number;
  /** Inyectables para unit tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProbeResult {
  ok: boolean;
  attempts: ProbeAttempt[];
}

const DEFAULT_BACKOFF_MS = [0, 5_000, 15_000, 30_000];
const DEFAULT_TIMEOUT_MS = 15_000;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function probeOnce(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ ok: boolean; outcome: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // GET sin credenciales: el gate no autentica, solo comprueba que el servidor contesta.
    // Un 401/403/404 cuenta como "responde" (el servidor esta arriba); solo >= 500 o la falta de
    // respuesta cuentan como caido.
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    return { ok: response.status < 500, outcome: `HTTP ${response.status}` };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, outcome: `timeout ${timeoutMs}ms` };
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, outcome: `error: ${message.split('\n')[0]}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sondea las URLs con reintentos y backoff. Devuelve en cuanto un intento encuentra todas las
 * URLs disponibles. No lanza: el que llama decide (global-setup lanza EnvironmentUnavailableError).
 */
export async function probeEnvironment(options: ProbeOptions): Promise<ProbeResult> {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const attempts: ProbeAttempt[] = [];

  for (let i = 0; i < backoff.length; i++) {
    if (backoff[i] > 0) await sleep(backoff[i]);
    let allOk = true;
    for (const url of options.urls) {
      const { ok, outcome } = await probeOnce(url, timeoutMs, fetchImpl);
      attempts.push({ attempt: i + 1, url, outcome, ok });
      if (!ok) {
        allOk = false;
        break;
      }
    }
    if (allOk) return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

/** URLs que el gate sondea para un BASE_URL: el shell del carrier V2 y el endpoint de version. */
export function availabilityUrls(baseURL: string, apiPrefix = 'magiis-v0.2'): string[] {
  const origin = new URL(baseURL).origin;
  return [`${origin}/carrier/`, `${origin}/${apiPrefix}/config/serverInfo`];
}
