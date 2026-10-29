// tests/api/clients/carrierSession.ts
// Sesion API del carrier a partir del storageState guardado (FW-008, precondiciones via API).
// NUNCA hace login con contrasena: si la sesion guardada no sirve, se detiene y lo dice.
// NUNCA expone el token: vive en un campo privado (#token), no sale en toJSON/inspect ni en
// mensajes de error (ver redactApiText).
//
// Fuente del contrato (front v2.0.17, repo magiis-fe-carrier-v2, rutas relativas a src/app/):
// - localStorage 'carrier-<indice StorageKeyEnum>': services/storage/storageKeyEnum.enum.ts
//   (sessionToken = 0, userId = 12, subUserId = 28, userInfoCarrier = 49) y
//   services/session/session.service.ts:10-12 (prefijo 'carrier-').
// - Header: services/authentication/connection/connection.service.ts:262-266
//   (`Authorization: Bearer <sessionToken>`).
// - carrierId de los comandos = identityService.userId (settings-otherCosts.component.ts:210-212).
// - Base de la API: environments/environment.uat.ts:4 (`https://apps-uat.magiis.com/magiis-v0.2/`).
import { existsSync, readFileSync } from 'node:fs';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  getCurrentEnv,
  getStorageStatePath,
  resolveBaseURL,
  type AppEnv
} from '../../config/runtime.js';
import { redactSensitiveText } from '../../utils/redact.js';

const KEY_SESSION_TOKEN = 'carrier-0';
const KEY_USER_ID = 'carrier-12';
const KEY_SUB_USER_ID = 'carrier-28';
// StorageKeyEnum (front v2.0.17, services/storage/storageKeyEnum.enum.ts): userRol=9, subUserName=42.
const KEY_USER_ROL = 'carrier-9';
const KEY_SUB_USER_NAME = 'carrier-42';
const KEY_USER_INFO_CARRIER = 'carrier-49';

const DEFAULT_API_PREFIX = 'magiis-v0.2';
/**
 * Vigencia minima del token para arrancar una suite que crea datos (familia Otros Costos: 8
 * tests de hasta 240 s + limpieza). La usan el guard de global-setup y el fixture de sesion:
 * un token que vence a mitad de camino deja viajes y conceptos sin limpiar.
 */
export const SUITE_MIN_SESSION_VALIDITY_MS = 20 * 60_000;
const MAX_ERROR_BODY_CHARS = 500;

/** Mensaje comun para toda sesion inutilizable: el agente no regenera sesiones. */
const REGENERATE_HINT =
  'la regenera un humano con `npm run test:<env>`; el agente no hace login con contrasena';

/** La API rechazo la sesion guardada (401/403): STOP, no reintentar ni hacer login. */
export class SessionRejectedError extends Error {
  constructor(label: string, status: number) {
    super(
      `[carrierSession] ${label} respondio ${status}: sesion rechazada por el servidor; ${REGENERATE_HINT}`
    );
    this.name = 'SessionRejectedError';
  }
}

/**
 * El servidor respondio un status no-2xx distinto de 401/403. Lleva el `status` para que el
 * llamador distinga un rechazo de negocio (4xx de validacion) de una falla de infraestructura.
 * El mensaje ya viene redactado.
 */
export class ApiStatusError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiStatusError';
  }
}

/**
 * Tacha tokens de un texto antes de loguearlo o adjuntarlo. Delega los headers sensibles
 * (call log de Playwright, headers serializados) al helper unico tests/utils/redact.ts y
 * ademas tacha `Bearer …` y JWT sueltos (p. ej. un token devuelto en el cuerpo de un error).
 */
export function redactApiText(text: string): string {
  return redactSensitiveText(text);
}

type StorageStateFile = {
  origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
};

export type LoadCarrierSessionOptions = {
  env?: AppEnv;
  storageStatePath?: string;
  baseURL?: string;
  apiPrefix?: string;
  /** Margen minimo de vigencia del JWT, en ms (default 0: solo que no este vencido). */
  minValidityMs?: number;
};

export class CarrierSession {
  readonly #token: string;

