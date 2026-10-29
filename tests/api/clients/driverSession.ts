// tests/api/clients/driverSession.ts
// Sesion API del chofer (app driver v2). A diferencia de carrierSession, aca SI hay login con
// credenciales: son las del chofer de pruebas, tomadas SOLO de env (`DRIVER_EMAIL` /
// `DRIVER_PASSWORD`, .env.test gitignored). Nunca se loguean ni se guardan en la sesion; el
// token vive en un campo privado (#token) y no sale en toJSON ni en errores.
//
// Fuente del contrato:
// - magiis-mobile-driver-v2 (develop): services/authentication.service.ts `login()` envia el
//   header `RoleToAttempt: ROLE_DRIVER`; pages/login/login.page.ts:172 pasa "ROLE_DRIVER";
//   services/connection/command/logIn.command.ts → `POST auth/login`, body `{username,password}`,
//   respuesta `{ userId, token }` (ILogInResponse).
// - magiis-be (develop): SecurityProperties.SIGN_IN_URL = "/auth/login".
import type { APIRequestContext } from '@playwright/test';
import { readJson, sendOk, type CarrierSession } from './carrierSession.js';

const DRIVER_ROLE = 'ROLE_DRIVER';

type LoginResponse = { userId?: string | number; token?: string };

export class DriverSession {
  readonly #token: string;

  constructor(
    /** USER_ID del chofer (no DRIVER.ID). Es el `driverUserId` de assign/confirm. */
    readonly driverUserId: number,
    readonly apiBaseURL: string,
    token: string
  ) {
    this.#token = token;
  }

  /** Headers para un request autenticado. No loguear el resultado. */
  authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' };
  }

  /** Vista segura para logs/evidencia: sin token. */
  toJSON(): Record<string, unknown> {
    return { driverUserId: this.driverUserId, apiBaseURL: this.apiBaseURL };
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[driverSession] falta la variable de entorno ${name} (ver .env.example)`);
  }
  return value;
}

/**
 * Login del chofer contra la API del carrier. Usa un contexto sin auth propio y lo descarta.
 * Falla rapido ante cualquier no-2xx o respuesta sin `token`/`userId`.
 */
export async function loginDriver(params: {
  factory: {
    newContext: (options: { baseURL: string }) => Promise<APIRequestContext>;
  };
  carrierSession: CarrierSession;
}): Promise<DriverSession> {
  const { factory, carrierSession } = params;
  const username = requireEnv('DRIVER_EMAIL');
  const password = requireEnv('DRIVER_PASSWORD');
  const api = await factory.newContext({ baseURL: carrierSession.apiBaseURL });
  try {
    const response = await sendOk('auth/login (driver)', () =>
      api.post('auth/login', {
        headers: { RoleToAttempt: DRIVER_ROLE, 'Content-Type': 'application/json' },
        data: { username, password }
      })
    );
    const body = await readJson<LoginResponse>(response);
    const userId = Number(body?.userId);
    if (!body?.token || !Number.isInteger(userId) || userId <= 0) {
      throw new Error('[driverSession] auth/login no devolvio token/userId validos');
    }
    return new DriverSession(userId, carrierSession.apiBaseURL, body.token);
  } finally {
    await api.dispose();
  }
}
