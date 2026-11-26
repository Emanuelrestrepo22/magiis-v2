/**
 * Perfiles de chofer QA para el cierre de viaje por la app.
 *
 * Un perfil dice QUÉ claves traen la identidad del chofer (email, password, nombre visible). NO contiene
 * valores. Los valores se resuelven por un lector inyectado (`DriverIdentityReader`); el default lee el
 * archivo externo de credenciales de V1 por NOMBRE de clave con `readMobileCredentials`, sin escribir
 * nunca en el entorno del proceso.
 *
 * Regla del repo: un chofer por dispositivo.
 */

import type { PrepApp } from '../../../config/carrier-profiles.js';
import { readMobileCredentials } from '../config/deviceEnv.js';
import type { DriverPreflightExpectation } from './driverPreflightRules.js';

export type DriverProfileId = 'fr-1901' | 'test-default' | 'test-mp';

export type DriverProfile = {
  /** Id de uno de los perfiles de V1 o del derivado de una `PrepApp` (`prep:<paquete>`). */
  id: string;
  description: string;
  /** Carrier TEST esperado. `null` = no se asume (se toma el del handoff). */
  carrierId: number | null;
  emailKey: string;
  passwordKey: string;
  /** Clave con el nombre visible. Ausente si el perfil trae `displayName` literal. */
  displayNameKey?: string;
  /** Nombre visible literal (no es secreto). Gana sobre `displayNameKey`. */
  displayName?: string;
  /** Archivo de credenciales propio del perfil (default: `MOBILE_CREDENTIALS_FILE`). */
  credentialsFile?: string;
};

export type DriverIdentity = { email: string; password: string; displayName: string };

/** Resuelve la identidad de un perfil. Inyectable: los tests usan fakes. */
export type DriverIdentityReader = (profile: DriverProfile) => DriverIdentity;

export const DEFAULT_DRIVER_PROFILE_ID: DriverProfileId = 'test-default';

export const DRIVER_PROFILES: Record<DriverProfileId, DriverProfile> = {
  'fr-1901': {
    id: 'fr-1901',
    description: 'Chofer QA FR (carrier 1901 TEST)',
    carrierId: 1901,
    emailKey: 'DRIVER_EMAIL_FR',
    passwordKey: 'DRIVER_PASSWORD_FR',
    displayNameKey: 'DRIVER_DISPLAY_NAME_FR'
  },
  'test-default': {
    id: 'test-default',
    description:
      'Chofer QA TEST por defecto (DRIVER_EMAIL/DRIVER_PASSWORD); carrier = el del handoff',
    carrierId: null,
    emailKey: 'DRIVER_EMAIL',
    passwordKey: 'DRIVER_PASSWORD',
    displayNameKey: 'DRIVER_DISPLAY_NAME'
  },
  'test-mp': {
    id: 'test-mp',
    description:
      'Chofer QA TEST de MercadoPago (DRIVER_EMAIL_MP/DRIVER_PASSWORD_MP); carrier = el del handoff',
    carrierId: null,
    emailKey: 'DRIVER_EMAIL_MP',
    passwordKey: 'DRIVER_PASSWORD_MP',
    displayNameKey: 'DRIVER_DISPLAY_NAME_MP'
  }
};

export function isDriverProfileId(v: string): v is DriverProfileId {
  return Object.prototype.hasOwnProperty.call(DRIVER_PROFILES, v);
}

export function getDriverProfile(id: string): DriverProfile {
  if (!isDriverProfileId(id)) {
    throw new Error(
      `Perfil de chofer desconocido "${id}". Disponibles: ${Object.keys(DRIVER_PROFILES).join(', ')}.`
    );
  }
  return DRIVER_PROFILES[id];
}

/**
 * Perfil elegido por el selector `DRIVER_PROFILE` (el valor lo pasa quien llama; no se lee del entorno del
 * proceso aquí). Sin selector → `test-default`.
 */
