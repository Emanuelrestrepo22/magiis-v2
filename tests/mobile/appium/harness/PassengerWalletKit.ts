/**
 * PassengerWalletKit — andamiaje común de los specs de la billetera PAX: compuertas previas a abrir la sesión y
 * «sesión iniciada». Evita duplicar en cada spec el login y las compuertas. No lee valores de
 * credenciales (las resuelve `resolvePassengerCredentials` por NOMBRE de clave); las compuertas de entorno se
 * leen en el spec y entran acá como booleanos.
 */

import { getPassengerAppConfig } from '../config/appiumRuntime.js';
import { resolvePassengerCredentials } from '../data/passengerCredentials.js';
import { PassengerWalletPBO } from '../pbo/PassengerWalletPBO.js';
import { openPassengerSpec, type PassengerSpecContext } from './PassengerSpecKit.js';

/** Compuerta explícita de ESCRITURA en la billetera (alta + baja de UNA tarjeta de prueba). Solo la lee el spec. */
export const WALLET_WRITE_GATE_ENV = 'PAX_WALLET_WRITE';
/** Tope opcional de tarjetas por billetera (la app no define uno en develop). Solo la lee el spec. */
export const WALLET_MAX_CARDS_ENV = 'PAX_WALLET_MAX_CARDS';

/** Pura: tope de tarjetas desde el texto de la variable (`undefined` si no es un entero positivo). */
export function parseMaxCards(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) return undefined;
  const n = Number(raw.trim());
  return n > 0 ? n : undefined;
}

/**
 * Abre sesión e inicia sesión si hace falta (la billetera la abre el PBO: `openWallet`). `skip(reason)` debe lanzar (como `test.skip`) cuando
 * no hay credenciales o la sesión no queda iniciada; el llamador es responsable de `closePassengerSpec`.
 */
export async function openWalletSpec(
  spec: string,
  skip: (reason: string) => void
): Promise<{ ctx: PassengerSpecContext; wallet: PassengerWalletPBO }> {
  const ctx = await openPassengerSpec(spec);
  const config = getPassengerAppConfig();
  const wallet = PassengerWalletPBO.forSession(ctx.session, ctx.log);
  let state = await ctx.pbo.waitForStableSessionState();
  if (state.kind === 'login') {
    let credentials: ReturnType<typeof resolvePassengerCredentials>;
    try {
      credentials = resolvePassengerCredentials(config.environment);
    } catch (error) {
      skip(
        `Credenciales PAX no legibles: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
    await ctx.pbo.loginOrFail(
      { email: credentials.email, password: credentials.password },
      { timeoutMs: 90_000 }
    );
    state = await ctx.pbo.waitForStableSessionState();
  }
  if (state.kind === 'login' || state.kind === 'unknown') {
    skip(`Requiere sesión iniciada (estado: ${state.kind}).`);
  }
  return { ctx, wallet };
}
