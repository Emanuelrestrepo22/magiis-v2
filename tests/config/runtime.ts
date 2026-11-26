// tests/config/runtime.ts
// Fuente de verdad para entorno activo, credenciales, rutas y storage state.
// Inspirado en el runtime.ts de magiis-playwright, adaptado a un unico rol (carrier V2).

import { existsSync } from 'node:fs';

import {
  isCircuitCarrierExplicit,
  loadCarrierProfile,
  peekCarrierProfile
} from './carrier-profiles.js';

export const SUPPORTED_ENVS = ['test', 'uat', 'prod'] as const;
export type AppEnv = (typeof SUPPORTED_ENVS)[number];

// Regiones soportadas - cada una mapea a un par USER_CARRIER[_<REGION>] + PASS_CARRIER[_<REGION>].
// Default = '' (region primaria) -> USER_CARRIER / PASS_CARRIER sin sufijo.
export const SUPPORTED_REGIONS = ['', 'AR', 'US', 'MX', 'FR'] as const;
export type CarrierRegion = (typeof SUPPORTED_REGIONS)[number];

/**
 * Regiones SIN fallback a las credenciales primarias: operan un carrier propio con escrituras
 * (alta, cierre, rendicion). Caer en USER_CARRIER operaria otro carrier sin avisar.
 */
const NO_FALLBACK_REGIONS: readonly CarrierRegion[] = ['FR'];

/**
 * Locale del browser para TODA la suite. Fuente de verdad unica: lo consumen
 * playwright.config.ts (use raiz) y global-setup.ts (que crea su propio contexto
 * y NO hereda el use del config).
 *
 * El portal resuelve su idioma desde navigator.language (LanguageService ->
 * getBrowserLang() -> /^es/ -> 'es-ar') y lo persiste en localStorage 'carrier-31'
 * (StorageKeyEnum.defaultLanguage). Como el storageState se genera en global-setup,
 * si ese contexto no fija el locale queda 'es-ar' grabado y pisa al locale del config
 * en todos los tests: el getter de IdentityService lee localStorage antes que el
 * navegador. Sin esto, en una maquina con SO en espanol la UI sale en ES.
 *
 * El idioma NO depende de la cuenta ni del pais del carrier: es 100% client-side.
 * El project '-es' de docs/architecture/I18N-STRATEGY.md pisara este default.
 */
export const DEFAULT_LOCALE: string = peekCarrierProfile().locale as string;

export type CarrierV2Credentials = {
  username: string;
  password: string;
  region: CarrierRegion;
};

export type CarrierV2RuntimeConfig = {
  env: AppEnv;
  baseURL: string;
  baseURLV1: string | null;
  loginPath: string;
  dashboardPattern: string;
  enableV1Parity: boolean;
};

// Defaults alineados al portal carrier V2 real (apps-test.magiis.com/carrier/#/auth/login).
const DEFAULT_LOGIN_PATH = '/carrier/#/auth/login';
const DEFAULT_DASHBOARD_PATTERN = '/carrier/#/dashboard';

