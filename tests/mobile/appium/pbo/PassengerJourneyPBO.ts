/**
 * PassengerJourneyPBO — recorrido del pasajero «pedir un viaje con tarjeta existente»: reemplaza al harness de V1
 * (`PassengerTripHappyPathHarness`, 564 líneas) COMPONIENDO los PBOs ya existentes; no agrega locators ni lee
 * `process.env`, y NO tiene login propio (delega en `PassengerSessionPBO`).
 *
 *   ensureSession -> ensureProfileMode -> hasActiveTrip -> prepareTrip -> proceedToTripInfo
 *     -> selectExistingCard(last4) -> createTrip({confirmed}) -> observeUntil(estado) -> cancelCreatedTrip
 *
 * Seguridad:
 *  - NUNCA elimina ni agrega tarjetas: `selectExistingCard` solo elige por últimos 4 entre las que la app ofrece.
 *  - Lanza `JourneyPreconditionError` (sin mutar nada) si una precondición no se cumple.
 *  - `createTrip` (IRREVERSIBLE, crea un viaje real) exige `{ confirmed: true }` y haber elegido la tarjeta antes.
 *  - `cancelCreatedTrip` solo actúa si ESTA instancia pudo crear un viaje (`tripMayExist`); nunca cancela uno ajeno.
 *
 * Fuera de alcance (trabajo futuro): fase del Chofer (aceptar/completar), 3DS, hold, verificación de cobro en DB,
 * alta de tarjeta propia de la corrida (requiere volver de la billetera al home, que ningún PBO hace hoy).
 */

import type { MobileSession } from '../core/MobileSession.js';
import type { TripState, TripStatus } from '../screens/passenger/TripStatusScreen.js';
import { ActiveTripPBO } from './ActiveTripPBO.js';
import { NewTripPBO, type PrepareTripInput, type PreparedTrip } from './NewTripPBO.js';
import {
  assertConfirmed,
  IrreversibleNotConfirmedError,
  type IrreversibleOptions
} from './OfferPBO.js';
import { PassengerHomePBO, type PassengerProfileMode } from './PassengerHomePBO.js';
import {
  PassengerSessionPBO,
  type PassengerCredentials,
  type PassengerSessionState
} from './PassengerSessionPBO.js';
import { TripCancelPBO, type TripCancelResult } from './TripCancelPBO.js';
import {
  PaymentMethodUnavailableError,
  TripRequestPBO,
  type ConfirmTripResult,
  type PaymentSelection
} from './TripRequestPBO.js';

export { IrreversibleNotConfirmedError };
export type { IrreversibleOptions };

/** Una precondición del recorrido no se cumple: se lanza ANTES de mutar nada. */
export class JourneyPreconditionError extends Error {
  constructor(detail: string) {
    super(`[PassengerJourneyPBO] precondición no cumplida: ${detail}.`);
    this.name = 'JourneyPreconditionError';
  }
}

// ───────────────────────────── plan puro ─────────────────────────────

export type GatewayJourneyRunInput = {
  /** Compuerta de pasarela (`GATEWAY_E2E=1`), leída por el SPEC. */
  gatewayGateOpen: boolean;
  /** Compuerta de creación de viaje (`PAX_TRIP_CREATE=1`), leída por el SPEC. */
  tripGateOpen: boolean;
  /** Entorno de la app (`test`|`uat`|`prod`|...). Solo `test`. */
  environment: string;
  /** `true` = el pasajero ya tiene un viaje (ajeno); `null` = aún no verificado (no bloquea). */
  activeTripExists: boolean | null;
  /** `false` = la tarjeta existente pedida no está disponible en la app; `null` = aún no verificado (no bloquea). */
  cardAvailable: boolean | null;
  /** El escenario está activo (no depende de la fase del Chofer). */
  scenarioActive: boolean;
};
export type GatewayJourneyRunPlan = { proceed: true } | { proceed: false; reason: string };

/**
 * Pura: decide si el spec puede CREAR un viaje con pasarela. Cerrada ante cualquier faltante, con TODOS los motivos.
 * Los campos `null` son «aún no verificado» (permiten evaluar las compuertas antes de abrir el dispositivo); la
 * evaluación final antes de mutar debe pasar valores reales.
 */
