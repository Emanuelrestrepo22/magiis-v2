// tests/helpers/run-window.ts
// Ventana del cron diario de rendicion automatica (confirmado en codigo/DB: corre una vez al dia ~13:10 UTC
// y solo barre duenos con VEHICLEOWNERS.CASHCOLLECTOR = 1). Ventana por defecto 13:00-13:20 UTC;
// configurable con FR_CRON_WINDOW_UTC="HH:MM-HH:MM". Diseno: docs/qa/automation-stock/fr-1901/rendicion-automatica-diseno-2026-10-21.md
export const DEFAULT_CRON_WINDOW_UTC = '13:00-13:20';

export type CronWindowStatus = {
  inWindow: boolean;
  /** Inicio de la ventana vigente (si inWindow) o de la proxima. */
  windowStartUtc: Date;
  windowEndUtc: Date;
  /** Minutos hasta el inicio de la proxima ventana; 0 si inWindow. */
  minutesToWindow: number;
};

export type CronWindowOptions = { env?: NodeJS.ProcessEnv };

type Hm = { h: number; m: number };
const MS_MIN = 60_000;
const MS_DAY = 24 * 60 * MS_MIN;

function parseWindow(raw: string): { start: Hm; end: Hm } {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!match) throw new Error(`FR_CRON_WINDOW_UTC invalido "${raw}": formato esperado HH:MM-HH:MM`);
  const [sh, sm, eh, em] = match.slice(1).map(Number);
  const start = { h: sh, m: sm };
  const end = { h: eh, m: em };
  if (sh > 23 || eh > 23 || sm > 59 || em > 59)
    throw new Error(`FR_CRON_WINDOW_UTC fuera de rango "${raw}"`);
  if (sh * 60 + sm >= eh * 60 + em)
    throw new Error(`FR_CRON_WINDOW_UTC debe terminar despues de iniciar "${raw}"`);
  return { start, end };
}

const atUtcDay = (day: Date, t: Hm): Date =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), t.h, t.m));

/** Estado de la ventana diaria del cron respecto a `now` (UTC). */
export function cronWindowStatus(
  now: Date = new Date(),
  opts: CronWindowOptions = {}
): CronWindowStatus {
  const env = opts.env ?? process.env;
  const { start, end } = parseWindow(env.FR_CRON_WINDOW_UTC || DEFAULT_CRON_WINDOW_UTC);
  const todayStart = atUtcDay(now, start);
  const todayEnd = atUtcDay(now, end);
  const t = now.getTime();
  if (t >= todayStart.getTime() && t < todayEnd.getTime()) {
    return {
      inWindow: true,
      windowStartUtc: todayStart,
      windowEndUtc: todayEnd,
      minutesToWindow: 0
    };
  }
  const nextStart = t < todayStart.getTime() ? todayStart : new Date(todayStart.getTime() + MS_DAY);
  const nextEnd = new Date(nextStart.getTime() + (todayEnd.getTime() - todayStart.getTime()));
  return {
    inWindow: false,
    windowStartUtc: nextStart,
    windowEndUtc: nextEnd,
    minutesToWindow: Math.ceil((nextStart.getTime() - t) / MS_MIN)
  };
}

/**
 * Error de precondicion (configuracion, no regla de negocio): lanza solo si el dueno tiene
 * CASHCOLLECTOR = 1 y la ventana esta abierta, salvo FR_IGNORE_CRON_WINDOW=1.
 * Con flag 0 o null devuelve el estado sin lanzar.
 */
export function assertOutsideCronWindow(input: {
  now?: Date;
  cashCollectorFlag: number | null;
  env?: NodeJS.ProcessEnv;
}): CronWindowStatus {
  const env = input.env ?? process.env;
  const status = cronWindowStatus(input.now ?? new Date(), { env });
  if (status.inWindow && input.cashCollectorFlag === 1 && env.FR_IGNORE_CRON_WINDOW !== '1') {
    const window = `${status.windowStartUtc.toISOString().slice(11, 16)}-${status.windowEndUtc.toISOString().slice(11, 16)} UTC`;
    throw new Error(
      `ventana del cron de rendicion automatica (${window}) abierta con VEHICLEOWNERS.CASHCOLLECTOR=1: ` +
        `reintentar desde ${status.windowEndUtc.toISOString()} o forzar con FR_IGNORE_CRON_WINDOW=1 ` +
        '(el lote manual puede contaminarse)'
    );
  }
  return status;
}
