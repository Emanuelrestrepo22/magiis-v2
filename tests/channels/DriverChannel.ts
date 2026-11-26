// tests/channels/DriverChannel.ts
// Canal del chofer del flujo híbrido (fase 1, plan del 2026-11-12): el spec pide «cerrar el viaje
// como el chofer» sin saber si lo hace la API (ApiDriverChannel) o la app real con Appium
// (AppDriverChannel, fase 2). Así un mismo journey corre sin teléfono en la regresión y con
// dispositivo solo donde se valida la app. Se elige con DRIVER_CHANNEL=api|app (fixture hybrid).
import type { FinalizeTravelPayload } from '../api/clients/driverTravels.client.js';

export type DriverChannelKind = 'api' | 'app';

/** Canal pedido por env; cualquier valor fuera de api|app es un error de configuración. */
export function resolveDriverChannelKind(raw = process.env.DRIVER_CHANNEL): DriverChannelKind {
  const value = raw?.trim().toLowerCase() || 'api';
  if (value === 'api' || value === 'app') return value;
  throw new Error(`DRIVER_CHANNEL invalido: "${raw}" (esperado api|app)`);
}

/** Viaje ya asignado al chofer, listo para que el canal lo recorra hasta el cierre. */
export interface TripToClose {
  travelId: number;
  /** Id del chofer asignado tal como lo piden status/confirm (`driverUserId` de ConfirmTravelRequestDTO). */
  driverId: number;
  /** Cuerpo del finalize como lo arma la app (ver FinalizeTravelPayload). */
  finalize: FinalizeTravelPayload;
}

/** Resultado del cierre por el canal: evidencia de qué pasos ejerció y cuándo terminó. */
export interface TripClosure {
  channel: DriverChannelKind;
  travelId: number;
  /** Pasos del ciclo de vida del chofer ejecutados, en orden (confirm, goingToDestination, …). */
  checkpoints: string[];
  closedAt: string;
}

/** Estado operativo del chofer, tal como lo devuelve `drivers/{id}/status`. */
export interface DriverStatusSnapshot {
  incomingTripId: number | null;
  currentTrip: unknown;
}

export type DriverIdleVerdict =
  | { idle: true }
  | { idle: false; reason: string }
  /** El viaje entrante no se pudo leer: se deja decidir al backend en el assign (visto en 71215). */
  | { idle: 'unknown'; reason: string };

const TERMINAL_STATE = /^(DONE|CANCELL?ED|LOST)$/i;

/**
 * Decide si el chofer está libre para recibir un viaje. `incomingTripId` sigue apuntando al último
 * viaje aunque esté DONE, así que lo que importa es el estado de ese viaje, no que exista.
 * `incomingState` null = no se pudo leer el detalle.
 */
export function driverIdleVerdict(
  status: DriverStatusSnapshot,
  incomingState: string | null
): DriverIdleVerdict {
  if (status.currentTrip !== null && status.currentTrip !== undefined) {
    return { idle: false, reason: 'tiene un viaje en curso (currentTrip)' };
  }
  if (status.incomingTripId === null) return { idle: true };
  if (incomingState === null) {
    return {
      idle: 'unknown',
      reason: `el viaje entrante ${status.incomingTripId} no se pudo leer; decide el backend en el assign`
    };
  }
  return TERMINAL_STATE.test(incomingState)
    ? { idle: true }
    : {
        idle: false,
        reason: `tiene un viaje entrante abierto ${status.incomingTripId} (${incomingState})`
      };
}

export interface DriverChannel {
  readonly kind: DriverChannelKind;
  /**
   * Falla ANTES de crear datos si el chofer está ocupado (precondición, nunca skip): un viaje nuevo
   * asignado a un chofer trabado quedaría colgado y contaminaría la corrida siguiente.
   */
  ensureIdle(driverId: number): Promise<void>;
  /** Recorre el viaje asignado como el chofer: aceptar → ir a destino → llegar → finalizar. */
  completeTrip(trip: TripToClose): Promise<TripClosure>;
}
