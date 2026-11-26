/**
 * DriverSpecKit — andamiaje común de los specs Playwright de la app Chofer (sin lógica de negocio).
 * Arma sesión Appium, i18n del perfil, evidencia y `DriverSessionPBO` a partir del entorno, y concentra
 * las piezas puras (perfil, guardas de ambiente, key de Xray) para cubrirlas con unit sin dispositivo.
 *
 * Reglas:
 *  - Las credenciales y el nombre visible se leen por NOMBRE de clave desde el archivo externo
 *    (`MOBILE_CREDENTIALS_FILE`) vía `data/driverProfiles.ts`; nunca de `process.env` ni se imprimen valores.
 *  - Solo son selectores no secretos del entorno: `DRIVER_PROFILE`, `F5_CARRIER` / `CIRCUIT_CARRIER`,
 *    `APP_LOCALE`, `ENV`.
 *  - Nunca corre contra PROD.
 *  - Una key de Xray pendiente NO se emite como annotation `tms` (el reporter intentaría acreditar un Test
 *    inexistente): el spec sin Test se marca `@no-xray`.
 */

import type { TestInfo } from '@playwright/test';
import { peekCarrierProfile, resolveCircuitCarrierId } from '../../../config/carrier-profiles.js';
import type { PrepApp } from '../../../config/carrier-profiles.js';
import { getDriverAppConfig } from '../config/appiumRuntime.js';
import type { MobileActorConfig, MobileEnvironment } from '../config/appiumRuntime.js';
import { I18n, PROFILE_LOCALES, isLocale } from '../core/I18n.js';
import type { Locale } from '../core/I18n.js';
import { MobileSession } from '../core/MobileSession.js';
import type { Evidence } from '../core/Evidence.js';
import type { ScreenshotRef } from '../core/ScreenEvidence.js';
import {
  createFileDriverIdentityReader,
  driverProfileFromPrepApp,
  readDriverPreflightExpectation,
  selectDriverProfile
} from '../data/driverProfiles.js';
import type { DriverIdentityReader, DriverProfile } from '../data/driverProfiles.js';
import type { DriverPreflightExpectation } from '../data/driverPreflightRules.js';
import { DriverSessionPBO } from '../pbo/DriverSessionPBO.js';

type EnvMap = Readonly<Record<string, string | undefined>>;

// ---------------------------------------------------------------- piezas puras

/** Carrier cuyo perfil V2 aporta la app Chofer por defecto cuando no hay `DRIVER_PROFILE`. */
export const DEFAULT_DRIVER_CARRIER = '1521';

function prepAppOf(carrierId: string): PrepApp {
  const profile = peekCarrierProfile(carrierId) as { prep?: unknown };
  const prep = profile.prep as { app?: unknown } | undefined;
  const app = prep && typeof prep === 'object' ? prep.app : undefined;
  if (!app || typeof app !== 'object' || (app as { __todo?: boolean }).__todo) {
    throw new Error(`El perfil de carrier "${carrierId}" no declara app Chofer (prep.app).`);
  }
  return app as PrepApp;
}

/**
 * Perfil del chofer del spec. Con `DRIVER_PROFILE` usa ese perfil de V1 (desconocido = error explícito). Sin él,
 * toma la app Chofer del perfil de carrier de `F5_CARRIER` / `CIRCUIT_CARRIER` (default 1521) vía
 * `driverProfileFromPrepApp`.
 *
 * El archivo de credenciales del perfil derivado se descarta a propósito: `credentialEnvFile` es una ruta
 * relativa al repo de V1 y aquí se resolvería contra V2; las credenciales salen siempre de `MOBILE_CREDENTIALS_FILE`.
 */
export function resolveDriverSpecProfile(env: EnvMap): DriverProfile {
  if (env.DRIVER_PROFILE?.trim()) return selectDriverProfile(env.DRIVER_PROFILE);
  const carrier = env.F5_CARRIER?.trim() || env.CIRCUIT_CARRIER?.trim() || DEFAULT_DRIVER_CARRIER;
  resolveCircuitCarrierId({ CIRCUIT_CARRIER: carrier }); // id desconocido = error explícito
  const profile = { ...driverProfileFromPrepApp(prepAppOf(carrier)) };
  delete profile.credentialsFile;
  return profile;
}

