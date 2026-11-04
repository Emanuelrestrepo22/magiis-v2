// tests/config/runtime.ts
// Fuente de verdad para entorno activo, credenciales, rutas y storage state.
// Inspirado en el runtime.ts de magiis-playwright, adaptado a un unico rol (carrier V2).

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
export const DEFAULT_LOCALE = 'en-US';

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
  // Permite override via ENV_FILE; normalmente sigue la convencion .env.<entorno>.
  return normalizeEnvValue(process.env.ENV_FILE) ?? `.env.${getCurrentEnv()}`;
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

const FR_TEXT_KEYS = [
  'FR_CLIENT_QUERY',
  'FR_CONTRACTOR_QUERY',
  'FR_ORIGIN_QUERY',
  'FR_DESTINATION_QUERY',
  'FR_OTHER_COST_NAME'
] as const;
const FR_ID_KEYS = ['FR_DRIVER_ID', 'FR_DRIVER_USER_ID', 'FR_VEHICLE_ID', 'FR_CC_ID'] as const;

/** Datos del circuito e2e del carrier Francia (plan PLAN-E2E-CARRIER-FRANCIA). */
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
 * Lee FR_* del entorno. Fail-fast: lista TODAS las variables ausentes o invalidas (solo nombres).
 * Los ids deben ser enteros positivos.
 */
export function getFrCircuitConfig(): FrCircuitConfig {
  const problems: string[] = [];
  const text: Record<string, string> = {};
  for (const key of FR_TEXT_KEYS) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) text[key] = value;
    else problems.push(`${key} (missing)`);
  }
  const ids: Record<string, number> = {};
  for (const key of FR_ID_KEYS) {
    const raw = normalizeEnvValue(process.env[key]);
    const value = Number(raw);
    if (!raw) problems.push(`${key} (missing)`);
    else if (!Number.isInteger(value) || value <= 0)
      problems.push(`${key} (not a positive integer)`);
    else ids[key] = value;
  }
  if (problems.length > 0) {
    throw new Error(`FR circuit config incomplete in ${getEnvFile()}: ${problems.join(', ')}`);
  }
  return {
    clientQuery: text.FR_CLIENT_QUERY,
    contractorQuery: text.FR_CONTRACTOR_QUERY,
    originQuery: text.FR_ORIGIN_QUERY,
    destinationQuery: text.FR_DESTINATION_QUERY,
    otherCostName: text.FR_OTHER_COST_NAME,
    driverId: ids.FR_DRIVER_ID,
    driverUserId: ids.FR_DRIVER_USER_ID,
    vehicleId: ids.FR_VEHICLE_ID,
    ccId: ids.FR_CC_ID
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
  // Un archivo por entorno evita colisiones entre sesiones persistidas.
  return `storage/state-carrier-${env}.json`;
}

/** storageState de una región en el ambiente activo; la primaria ('') usa el del project. */
export function regionStorageStatePath(region: CarrierRegion): string {
  const env = getCurrentEnv();
  return region
    ? `storage/state-carrier-${region.toLowerCase()}-${env}.json`
    : getStorageStatePath(env);
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