export function planGatewayJourneyRun(input: GatewayJourneyRunInput): GatewayJourneyRunPlan {
  const missing: string[] = [];
  if (input.scenarioActive !== true) missing.push('el escenario está inactivo');
  if (input.gatewayGateOpen !== true) {
    missing.push('la compuerta de pasarela (opt-in) no está abierta');
  }
  if (input.tripGateOpen !== true) {
    missing.push('la compuerta de creación de viaje (opt-in) no está abierta');
  }
  if (input.environment !== 'test') {
    missing.push(`el entorno es «${input.environment}» y la pasarela solo corre en test`);
  }
  if (input.activeTripExists === true) {
    missing.push('el pasajero ya tiene un viaje activo que este spec no creó');
  }
  if (input.cardAvailable === false) {
    missing.push('la tarjeta existente pedida no está disponible en la app');
  }
  return missing.length === 0
    ? { proceed: true }
    : { proceed: false, reason: `No se crea ningún viaje: ${missing.join(' y ')}.` };
}

// ───────────────────────────── PBO ─────────────────────────────

export type CardSelectionResult =
  | { selected: true; selection: PaymentSelection }
  | { selected: false; reason: string };

export type PassengerJourneyDeps = {
  session: Pick<PassengerSessionPBO, 'waitForStableSessionState' | 'loginOrFail'>;
  home: Pick<PassengerHomePBO, 'ensureProfileMode'>;
  active: Pick<ActiveTripPBO, 'observeActiveTrip'>;
  newTrip: Pick<NewTripPBO, 'isFormShown' | 'prepareTrip'>;
  request: Pick<TripRequestPBO, 'proceedToTripInfo' | 'selectPayment' | 'confirmTrip'>;
  cancel: Pick<TripCancelPBO, 'waitForState' | 'readStatus' | 'cancelActiveTrip'>;
};

export type CleanupResult =
  | { attempted: false; reason: string }
  | {
      attempted: true;
      cancelled: boolean;
      tripCode: string | null;
      result: TripCancelResult | null;
    };

export class PassengerJourneyPBO {
  private tripInfoReached = false;
  private selectedLast4: string | null = null;
  private mayExist = false;
  private cancelled = false;
  private code: string | null = null;

  constructor(
    private readonly deps: PassengerJourneyDeps,
    private readonly log: (message: string) => void = (m) => console.info(m)
  ) {}

  static forSession(session: MobileSession, log?: (message: string) => void): PassengerJourneyPBO {
    return new PassengerJourneyPBO(
      {
        session: PassengerSessionPBO.forSession(session, log),
        home: PassengerHomePBO.forSession(session, log),
        active: ActiveTripPBO.forSession(session),
        newTrip: NewTripPBO.forSession(session, log),
        request: TripRequestPBO.forSession(session, { log }),
        cancel: TripCancelPBO.forSession(session, log)
      },
      log
    );
  }

  /** `true` desde que se intenta confirmar el viaje y mientras no se haya cancelado (el viaje PUEDE existir). */
  get tripMayExist(): boolean {
    return this.mayExist && !this.cancelled;
  }

  /** Código del viaje creado por esta instancia (si se vio). */
  get tripCode(): string | null {
    return this.code;
  }

  /**
   * Deja la sesión iniciada usando `PassengerSessionPBO` (sin lógica de login propia). Lanza
   * `JourneyPreconditionError` si tras el intento sigue en login/estado desconocido.
   */
  async ensureSession(
    credentials: PassengerCredentials,
    options: { timeoutMs?: number } = {}
  ): Promise<PassengerSessionState> {
    let state = await this.deps.session.waitForStableSessionState();
    if (state.kind === 'login') {
      await this.deps.session.loginOrFail(credentials, { timeoutMs: options.timeoutMs ?? 90_000 });
      state = await this.deps.session.waitForStableSessionState();
    }
    if (state.kind === 'login' || state.kind === 'unknown') {
      throw new JourneyPreconditionError(`se requiere sesión iniciada (estado: ${state.kind})`);
    }
    return state;
  }

  /** Cambia (si hace falta) el modo de perfil; ver `PassengerHomePBO.ensureProfileMode` (errores tipados). */
  ensureProfileMode(mode: PassengerProfileMode) {
    return this.deps.home.ensureProfileMode(mode);
  }

  /** SOLO LECTURA: ¿el pasajero ya tiene un viaje activo? (ajeno: este recorrido no lo toca). */
  async hasActiveTrip(timeoutMs = 20_000): Promise<boolean> {
    return (await this.deps.active.observeActiveTrip({ timeoutMs })).active;
  }

  /** Prepara origen/destino. Lanza `JourneyPreconditionError` si el formulario no está disponible. */
  async prepareTrip(trip: PrepareTripInput, timeoutMs = 45_000): Promise<PreparedTrip> {
    if (!(await this.deps.newTrip.isFormShown())) {
      throw new JourneyPreconditionError(
        'el formulario de nuevo viaje no está disponible (¿viaje activo o fuera del home?)'
      );
    }
    return this.deps.newTrip.prepareTrip(trip, { timeoutMs });
  }

