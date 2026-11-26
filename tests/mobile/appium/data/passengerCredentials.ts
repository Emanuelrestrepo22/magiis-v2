/**
 * Resolución de credenciales PAX por NOMBRE de clave (nunca valores en errores ni logs).
 *
 * Cadena (primera no vacía), con `<ENV>` en mayúsculas (TEST, UAT, ...):
 *  - email:    PASSENGER_EMAIL_<ENV> -> USER_PASSENGER_<ENV> -> PASSENGER_EMAIL -> USER_PASSENGER
 *  - password: PASSENGER_PASSWORD_<ENV> -> PASS_PASSENGER_<ENV> -> PASSENGER_PASSWORD -> PASS_PASSENGER
 * Archivos: V2 propio primero y V1 (`MOBILE_CREDENTIALS_FILE`) después; el par sale del mismo archivo.
 * Sin fallback a `DRIVER_*` (el script suelto de V1 lo tenía y logueaba al chofer en la app PAX).
 */

import type { MobileEnvironment } from '../config/appiumRuntime.js';
import {
  readMobileCredentials,
  type MobileCredentialsSource,
  type ReadMobileCredentialsOptions
} from '../config/deviceEnv.js';

export type PassengerCredentialsReader = (options: ReadMobileCredentialsOptions) => {
  email: string;
  password: string;
  source?: MobileCredentialsSource;
  file?: string;
};

/** Claves de email y password en orden de prioridad para el ambiente dado. */
export function passengerCredentialKeys(env: MobileEnvironment): {
  email: string[];
  password: string[];
} {
  const suffix = env.toUpperCase();
  return {
    email: [
      `PASSENGER_EMAIL_${suffix}`,
      `USER_PASSENGER_${suffix}`,
      'PASSENGER_EMAIL',
      'USER_PASSENGER'
    ],
    password: [
      `PASSENGER_PASSWORD_${suffix}`,
      `PASS_PASSENGER_${suffix}`,
      'PASSENGER_PASSWORD',
      'PASS_PASSENGER'
    ]
  };
}

export function resolvePassengerCredentials(
  env: MobileEnvironment,
  reader: PassengerCredentialsReader = readMobileCredentials
): ReturnType<PassengerCredentialsReader> {
  const keys = passengerCredentialKeys(env);
  return reader({
    emailKey: keys.email[0],
    emailFallbackKeys: keys.email.slice(1),
    passwordKey: keys.password[0],
    passwordFallbackKeys: keys.password.slice(1)
  });
}
