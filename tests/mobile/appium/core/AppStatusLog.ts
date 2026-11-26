/**
 * AppStatusLog — estado del chofer según el BACKEND, leído del log de arranque de la app Chofer.
 *
 * POR QUÉ: la etiqueta «Disponible / No Disponible» no es un oráculo confiable. El botón se pinta con
 * `driverState == ONLINE && operability` y `operability` puede llegar tarde: tras relanzar, con el backend en
 * ONLINE la app pintó «No Disponible» (medido 24/11/2026, build TEST 2.6.18). Al arrancar, la app pide el estado
 * al backend (`home.page.ts` `getAppStatus` → `statusService.getDriverStatus()`) y lo registra con
 * `console.log('El Driver Status es: ', estado)` dentro de `sendDriverReportLocation`; la consola del WebView
 * llega a logcat como `chromium: [INFO:CONSOLE:…] "El Driver Status es:  ONLINE"`.
 *
 * OJO: el mismo log se emite durante un toggle con el estado DESTINO. Por eso solo vale la PRIMERA línea
 * después de recargar la app y sin tocar el control en el medio: eso hace `readBackendDriverStatus`.
 */

import type { MobileSession } from './MobileSession.js';

/** Estado del chofer tal como lo devuelve el backend (ONLINE, OFFLINE, u otro como IN_TRAVEL). */
export type BackendDriverStatus = string;

const STATUS_PATTERN = /El Driver Status es:\s+"?\s*([A-Z_]+)/;

/** Primer estado registrado en las líneas dadas, o null si no hay ninguno. */
export function parseDriverStatusLines(lines: readonly string[]): BackendDriverStatus | null {
  for (const line of lines) {
    const match = STATUS_PATTERN.exec(line);
    if (match) return match[1]!;
  }
  return null;
}

/** ONLINE → disponible, OFFLINE → no disponible; cualquier otro estado (viaje, etc.) → null. */
export function toAvailability(status: BackendDriverStatus): 'available' | 'notAvailable' | null {
  if (status === 'ONLINE') return 'available';
  if (status === 'OFFLINE') return 'notAvailable';
  return null;
}

export type ReadBackendStatusOptions = {
  timeoutMs?: number;
  intervalMs?: number;
};

type LogEntry = { message?: string };

async function drainLogcat(session: MobileSession): Promise<string[]> {
  await session.switchContext('native');
  const entries = (await session.driver.getLogs('logcat')) as LogEntry[];
  return entries.map((e) => String(e.message ?? ''));
}

/**
 * Recarga el WebView de la app y devuelve el estado que trajo del backend al arrancar. Deja la sesión en el
 * WebView al salir. Lanza si no aparece el log dentro de `timeoutMs` (default 90 s).
 */
export async function readBackendDriverStatus(
  session: MobileSession,
  options: ReadBackendStatusOptions = {}
): Promise<BackendDriverStatus> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const intervalMs = options.intervalMs ?? 2_000;

  // 1. Descartar todo lo anterior: solo cuenta lo que se loguee después de recargar.
  await drainLogcat(session);

  // 2. Recargar la app web (la sesión puede estar en NATIVE o pegada a una página vieja).
  if (!(await session.reattachWebview({ timeoutMs: 45_000 })))
    throw new Error('AppStatusLog: no se pudo entrar al WebView para recargar la app.');
  await session.driver.execute(() => window.location.reload());

  // 3. Esperar la primera línea de estado después de la recarga.
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      const status = parseDriverStatusLines(await drainLogcat(session));
      if (status) return status;
    }
    throw new Error(
      `AppStatusLog: la app no registró «El Driver Status es» en ${timeoutMs} ms tras recargar.`
    );
  } finally {
    await session.reattachWebview({ timeoutMs: 45_000 });
  }
}