  /**
   * «Seleccionar Vehículo» -> `travel-info` (gateado). Lanza si la app muestra un aviso de bloqueo en vez de
   * `travel-info`.
   */
  async proceedToTripInfo(options: IrreversibleOptions): Promise<void> {
    assertConfirmed(options, 'Seleccionar vehículo (paso previo a crear el viaje)');
    const proceed = await this.deps.request.proceedToTripInfo(options);
    if (proceed.outcome !== 'trip-info') {
      throw new JourneyPreconditionError(
        `la app no llegó a travel-info (aviso «${proceed.outcome}»: ${proceed.message})`
      );
    }
    this.tripInfoReached = true;
  }

  /**
   * Elige una tarjeta EXISTENTE por últimos 4 en `travel-info`. No agrega ni elimina nada. Si la app no ofrece esa
   * tarjeta (o está vencida/deshabilitada) devuelve `selected: false` con el motivo (no lanza).
   */
  async selectExistingCard(last4: string): Promise<CardSelectionResult> {
    const digits = last4.replace(/\D/g, '');
    if (digits.length !== 4) {
      throw new JourneyPreconditionError('los últimos 4 deben ser exactamente 4 dígitos');
    }
    if (!this.tripInfoReached) {
      throw new JourneyPreconditionError('hay que estar en travel-info para elegir la tarjeta');
    }
    try {
      const selection = await this.deps.request.selectPayment({
        type: 'credit-card',
        last4: digits
      });
      this.selectedLast4 = digits;
      return { selected: true, selection };
    } catch (error) {
      if (error instanceof PaymentMethodUnavailableError) {
        this.selectedLast4 = null;
        return { selected: false, reason: error.message };
      }
      throw error;
    }
  }

  /**
   * CREA UN VIAJE REAL (IRREVERSIBLE). Exige `{ confirmed: true }`, estar en `travel-info` y haber elegido la
   * tarjeta con `selectExistingCard`. Devuelve el resultado tipado de `TripRequestPBO.confirmTrip`.
   */
  async createTrip(options: IrreversibleOptions): Promise<ConfirmTripResult> {
    assertConfirmed(options, 'Crear el viaje con pasarela');
    if (!this.tripInfoReached) throw new JourneyPreconditionError('no se llegó a travel-info');
    if (this.selectedLast4 === null) {
      throw new JourneyPreconditionError('no se eligió una tarjeta existente (selectExistingCard)');
    }
    // El viaje PUEDE existir desde que se intenta confirmar; si el resultado es desconocido (lanza) queda en true.
    this.mayExist = true;
    const result = await this.deps.request.confirmTrip(options);
    if (result.outcome === 'created') this.code = result.tripCode;
    else this.mayExist = false;
    return result;
  }

  /** Espera (solo lectura) a que el viaje muestre alguno de los estados; devuelve la última lectura. */
  async observeUntil(
    state: TripState | readonly TripState[],
    timeoutMs = 20_000
  ): Promise<TripStatus> {
    const states: readonly TripState[] = typeof state === 'string' ? [state] : state;
    const status = await this.deps.cancel.waitForState(states, timeoutMs);
    this.code = status.tripCode ?? this.code;
    return status;
  }

  /**
   * Limpieza: cancela el viaje que ESTA instancia pudo crear (nunca uno ajeno). Sin viaje posible no hace nada.
   * Si la app no muestra un viaje activo, no toca nada. Si la cancelación falla lanza un error con el código del
   * viaje pidiendo cancelarlo MANUALMENTE desde Carrier web.
   */
  async cancelCreatedTrip(options: IrreversibleOptions): Promise<CleanupResult> {
    assertConfirmed(options, 'Cancelar el viaje creado por este recorrido');
    if (!this.mayExist) return { attempted: false, reason: 'este recorrido no creó ningún viaje' };
    if (this.cancelled) return { attempted: false, reason: 'el viaje ya estaba cancelado' };
    try {
      const status = await this.deps.cancel.readStatus();
      this.code = status.tripCode ?? this.code;
      if (status.state === 'NONE') {
        this.cancelled = true;
        return { attempted: true, cancelled: false, tripCode: this.code, result: null };
      }
      const result = await this.deps.cancel.cancelActiveTrip(options, { timeoutMs: 30_000 });
      this.cancelled = true;
      this.log(`[PassengerJourneyPBO] viaje ${this.code ?? 'n/d'} cancelado.`);
      return { attempted: true, cancelled: true, tripCode: this.code, result };
    } catch (error) {
      throw new Error(
        `NO SE PUDO CANCELAR el viaje creado por este recorrido (código=${this.code ?? 'n/d'}): ` +
          `${error instanceof Error ? error.message : String(error)} ` +
          'CANCELARLO MANUALMENTE desde Carrier web.'
      );
    }
  }
}