  constructor(
    readonly env: AppEnv,
    readonly carrierId: number,
    readonly subUserId: number,
    readonly tokenExpiresAt: Date,
    readonly apiBaseURL: string,
    token: string,
    /** Rol del usuario logueado sin prefijo `ROLE_` (lo que el front manda como `canceledBy`). */
    readonly role: string,
    /** Nombre del sub-usuario (PII: no va en toJSON ni en logs). */
    readonly subUserName: string
  ) {
    this.#token = token;
  }

  /** Headers para un request autenticado. No loguear el resultado. */
  authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' };
  }

  /**
   * Crea un APIRequestContext con baseURL de la API y el Bearer de la sesion.
   * Recibe la fabrica `request` (fixture `playwright.request` o `import { request }`).
   */
  async newApiContext(factory: {
    newContext: (options: {
      baseURL: string;
      extraHTTPHeaders: Record<string, string>;
    }) => Promise<APIRequestContext>;
  }): Promise<APIRequestContext> {
    return factory.newContext({ baseURL: this.apiBaseURL, extraHTTPHeaders: this.authHeaders() });
  }

  /** Vista segura para logs/evidencia: sin token. */
  toJSON(): Record<string, unknown> {
    return {
      env: this.env,
      carrierId: this.carrierId,
      subUserId: this.subUserId,
      tokenExpiresAt: this.tokenExpiresAt.toISOString(),
      apiBaseURL: this.apiBaseURL
    };
  }
}

function readLocalStorageItem(
  items: Array<{ name: string; value: string }>,
  key: string,
  path: string
): string {
  const value = items.find((item) => item.name === key)?.value;
  if (!value) {
    throw new Error(`[carrierSession] falta la clave ${key} en ${path}; ${REGENERATE_HINT}`);
  }
  return value;
}

