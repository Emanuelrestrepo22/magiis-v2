/**
 * TripCancelPBO — cancelación del viaje ACTIVO del pasajero desde la app (IRREVERSIBLE). Es el ÚNICO lugar que
 * toca «Cancelar Viaje» y «Si»/«Yes» del diálogo (vía `TripCancelScreen`). Compone `TripStatusScreen` (lectura) y
 * `TripCancelScreen` (taps); NO tiene locators ni lee `process.env`.
 *
 * Gate de irreversibilidad (patrón de `OfferPBO`): `cancelActiveTrip` exige `{ confirmed: true }` y, sin él, lanza
 * `IrreversibleNotConfirmedError` ANTES de leer o tocar la pantalla. Si el estado no admite cancelar (sin viaje, o
 * ya en curso sin botón) lanza `TripNotCancellableError` sin tocar nada.
 *
 * Relevado del código (develop): la app NO tiene selector de motivo (`cancelTravel()` se llama sin motivo); solo
 * en `travel-in-progress` (conductor asignado, pasajero sin recoger) el diálogo puede traer un aviso de COSTO de
 * cancelación, que este PBO NO oculta: lo devuelve en `cancellationCost` (ver `TripCancelScreen`). Validación en
 * vivo pendiente (login PAX bloqueado por FCM en emuladores).
 */

import type { MobileSession } from '../core/MobileSession.js';
import { tryUntil } from '../core/Waits.js';
import {
  parseCancellationCost,
  TripCancelScreen,
  type CancellationCostWarning
} from '../screens/passenger/TripCancelScreen.js';
import { isHomeUrl } from '../screens/passenger/passengerWeb.js';
import {
  TripStatusScreen,
  type TripState,
  type TripStatus
} from '../screens/passenger/TripStatusScreen.js';
import {
  assertConfirmed,
  IrreversibleNotConfirmedError,
  type IrreversibleOptions
} from './OfferPBO.js';

export { IrreversibleNotConfirmedError };
export type { IrreversibleOptions };

/** El estado actual no admite cancelar (sin viaje activo o sin botón «Cancelar Viaje»). No se tocó nada. */
export class TripNotCancellableError extends Error {
  constructor(
    readonly state: TripState,
    detail: string
  ) {
    super(`[TripCancelPBO] el viaje no es cancelable desde la app (estado: ${state}): ${detail}.`);
    this.name = 'TripNotCancellableError';
  }
}

/** Falló un paso de la cancelación (botón/diálogo no aparecieron, «Si» no tocable, no se salió del viaje). */
export class TripCancelFailedError extends Error {
  constructor(
    readonly step: 'cta' | 'dialog' | 'confirm' | 'leave',
    detail: string
  ) {
    super(
      `[TripCancelPBO] falló la cancelación en «${step}»: ${detail}. ` +
        'El viaje PUEDE seguir activo: verificar y cancelarlo MANUALMENTE desde Carrier web.'
    );
    this.name = 'TripCancelFailedError';
  }
}

export type TripCancelRunInput = {
  /** Opt-in explícito (`PAX_TRIP_CREATE=1`), leído por el SPEC del entorno y pasado como booleano. */
  gateOpen: boolean;
  /** Entorno de la app (`test`|`uat`|`prod`|...). Los flujos de escritura solo corren en `test`. */
  environment: string;
  /** Pre-chequeo de solo lectura (`ActiveTripPBO`): `active: true` = el pasajero ya tiene un viaje. */
  preCheck: { active: boolean; url: string };
};
export type TripCancelRunPlan = { proceed: true } | { proceed: false; reason: string };

/**
 * Pura: decide si el spec puede CREAR un viaje (y luego cancelarlo). Cerrada ante cualquier faltante, con el
 * motivo. Un viaje ya activo es ajeno (otro test / otra persona): NUNCA se crea ni se cancela.
 */
export function planTripCancelRun(input: TripCancelRunInput): TripCancelRunPlan {
  const missing: string[] = [];
  if (input.gateOpen !== true) missing.push('la compuerta explícita (opt-in) no está abierta');
  if (input.environment !== 'test') {
    missing.push(
      `el entorno es «${input.environment}» y los flujos de escritura solo corren en test`
    );
  }
  if (input.preCheck?.active === true) {
    missing.push(
      `el pasajero ya tiene un viaje activo que este spec no creó (url: ${input.preCheck.url || 'n/d'})`
    );
  }
  return missing.length === 0
    ? { proceed: true }
    : { proceed: false, reason: `No se crea ni se cancela ningún viaje: ${missing.join(' y ')}.` };
}

export type TripCancelPboDeps = {
  status: Pick<TripStatusScreen, 'readStatus'>;
  cancel: Pick<TripCancelScreen, 'tapCancelCta' | 'readCancelDialog' | 'tapDialogConfirm'>;
};

export type TripCancelOptions = {
  /**
   * Reservado: la app no tiene selector de motivo (`cancelTravel()` sin motivo); si se pasa, solo se registra
   * en el log y NO se envía.
   */
  reason?: string;
  timeoutMs?: number;
};

