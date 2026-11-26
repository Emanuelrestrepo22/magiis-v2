/**
 * BlockedTripPBO — intento de pedir un viaje nuevo CON un viaje activo previo (TC-PAX-NEW-TRIP-BLOCKED). Es el
 * ÚNICO lugar que llama `TripRequestPBO.confirmTrip({ confirmed: true })` para ese caso, y lo hace solo si
 * `planBlockedAttempt` lo autoriza: (a) compuerta explícita abierta (la lee el SPEC del entorno y la pasa como
 * booleano; este módulo NO lee `process.env`) y (b) pre-chequeo POSITIVO de solo lectura de que el pasajero ya
 * tiene un viaje activo (`ActiveTripPBO`). Sin ambos devuelve `skipped` SIN tocar ningún CTA.
 *
 * Si tras confirmar la app crea el viaje (la precondición era falsa) lanza `UnexpectedTripCreatedError` con el
 * código: se cancela A MANO desde Carrier; este módulo nunca intenta cancelarlo ni actuar sobre él.
 */

import type { ActiveTripObservation } from './ActiveTripPBO.js';
import type { TripRequestPBO } from './TripRequestPBO.js';

export type BlockedAttemptInput = { gateOpen: boolean; preCheck: ActiveTripObservation };
export type BlockedAttemptPlan = { proceed: true } | { proceed: false; reason: string };

/** Pura: decide si se puede tocar el CTA. Cerrada ante cualquier faltante, con el motivo. */
export function planBlockedAttempt(input: BlockedAttemptInput): BlockedAttemptPlan {
  const missing: string[] = [];
  if (input.gateOpen !== true) missing.push('la compuerta explícita (opt-in) no está abierta');
  if (input.preCheck?.active !== true) {
    missing.push(
      `la app no muestra un viaje activo del pasajero (pre-chequeo negativo, url: ${input.preCheck?.url || 'n/d'})`
    );
  }
  return missing.length === 0
    ? { proceed: true }
    : { proceed: false, reason: `No se toca ningún CTA: ${missing.join(' y ')}.` };
}

/** La app CREÓ un viaje: la precondición era falsa. Hay que cancelarlo manualmente desde Carrier. */
export class UnexpectedTripCreatedError extends Error {
  constructor(readonly tripCode: string | null) {
    super(
      `[BlockedTripPBO] SE CREÓ UN VIAJE REAL (código=${tripCode ?? 'n/d'}): el pasajero no tenía un viaje activo. ` +
        'Cancelarlo MANUALMENTE desde Carrier; este spec no lo cancela.'
    );
    this.name = 'UnexpectedTripCreatedError';
  }
}

export type BlockedAttemptResult =
  | { status: 'skipped'; reason: string }
  | { status: 'blocked'; message: string; dismissed: boolean; atStep: 'travel-info' | 'confirm' }
  | { status: 'other-block'; kind: 'credit-limit'; message: string };

export type BlockedTripPboDeps = {
  trip: Pick<TripRequestPBO, 'proceedToTripInfo' | 'confirmTrip'>;
};

export class BlockedTripPBO {
  constructor(private readonly deps: BlockedTripPboDeps) {}

  /**
   * Con el formulario de viaje ya preparado: «Seleccionar Vehículo» -> `travel-info` -> «Viajo Ahora».
   * `planBlockedAttempt` se evalúa ANTES de cualquier tap; sin plan abierto no se llama a `TripRequestPBO`.
   */
  async attempt(input: BlockedAttemptInput): Promise<BlockedAttemptResult> {
    const plan = planBlockedAttempt(input);
    if (!plan.proceed) return { status: 'skipped', reason: plan.reason };

    const proceed = await this.deps.trip.proceedToTripInfo({ confirmed: true });
    if (proceed.outcome === 'blocked-active-trip') {
      return {
        status: 'blocked',
        message: proceed.message,
        dismissed: false,
        atStep: 'travel-info'
      };
    }
    if (proceed.outcome === 'credit-limit') {
      return { status: 'other-block', kind: 'credit-limit', message: proceed.message };
    }

    const confirm = await this.deps.trip.confirmTrip({ confirmed: true });
    if (confirm.outcome === 'created') throw new UnexpectedTripCreatedError(confirm.tripCode);
    if (confirm.outcome === 'credit-limit') {
      return { status: 'other-block', kind: 'credit-limit', message: confirm.message };
    }
    return {
      status: 'blocked',
      message: confirm.message,
      dismissed: confirm.dismissed,
      atStep: 'confirm'
    };
  }
}
