/**
 * PassengerSpecKit — andamiaje mínimo de los specs Playwright de la app Pasajero: sesión Appium, evidencia y
 * `PassengerSessionPBO`. Reusa `environmentSkipReason`/`attachEvidence` del kit del Chofer (sin copiarlos).
 * Las credenciales las resuelve el spec con `resolvePassengerCredentials` (por NOMBRE de clave, sin valores).
 */

import { getPassengerAppConfig, type MobileActorConfig } from '../config/appiumRuntime.js';
import { MobileSession } from '../core/MobileSession.js';
import type { Evidence } from '../core/Evidence.js';
import { PassengerSessionPBO } from '../pbo/PassengerSessionPBO.js';
import { newRunLabel } from './DriverSpecKit.js';

export { attachEvidence, environmentSkipReason } from './DriverSpecKit.js';

export type PassengerSpecContext = {
  config: MobileActorConfig;
  session: MobileSession;
  evidence: Evidence;
  pbo: PassengerSessionPBO;
  runLabel: string;
  log: (message: string) => void;
};

/** Abre sesión Appium con la app PAX. El llamador es responsable de `closePassengerSpec`. */
export async function openPassengerSpec(spec: string): Promise<PassengerSpecContext> {
  const log = (m: string): void => console.info(`[${spec}] ${m}`);
  const config = getPassengerAppConfig();
  const session = new MobileSession(config, { log });
  await session.start();
  const runLabel = newRunLabel(spec);
  return {
    config,
    session,
    evidence: session.evidence(runLabel),
    pbo: PassengerSessionPBO.forSession(session, log),
    runLabel,
    log
  };
}

export async function closePassengerSpec(ctx: PassengerSpecContext | null): Promise<void> {
  await ctx?.session.end().catch(() => undefined);
}