function parsePositiveInt(raw: string, key: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[carrierSession] la clave ${key} no es un id numerico valido`);
  }
  return value;
}

/** Lee `exp` del payload del JWT sin validar firma (solo para decidir si sigue vigente). */
function readJwtExpiry(token: string): Date {
  const payload = token.split('.')[1];
  if (!payload) {
    throw new Error(`[carrierSession] el token guardado no tiene forma de JWT; ${REGENERATE_HINT}`);
  }
  let exp: unknown;
  try {
    exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
  } catch {
    throw new Error(
      `[carrierSession] no se pudo decodificar el payload del token; ${REGENERATE_HINT}`
    );
  }
  if (typeof exp !== 'number') {
    throw new Error(`[carrierSession] el token guardado no trae exp; ${REGENERATE_HINT}`);
  }
  return new Date(exp * 1000);
}

/**
 * Carga la sesion del carrier desde `storage/state-carrier-<env>.json`.
 * Falla (sin imprimir valores) si el archivo falta, el origin no coincide con BASE_URL,
 * faltan claves, los ids no cuadran o el JWT esta vencido.
 */
export function loadCarrierSession(options: LoadCarrierSessionOptions = {}): CarrierSession {
  const env = options.env ?? getCurrentEnv();
  const path = options.storageStatePath ?? getStorageStatePath(env);
  const baseURL = options.baseURL ?? resolveBaseURL();
  const apiPrefix =
    (options.apiPrefix ?? process.env.MAGIIS_API_PREFIX?.trim()) || DEFAULT_API_PREFIX;
  const minValidityMs = options.minValidityMs ?? 0;

  if (!existsSync(path)) {
    throw new Error(`[carrierSession] no existe ${path}: sesion ausente; ${REGENERATE_HINT}`);
  }
  const state = JSON.parse(readFileSync(path, 'utf8')) as StorageStateFile;
  const expectedOrigin = new URL(baseURL).origin;
  const origin = state.origins?.find((o) => o.origin === expectedOrigin);
  if (!origin) {
    throw new Error(
      `[carrierSession] ${path} no tiene localStorage para ${expectedOrigin} (BASE_URL del env ${env}); ${REGENERATE_HINT}`
    );
  }

  const token = readLocalStorageItem(origin.localStorage, KEY_SESSION_TOKEN, path);
  const carrierId = parsePositiveInt(
    readLocalStorageItem(origin.localStorage, KEY_USER_ID, path),
    KEY_USER_ID
  );
  const subUserId = parsePositiveInt(
    readLocalStorageItem(origin.localStorage, KEY_SUB_USER_ID, path),
    KEY_SUB_USER_ID
  );

  // Control cruzado: userInfoCarrier.carrierId debe coincidir con userId (mismo carrier).
  const userInfoRaw = origin.localStorage.find((i) => i.name === KEY_USER_INFO_CARRIER)?.value;
  if (userInfoRaw) {
    const userInfoCarrierId = (JSON.parse(userInfoRaw) as { carrierId?: unknown }).carrierId;
    if (userInfoCarrierId !== undefined && Number(userInfoCarrierId) !== carrierId) {
      throw new Error(
        `[carrierSession] ${KEY_USER_ID} y ${KEY_USER_INFO_CARRIER}.carrierId no coinciden en ${path}; ${REGENERATE_HINT}`
      );
    }
  }

  const tokenExpiresAt = readJwtExpiry(token);
  if (tokenExpiresAt.getTime() - Date.now() <= minValidityMs) {
    throw new Error(
      `[carrierSession] sesion vencida o por vencer (exp ${tokenExpiresAt.toISOString()}); ${REGENERATE_HINT}`
    );
  }

  const apiBaseURL = `${expectedOrigin}/${apiPrefix.replace(/^\/+|\/+$/g, '')}/`;
  const role = readLocalStorageItem(origin.localStorage, KEY_USER_ROL, path).replace(/^ROLE_/, '');
  const subUserName = readLocalStorageItem(origin.localStorage, KEY_SUB_USER_NAME, path);
  return new CarrierSession(
    env,
    carrierId,
    subUserId,
    tokenExpiresAt,
    apiBaseURL,
    token,
    role,
    subUserName
  );
}

/**
 * Ejecuta un request y devuelve la respuesta OK. Cualquier error sale redactado:
 * - 401/403 → SessionRejectedError (STOP, sin reintentos).
 * - otro no-2xx → Error con status y cuerpo truncado y redactado.
 * - error de red/timeout → Error con el mensaje de Playwright redactado (su call log
 *   puede listar headers del request). Sin reintentos por defecto (ver `sendGetOk` para GET).
 */
export async function sendOk(
  label: string,
  call: () => Promise<APIResponse>,
  retry: NetworkRetryOptions = NO_RETRY
): Promise<APIResponse> {
  let response: APIResponse | undefined;
  for (let attempt = 0; response === undefined; attempt += 1) {
    try {
      response = await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < retry.maxRetries && isTransientNetworkError(message)) {
        await retry.sleep(retry.backoffMs * 2 ** attempt);
        continue;
      }
      throw new Error(`[api] ${label} fallo sin respuesta: ${redactApiText(message)}`);
    }
  }
  const status = response.status();
  if (status === 401 || status === 403) {
    throw new SessionRejectedError(label, status);
  }
  if (!response.ok()) {
    const body = redactApiText(await response.text().catch(() => '<sin cuerpo>'));
    throw new ApiStatusError(
      `[api] ${label} respondio ${status}: ${body.slice(0, MAX_ERROR_BODY_CHARS)}${body.length > MAX_ERROR_BODY_CHARS ? '…' : ''}`,
      status
    );
  }
  return response;
}

export type NetworkRetryOptions = {
  maxRetries: number;
  backoffMs: number;
  sleep: (ms: number) => Promise<void>;
};

const NO_RETRY: NetworkRetryOptions = { maxRetries: 0, backoffMs: 0, sleep: async () => {} };

/** Cortes de red transitorios (sin respuesta del servidor). */
export function isTransientNetworkError(message: string): boolean {
  return /socket hang up|ECONNRESET/i.test(message);
}

/**
 * `sendOk` SOLO para GET (idempotentes): reintenta hasta 2 veces ante socket hang up / ECONNRESET con
 * backoff. Nunca usar con POST/PUT/DELETE: un reintento podria repetir un efecto ya aplicado.
 */
export function sendGetOk(
  label: string,
  call: () => Promise<APIResponse>,
  retry: Partial<NetworkRetryOptions> = {}
): Promise<APIResponse> {
  return sendOk(label, call, {
    maxRetries: 2,
    backoffMs: 500,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...retry
  });
}

/** Parsea el cuerpo JSON de una respuesta OK; cuerpo vacio → null. */
export async function readJson<T>(response: APIResponse): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}