/** Locale del spec: `APP_LOCALE` (es|en|fr) gana; si no, el del perfil; un perfil derivado de carrier asume `es`. */
export function resolveSpecLocale(profile: DriverProfile, env: EnvMap): Locale {
  const override = env.APP_LOCALE?.trim();
  if (override) {
    if (!isLocale(override)) throw new Error(`i18n: APP_LOCALE="${override}" inválido (es|en|fr).`);
    return override;
  }
  return PROFILE_LOCALES[profile.id] ?? 'es';
}

/** Motivo para saltear el spec según el ambiente (null = permitido). La app Chofer real nunca corre contra PROD. */
export function environmentSkipReason(environment: MobileEnvironment): string | null {
  return environment === 'prod'
    ? 'Los specs de la app Chofer no corren contra PROD (ENV=prod).'
    : null;
}

const REAL_XRAY_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * Annotation `tms` para el reporter de Xray. Con una key real devuelve `[{ type: 'tms', description }]`; con un
 * placeholder (vacío o con otro formato) devuelve `[]`: no se acredita nada. Para specs con Test real se usa
 * `makeAnnotate` con key literal (CONVENTIONS §5); esto solo cubre los specs `@no-xray`.
 */
export function xrayKeyAnnotations(key: string): Array<{ type: string; description: string }> {
  return REAL_XRAY_KEY.test(key.trim()) ? [{ type: 'tms', description: key.trim() }] : [];
}

/** true si la constante todavía es un placeholder y no una key real de Xray. */
export function isPendingXrayKey(key: string): boolean {
  return !REAL_XRAY_KEY.test(key.trim());
}

/** Nombres (no valores) de las claves del perfil que no tienen valor en el mapa ya leído. */
export function missingProfileKeys(profile: DriverProfile, values: EnvMap): string[] {
  const need = [profile.emailKey, profile.passwordKey];
  if (!profile.displayName?.trim() && profile.displayNameKey) need.push(profile.displayNameKey);
  return need.filter((k) => !values[k]?.trim());
}

/**
 * Motivo de skip si no se pueden leer las credenciales del perfil (null = legibles). El mensaje viene del lector
 * y nombra claves/archivo, nunca valores.
 */
export function credentialsSkipReason(
  profile: DriverProfile,
  reader: DriverIdentityReader = createFileDriverIdentityReader()
): string | null {
  try {
    reader(profile);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Etiqueta de corrida única y ordenable: `<spec>-<yyyymmddThhmmss>`. */
export function newRunLabel(spec: string, now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  return `${spec}-${stamp}`;
}

// ---------------------------------------------------------------- contexto de spec

export type DriverSpecContext = {
  config: MobileActorConfig;
  profile: DriverProfile;
  session: MobileSession;
  i18n: I18n;
  evidence: Evidence;
  pbo: DriverSessionPBO;
  expectation: DriverPreflightExpectation;
  runLabel: string;
  log: (message: string) => void;
};

/** Abre sesión Appium y arma PBO + evidencia. El llamador es responsable de `closeDriverSpec`. */
export async function openDriverSpec(
  spec: string,
  env: EnvMap = process.env
): Promise<DriverSpecContext> {
  const log = (m: string): void => console.info(`[${spec}] ${m}`);
  const config = getDriverAppConfig();
  const profile = resolveDriverSpecProfile(env);
  const i18n = new I18n(resolveSpecLocale(profile, env));
  const expectation = readDriverPreflightExpectation(profile, config.appPackage ?? '');
  const session = new MobileSession(config, { log });
  await session.start();
  const runLabel = newRunLabel(spec);
  return {
    config,
    profile,
    session,
    i18n,
    evidence: session.evidence(runLabel),
    pbo: DriverSessionPBO.forSession(session, i18n, log),
    expectation,
    runLabel,
    log
  };
}

export async function closeDriverSpec(ctx: DriverSpecContext | null): Promise<void> {
  await ctx?.session.end().catch(() => undefined);
}

/**
 * Para el `finally` del spec (contrato Xray): garantiza >=1 PNG y adjunta todas las capturas al test
 * (`Evidence.attachTo`). Si la captura de respaldo falla no lanza, para no tapar el error original.
 */
export async function attachEvidence(
  testInfo: Pick<TestInfo, 'attach'>,
  evidence: Pick<Evidence, 'attachTo'>,
  fallbackLabel = 'final'
): Promise<ScreenshotRef[]> {
  return evidence.attachTo(testInfo, fallbackLabel);
}