export type TripCancelResult = {
  cancelled: true;
  landedOnHome: boolean;
  /** Estado del viaje justo antes de cancelar. */
  fromState: TripState;
  tripCode: string | null;
  /** Aviso de costo de cancelación del diálogo (no se oculta), o `null` si no lo hubo. */
  cancellationCost: CancellationCostWarning | null;
  dialogText: string;
};

export class TripCancelPBO {
  private readonly log: (message: string) => void;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: TripCancelPboDeps,
    options: { log?: (message: string) => void; pollIntervalMs?: number } = {}
  ) {
    this.log = options.log ?? ((m) => console.info(m));
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(session: MobileSession, log?: (message: string) => void): TripCancelPBO {
    return new TripCancelPBO(
      { status: new TripStatusScreen(session), cancel: new TripCancelScreen(session) },
      { log }
    );
  }

  /** Lectura (sin gate, solo lectura): estado normalizado del viaje activo. */
  readStatus(): Promise<TripStatus> {
    return this.deps.status.readStatus();
  }

  /**
   * Espera hasta `timeoutMs` a que la app muestre alguno de los `states` (solo lectura).
   * Devuelve la última lectura; el llamador decide con `state`.
   */
  async waitForState(states: readonly TripState[], timeoutMs = 20_000): Promise<TripStatus> {
    let last: TripStatus = { url: '', state: 'UNKNOWN', tripCode: null, cancelCtaVisible: false };
    await tryUntil(
      async () => {
        last = await this.deps.status.readStatus();
        return states.includes(last.state);
      },
      { timeout: timeoutMs, interval: this.pollIntervalMs, label: `estado ${states.join('|')}` }
    );
    return last;
  }

  /**
   * Cancela el viaje activo (IRREVERSIBLE): «Cancelar Viaje» -> diálogo -> «Si». Sin `{ confirmed: true }` lanza
   * antes de tocar nada. Devuelve `cancelled: true` solo tras dos lecturas seguidas fuera de la pantalla del viaje.
   */
  async cancelActiveTrip(
    options: IrreversibleOptions,
    extra: TripCancelOptions = {}
  ): Promise<TripCancelResult> {
    assertConfirmed(options, 'Cancelar el viaje activo («Cancelar Viaje»)');
    const timeoutMs = extra.timeoutMs ?? 30_000;
    if (extra.reason) {
      this.log(
        '[TripCancelPBO] la app no tiene selector de motivo: «reason» se ignora (no se envía).'
      );
    }

    const before = await this.deps.status.readStatus();
    if (before.state === 'NONE') {
      throw new TripNotCancellableError(before.state, 'no hay un viaje activo');
    }
    if (!before.cancelCtaVisible) {
      throw new TripNotCancellableError(before.state, 'no se ve el botón «Cancelar Viaje»');
    }

    if (!(await this.deps.cancel.tapCancelCta())) {
      throw new TripCancelFailedError('cta', 'el botón «Cancelar Viaje» no se pudo tocar');
    }
    const dialog = await tryUntil(() => this.deps.cancel.readCancelDialog(), {
      timeout: Math.min(timeoutMs, 10_000),
      interval: this.pollIntervalMs,
      label: 'diálogo de confirmación de cancelación'
    });
    if (!dialog) {
      throw new TripCancelFailedError('dialog', 'no apareció el diálogo de confirmación');
    }
    const cancellationCost = parseCancellationCost(dialog.text);
    if (cancellationCost) {
      this.log(
        `[TripCancelPBO] AVISO de costo de cancelación: «${cancellationCost.text}» (monto: ${cancellationCost.amount ?? 'n/d'}).`
      );
    }

    if (!(await this.deps.cancel.tapDialogConfirm())) {
      throw new TripCancelFailedError(
        'confirm',
        `no se pudo tocar «Si»/«Yes» (botones vistos: ${dialog.buttons.join(' | ') || 'ninguno'})`
      );
    }

    let streak = 0;
    let lastUrl = '';
    const left = await tryUntil(
      async () => {
        const now = await this.deps.status.readStatus().catch(() => null);
        if (!now) return false;
        lastUrl = now.url;
        // UNKNOWN dentro de `travel-in-progress` (sin texto legible) sigue siendo el viaje: no cuenta como salida.
        const out =
          now.state === 'NONE' || (now.state === 'UNKNOWN' && !/travel-in-progress/i.test(now.url));
        streak = out && !now.cancelCtaVisible ? streak + 1 : 0;
        return streak >= 2;
      },
      {
        timeout: timeoutMs,
        interval: this.pollIntervalMs,
        label: 'salida de la pantalla del viaje'
      }
    );
    if (!left) {
      throw new TripCancelFailedError(
        'leave',
        `la app sigue en la pantalla del viaje tras confirmar (url: ${lastUrl || 'n/d'})`
      );
    }
    const landedOnHome = isHomeUrl(lastUrl);
    this.log(
      `[TripCancelPBO] viaje cancelado (desde ${before.state}, código=${before.tripCode ?? 'n/d'}); home: ${landedOnHome}.`
    );
    return {
      cancelled: true,
      landedOnHome,
      fromState: before.state,
      tripCode: before.tripCode,
      cancellationCost,
      dialogText: dialog.text
    };
  }
}