function normalizeEnvValue(value: string | undefined): string | undefined {
  // Variables vacias se tratan como ausentes para que apliquen los defaults.
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isSupportedEnv(value: string | undefined): value is AppEnv {
  return value !== undefined && (SUPPORTED_ENVS as readonly string[]).includes(value);
}

export function getCurrentEnv(): AppEnv {
  // TEST es el entorno por defecto para no depender de ENV explicita en local.
  const raw = normalizeEnvValue(process.env.ENV);
  return isSupportedEnv(raw) ? raw : 'test';
}

export function getEnvFile(): string {
  // Permite override via ENV_FILE; normalmente sigue la convencion .env.<entorno>. Con CIRCUIT_CARRIER
  // explicita, el default es el archivo que nombra el perfil (sin ella, el comportamiento no cambia).
  const fromProfile = isCircuitCarrierExplicit()
    ? (peekCarrierProfile().envFile as string)
    : undefined;
  return normalizeEnvValue(process.env.ENV_FILE) ?? fromProfile ?? `.env.${getCurrentEnv()}`;
}

/**
 * Resuelve credenciales del carrier para una region dada.
 * Region '' (vacia, default) -> USER_CARRIER / PASS_CARRIER.
 * Region 'AR' -> USER_CARRIER_AR / PASS_CARRIER_AR (con fallback a la primaria si no esta seteada).
 */
export function resolveCredentials(region: CarrierRegion = ''): CarrierV2Credentials {
  const suffix = region ? `_${region}` : '';
  const allowFallback = region !== '' && !NO_FALLBACK_REGIONS.includes(region);
  const username =
    normalizeEnvValue(process.env[`USER_CARRIER${suffix}`]) ??
    (allowFallback ? normalizeEnvValue(process.env.USER_CARRIER) : undefined);
  const password =
    normalizeEnvValue(process.env[`PASS_CARRIER${suffix}`]) ??
    (allowFallback ? normalizeEnvValue(process.env.PASS_CARRIER) : undefined);

  if (!username) {
    throw new Error(`Missing USER_CARRIER${suffix} (and fallback USER_CARRIER) in ${getEnvFile()}`);
  }
  if (!password) {
    throw new Error(`Missing PASS_CARRIER${suffix} (and fallback PASS_CARRIER) in ${getEnvFile()}`);
  }
  return { username, password, region };
}

/**
 * Credenciales del chofer de la region (app driver). Mismo criterio de sufijo que el carrier:
 * region 'FR' -> DRIVER_EMAIL_FR / DRIVER_PASSWORD_FR, sin fallback para regiones de
 * NO_FALLBACK_REGIONS. Falla rapido nombrando la variable (nunca el valor).
 */
export function resolveDriverCredentials(region: CarrierRegion = ''): {
  email: string;
  password: string;
  region: CarrierRegion;
} {
  const suffix = region ? `_${region}` : '';
  const allowFallback = region !== '' && !NO_FALLBACK_REGIONS.includes(region);
  const email =
    normalizeEnvValue(process.env[`DRIVER_EMAIL${suffix}`]) ??
    (allowFallback ? normalizeEnvValue(process.env.DRIVER_EMAIL) : undefined);
  const password =
    normalizeEnvValue(process.env[`DRIVER_PASSWORD${suffix}`]) ??
    (allowFallback ? normalizeEnvValue(process.env.DRIVER_PASSWORD) : undefined);
  if (!email) throw new Error(`Missing DRIVER_EMAIL${suffix} in ${getEnvFile()}`);
  if (!password) throw new Error(`Missing DRIVER_PASSWORD${suffix} in ${getEnvFile()}`);
  return { email, password, region };
}

// Sufijos de las variables de fixture; el prefijo (FR, US, ...) lo da el perfil de carrier activo.
const CIRCUIT_TEXT_SUFFIXES = [
  'CLIENT_QUERY',
  'CONTRACTOR_QUERY',
  'ORIGIN_QUERY',
  'DESTINATION_QUERY',
  'OTHER_COST_NAME'
] as const;
const CIRCUIT_ID_SUFFIXES = ['DRIVER_ID', 'DRIVER_USER_ID', 'VEHICLE_ID', 'CC_ID'] as const;

/** Datos del circuito e2e del carrier activo (default 1901 Francia; plan PLAN-E2E-CARRIER-FRANCIA). */
export type FrCircuitConfig = {
  clientQuery: string;
  contractorQuery: string;
  originQuery: string;
  destinationQuery: string;
  otherCostName: string;
  /** DRIVER.ID (finalizeAdmin). */
  driverId: number;
  /** DRIVER.USER_ID (rendicion: query `driverUserId`). */
  driverUserId: number;
  vehicleId: number;
  /** CHECKINGACCOUNT.ID de la CC del contractor. */
  ccId: number;
};

/**
 * Lee <PREFIX>_* del entorno (PREFIX = envPrefix del perfil activo: FR para 1901). Fail-fast: lista
 * TODAS las variables ausentes o invalidas (solo nombres). Los ids deben ser enteros positivos.
 * `OTHER_COST_NAME` solo es obligatoria si el perfil declara city tax; si no, queda ''.
 */
export function getFrCircuitConfig(): FrCircuitConfig {
  const profile = loadCarrierProfile();
  const prefix = profile.envPrefix;
  const problems: string[] = [];
  const text: Record<string, string> = {};
  for (const suffix of CIRCUIT_TEXT_SUFFIXES) {
    const key = `${prefix}_${suffix}`;
    const value = normalizeEnvValue(process.env[key]);
    if (value) text[suffix] = value;
    else if (suffix === 'OTHER_COST_NAME' && !profile.cityTax.present) text[suffix] = '';
    else problems.push(`${key} (missing)`);
  }
  const ids: Record<string, number> = {};
  for (const suffix of CIRCUIT_ID_SUFFIXES) {
    const key = `${prefix}_${suffix}`;
    const raw = normalizeEnvValue(process.env[key]);
    const value = Number(raw);
    if (!raw) problems.push(`${key} (missing)`);
    else if (!Number.isInteger(value) || value <= 0)
      problems.push(`${key} (not a positive integer)`);
    else ids[suffix] = value;
  }
  if (problems.length > 0) {
    throw new Error(`FR circuit config incomplete in ${getEnvFile()}: ${problems.join(', ')}`);
  }
  return {
    clientQuery: text.CLIENT_QUERY,
    contractorQuery: text.CONTRACTOR_QUERY,
    originQuery: text.ORIGIN_QUERY,
    destinationQuery: text.DESTINATION_QUERY,
    otherCostName: text.OTHER_COST_NAME,
    driverId: ids.DRIVER_ID,
    driverUserId: ids.DRIVER_USER_ID,
    vehicleId: ids.VEHICLE_ID,
    ccId: ids.CC_ID
  };
}

/** Gate de irreversibles: solo el valor exacto `1` habilita la accion. */
export function isFrGateOpen(
  name:
    | 'FR_CONFIRM_SURRENDER'
    | 'FR_EDIT_AFTER_SURRENDER'
    | 'FR_CIRCUIT_CREATE_TRIP'
    | 'FR_TOGGLE_AUTO_SURRENDER'
): boolean {
  return normalizeEnvValue(process.env[name]) === '1';
}

/**
 * Gates de la fase 2 de la rendicion (F5), nombres por dominio sin prefijo de pais. Cada uno puede tener un alias
 * de LECTURA (gate historico FR) para no romper corridas/specs existentes; el valor exacto `1` lo abre.
 */
export const F5_GATE_ALIASES = {
  F5_CONFIRM_SURRENDER: ['FR_CONFIRM_SURRENDER'],
  // Sin alias: armar y disparar la automatica se abren por separado y por nombre exacto (un solo gate historico
  // no debe abrir las dos acciones irreversibles a la vez). El spec FR legacy sigue usando FR_TOGGLE_AUTO_SURRENDER.
  F5_AUTO_ARM: [],
  F5_AUTO_FIRE: [],
  F5_CONFIRM_SETTLEMENT: ['FR_CONFIRM_SETTLEMENT'],
  CIRCUIT_PREP_CREATE_TRIPS: [],
  F5_APP_CLOSE: []
} as const satisfies Record<string, readonly string[]>;

export type F5GateName = keyof typeof F5_GATE_ALIASES;

/** true solo si el gate (o un alias de lectura) vale exactamente `1`; ausente o cualquier otro valor = cerrado. */
export function isGateOpen(name: F5GateName, env: NodeJS.ProcessEnv = process.env): boolean {
  return [name, ...F5_GATE_ALIASES[name]].some((key) => normalizeEnvValue(env[key]) === '1');
}

/**
 * Gate de la PREPARACION de datos (alta + cancel + cierre administrativo) en cualquier ambiente: solo el valor
 * exacto `1` lo abre. Nombre sin prefijo de pais: una corrida AR/US no debe abrirse con un gate `FR_`.
 */
export function isCircuitGateOpen(name: 'CIRCUIT_PREP_CREATE_TRIPS'): boolean {
  return normalizeEnvValue(process.env[name]) === '1';
}

/**
 * Gate de ALTA de viaje del circuito (legacy `FR_CIRCUIT_CREATE_TRIP`, 1901): lo abre el gate historico O el
 * nuevo `CIRCUIT_PREP_CREATE_TRIPS` (alias de lectura). La preparacion multi-carrier exige solo el nuevo.
 */
export function isCircuitCreateGateOpen(): boolean {
  return isFrGateOpen('FR_CIRCUIT_CREATE_TRIP') || isCircuitGateOpen('CIRCUIT_PREP_CREATE_TRIPS');
}

export function resolveBaseURL(): string {
  const baseURL = normalizeEnvValue(process.env.BASE_URL);
  if (!baseURL) {
    throw new Error(`Missing BASE_URL in ${getEnvFile()}`);
  }
  return baseURL;
}

export function resolveBaseURLV1(): string | null {
  // V1 es opcional - solo se usa cuando ENABLE_V1_PARITY_TESTS=true.
  return normalizeEnvValue(process.env.BASE_URL_V1) ?? null;
}

export function resolveLoginPath(): string {
  return normalizeEnvValue(process.env.LOGIN_PATH) ?? DEFAULT_LOGIN_PATH;
}

export function resolveLoginPathV1(): string {
  // Path del login de V1 (Angular 8). Usado solo si ENABLE_V1_PARITY_TESTS=true.
  return normalizeEnvValue(process.env.LOGIN_PATH_V1) ?? '/#/authentication/login/carrier';
}

export function resolveDashboardPattern(): string {
  return normalizeEnvValue(process.env.DASHBOARD_URL_PATTERN) ?? DEFAULT_DASHBOARD_PATTERN;
}

export function isV1ParityEnabled(): boolean {
  return normalizeEnvValue(process.env.ENABLE_V1_PARITY_TESTS)?.toLowerCase() === 'true';
}

export function getStorageStatePath(env: AppEnv = getCurrentEnv()): string {
  // Un archivo por entorno evita colisiones entre sesiones persistidas. Con CIRCUIT_CARRIER explicita y
  // un perfil con sufijo propio, un archivo por carrier: una corrida 1521 no pisa la sesion 1901.
  const suffix = isCircuitCarrierExplicit() ? peekCarrierProfile().storageStateSuffix : null;
  return suffix
    ? `storage/state-carrier-${String(suffix)}-${env}.json`
    : `storage/state-carrier-${env}.json`;
}

/** storageState de una región en el ambiente activo; la primaria ('') usa el del project. */
/**
 * Candidatos de storageState de una región. El canónico va primero (es el que escribe global-setup);
 * UAT acepta además los nombres alternativos que dejan los lanes de datos
 * (US: `circuit-1521`; FR/AR: `<env>-<región>`).
 */
export function regionStorageStateCandidates(region: CarrierRegion, env: string): string[] {
  if (!region) return [getStorageStatePath(env as AppEnv)];
  const r = region.toLowerCase();
  const list = [`storage/state-carrier-${r}-${env}.json`];
  if (env === 'uat') {
    list.push(`storage/state-carrier-${env}-${r}.json`);
    if (region === 'US') list.push(`storage/state-carrier-circuit-1521-${env}.json`);
  }
  return list;
}

/** Ruta del storageState de una región en el ambiente activo: el primer candidato que existe o el canónico. */
export function regionStorageStatePath(region: CarrierRegion): string {
  const candidates = regionStorageStateCandidates(region, getCurrentEnv());
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

/**
 * Regiones extra a loguear en global-setup (REGION_SESSIONS="AR,US"). Opt-in pensado para CI,
 * donde no hay storageState humano de la región; localmente queda vacío y nada cambia.
 */
export function regionSessionsToLogin(): CarrierRegion[] {
  const raw = normalizeEnvValue(process.env.REGION_SESSIONS);
  if (!raw) return [];
  return raw.split(',').map((value) => {
    const region = value.trim().toUpperCase();
    if (!region || !(SUPPORTED_REGIONS as readonly string[]).includes(region)) {
      throw new Error(
        `REGION_SESSIONS invalida: "${value}" (esperado ${SUPPORTED_REGIONS.filter(Boolean).join('|')})`
      );
    }
    return region as CarrierRegion;
  });
}

/** Region de credenciales del circuito: la del perfil si CIRCUIT_CARRIER es explicita; si no, la primaria. */
export function circuitCredentialRegion(): CarrierRegion {
  return isCircuitCarrierExplicit() ? (peekCarrierProfile().region as CarrierRegion) : '';
}

export function getCarrierV2Runtime(): CarrierV2RuntimeConfig {
  return {
    env: getCurrentEnv(),
    baseURL: resolveBaseURL(),
    baseURLV1: resolveBaseURLV1(),
    loginPath: resolveLoginPath(),
    dashboardPattern: resolveDashboardPattern(),
    enableV1Parity: isV1ParityEnabled()
  };
}
