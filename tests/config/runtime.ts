// tests/config/runtime.ts
// Fuente de verdad para entorno activo, credenciales, rutas y storage state.
// Inspirado en el runtime.ts de magiis-playwright, adaptado a un unico rol (carrier V2).

export const SUPPORTED_ENVS = ['test', 'uat', 'prod'] as const;
export type AppEnv = (typeof SUPPORTED_ENVS)[number];

// Regiones soportadas - cada una mapea a un par USER_CARRIER[_<REGION>] + PASS_CARRIER[_<REGION>].
// Default = '' (region primaria) -> USER_CARRIER / PASS_CARRIER sin sufijo.
export const SUPPORTED_REGIONS = ['', 'AR', 'US', 'MX'] as const;
export type CarrierRegion = (typeof SUPPORTED_REGIONS)[number];

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
  const username =
    normalizeEnvValue(process.env[`USER_CARRIER${suffix}`]) ??
    (region ? normalizeEnvValue(process.env.USER_CARRIER) : undefined);
  const password =
    normalizeEnvValue(process.env[`PASS_CARRIER${suffix}`]) ??
    (region ? normalizeEnvValue(process.env.PASS_CARRIER) : undefined);

  if (!username) {
    throw new Error(`Missing USER_CARRIER${suffix} (and fallback USER_CARRIER) in ${getEnvFile()}`);
  }
  if (!password) {
    throw new Error(`Missing PASS_CARRIER${suffix} (and fallback PASS_CARRIER) in ${getEnvFile()}`);
  }
  return { username, password, region };
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