export function selectDriverProfile(selector?: string): DriverProfile {
  const id = selector?.trim();
  return getDriverProfile(id ? id : DEFAULT_DRIVER_PROFILE_ID);
}

/**
 * Perfil derivado de la app Chofer de un perfil de carrier V2 (`PrepApp`): mismas claves de
 * credenciales y archivo, y el nombre visible sale de `driverLabel`. No edita carrier-profiles.ts.
 */
export function driverProfileFromPrepApp(app: PrepApp): DriverProfile {
  return {
    id: `prep:${app.package}`,
    description: `Chofer de la app ${app.package} (${app.driverLabel})`,
    carrierId: null,
    emailKey: app.credentialEnv.email,
    passwordKey: app.credentialEnv.password,
    displayName: app.driverLabel,
    credentialsFile: app.credentialEnvFile
  };
}

/**
 * Arma la identidad desde un mapa de valores ya leído. Fail-fast: nombra TODAS las claves faltantes,
 * nunca valores.
 */
export function driverIdentityFromValues(
  profile: DriverProfile,
  values: Readonly<Record<string, string | undefined>>
): DriverIdentity {
  const literal = profile.displayName?.trim();
  const need: Array<[string, string | undefined]> = [
    [profile.emailKey, values[profile.emailKey]],
    [profile.passwordKey, values[profile.passwordKey]]
  ];
  if (!literal && profile.displayNameKey) {
    need.push([profile.displayNameKey, values[profile.displayNameKey]]);
  }
  const missing = need.filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length > 0 || (!literal && !profile.displayNameKey)) {
    throw new Error(
      `Perfil ${profile.id}: faltan claves ${missing.join(', ') || '<nombre visible>'}. ` +
        'Definilas en el archivo de credenciales móviles; no se imprimen sus valores.'
    );
  }
  return {
    email: values[profile.emailKey]!.trim(),
    password: values[profile.passwordKey]!.trim(),
    displayName: literal ?? values[profile.displayNameKey!]!.trim()
  };
}

/**
 * Lector por defecto: credenciales y nombre por NOMBRE de clave desde el archivo externo
 * (`readMobileCredentials`). El nombre visible no es secreto, pero se lee por la misma fuente. Los
 * errores nombran claves/archivo, nunca valores.
 */
export function createFileDriverIdentityReader(
  options: { file?: string; env?: NodeJS.ProcessEnv } = {}
): DriverIdentityReader {
  return (profile) => {
    const file = profile.credentialsFile ?? options.file;
    const common = { ...(file ? { file } : {}), ...(options.env ? { env: options.env } : {}) };
    const { email, password } = readMobileCredentials({
      emailKey: profile.emailKey,
      passwordKey: profile.passwordKey,
      ...common
    });
    const literal = profile.displayName?.trim();
    if (literal) return { email, password, displayName: literal };
    if (!profile.displayNameKey) {
      throw new Error(`Perfil ${profile.id}: sin displayName ni displayNameKey.`);
    }
    // Mismo lector con la clave del nombre en ambos campos; solo se usa `email`.
    const name = readMobileCredentials({
      emailKey: profile.displayNameKey,
      passwordKey: profile.displayNameKey,
      ...common
    }).email;
    return { email, password, displayName: name.trim() };
  };
}

/**
 * Arma el pre-flight del chofer del perfil. `credentials` viaja en la expectativa y solo se usa si la
 * app está deslogueada; nunca se loguea.
 */
export function readDriverPreflightExpectation(
  profile: DriverProfile,
  appPackage: string,
  expectedTravelId?: number,
  reader: DriverIdentityReader = createFileDriverIdentityReader()
): DriverPreflightExpectation {
  const id = reader(profile);
  return {
    appPackage,
    driverDisplayName: id.displayName,
    credentials: { email: id.email, password: id.password },
    ...(expectedTravelId !== undefined ? { expectedTravelId } : {})
  };
}
