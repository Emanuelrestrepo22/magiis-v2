/**
 * NewTripPBO — preparación de un viaje PAX (origen + destino con predicciones de direcciones) SIN confirmarlo.
 * Verbos de negocio con resultado tipado; NO tiene locators: compone `screens/passenger/NewTripScreen`. No lee
 * `process.env`.
 *
 * REGLA DE SEGURIDAD: este PBO nunca toca el CTA de continuar, el pago ni la confirmación (P-12/P-13, con
 * compuerta). Solo lee si el CTA está presente/habilitado. Validación en vivo pendiente (login PAX bloqueado por
 * FCM en emuladores): flujo relevado del código (develop) y V1.
 */

import { Waits } from '../core/Waits.js';
import type { MobileSession } from '../core/MobileSession.js';
import type { TripAddress } from '../data/passengerAddresses.js';
import {
  NewTripScreen,
  pickPredictionIndex,
  type AddressPrediction,
  type ConfirmCtaState,
  type TripField
} from '../screens/passenger/NewTripScreen.js';

export type { TripField } from '../screens/passenger/NewTripScreen.js';

export type PrepareTripInput = { origin: string | TripAddress; destination: string | TripAddress };
export type PreparedTrip = {
  originValue: string;
  destinationValue: string;
  /** El CTA de continuar está presente, visible y habilitado (solo lectura; no se toca). */
  confirmEnabled: boolean;
};

/** La app consulta predicciones desde 3 caracteres (travel-edit-input `MIN_STRING_SIZE`). */
export const MIN_ADDRESS_CHARS = 3;

/** El formulario origen/destino no está visible (otra pantalla, viaje activo o la app no renderizó el home). */
export class NewTripFormNotFoundError extends Error {
  constructor(detail = 'no se encontraron los campos de origen y destino') {
    super(`[NewTripPBO] ${detail}.`);
    this.name = 'NewTripFormNotFoundError';
  }
}

/** El campo no mostró predicciones para el texto escrito. */
export class NoAddressPredictionsError extends Error {
  constructor(
    readonly field: TripField,
    readonly query: string
  ) {
    super(`[NewTripPBO] sin predicciones de dirección para ${field} («${query}»).`);
    this.name = 'NoAddressPredictionsError';
  }
}

/** No se pudo escribir/limpiar un campo, o la predicción elegida no quedó aplicada. */
export class NewTripFieldError extends Error {
  constructor(
    readonly field: TripField,
    detail: string
  ) {
    super(`[NewTripPBO] ${field}: ${detail}.`);
    this.name = 'NewTripFieldError';
  }
}

export type NewTripPboDeps = {
  form: Pick<
    NewTripScreen,
    | 'isFormShown'
    | 'isFieldReadonly'
    | 'readFieldValue'
    | 'typeAddress'
    | 'clearOrigin'
    | 'readPredictions'
    | 'selectPrediction'
    | 'dismissKeyboard'
    | 'readConfirmCta'
    | 'isTripBlockModalShown'
  >;
};

const toAddress = (a: string | TripAddress): TripAddress =>
  typeof a === 'string' ? { query: a } : a;

export class NewTripPBO {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly deps: NewTripPboDeps,
    private readonly log: (message: string) => void = (m) => console.info(m),
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  static forSession(session: MobileSession, log?: (message: string) => void): NewTripPBO {
    return new NewTripPBO({ form: new NewTripScreen(session) }, log);
  }

  /** `true` si el formulario origen/destino está visible. */
  isFormShown(): Promise<boolean> {
    return this.deps.form.isFormShown();
  }

  /** `true` si la app muestra el modal «Ya tiene un viaje creado» (viaje activo). */
  hasActiveTripBlock(): Promise<boolean> {
    return this.deps.form.isTripBlockModalShown();
  }

  /** Estado (solo lectura) del CTA de continuar. */
  readConfirmCta(): Promise<ConfirmCtaState> {
    return this.deps.form.readConfirmCta();
  }

  /**
   * Prepara origen y destino: para cada campo (origen primero) lo deja editable (el origen auto-geolocalizado se
   * limpia con su papelera), escribe con teclado real, espera predicciones, elige una (por texto o índice;
   * sin coincidencia, la primera) y lee el valor resultante. Al final quita el foco y espera el CTA para leer si
   * está habilitado. NUNCA lo toca.
   */
  async prepareTrip(
    trip: PrepareTripInput,
    options: { timeoutMs?: number } = {}
  ): Promise<PreparedTrip> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const shown = await Waits.tryUntil(() => this.deps.form.isFormShown(), {
      label: 'formulario de nuevo viaje',
      timeout: Math.min(timeoutMs, 10_000),
      interval: this.pollIntervalMs
    });
    if (!shown) throw new NewTripFormNotFoundError();

    const originValue = await this.fillField('origin', toAddress(trip.origin), timeoutMs);
    const destinationValue = await this.fillField(
      'destination',
      toAddress(trip.destination),
      timeoutMs
    );

    await this.deps.form.dismissKeyboard();
    const cta = await Waits.tryUntil(
      async () => {
        const state = await this.deps.form.readConfirmCta();
        return state.present && state.visible ? state : null;
      },
      {
        label: 'CTA de continuar visible',
        timeout: Math.min(timeoutMs, 10_000),
        interval: this.pollIntervalMs
      }
    );
    const confirmEnabled = cta?.enabled ?? false;
    this.log(
      `[NewTripPBO] preparado: origen «${originValue}», destino «${destinationValue}», CTA habilitado: ${confirmEnabled}.`
    );
    return { originValue, destinationValue, confirmEnabled };
  }

  /**
   * Sale del formulario SIN confirmar: quita el foco y limpia el origen si quedó resuelto. El destino elegido no
   * tiene control para limpiarse en la app (viaje de 2 puntos); queda solo en memoria de la app. Best effort:
   * no lanza.
   */
  async leaveWithoutConfirming(): Promise<void> {
    await this.deps.form.dismissKeyboard().catch(() => undefined);
    await this.deps.form.clearOrigin().catch(() => false);
  }

  private async fillField(
    field: TripField,
    address: TripAddress,
    timeoutMs: number
  ): Promise<string> {
    const query = address.query.trim();
    if (query.length < MIN_ADDRESS_CHARS) {
      throw new NewTripFieldError(
        field,
        `el texto debe tener al menos ${MIN_ADDRESS_CHARS} caracteres para que la app consulte predicciones`
      );
    }

    if (await this.deps.form.isFieldReadonly(field)) {
      if (field !== 'origin' || !(await this.deps.form.clearOrigin())) {
        throw new NewTripFieldError(field, 'el campo ya tiene un lugar y no se puede limpiar');
      }
      const editable = await Waits.tryUntil(
        async () => !(await this.deps.form.isFieldReadonly(field)),
        {
          label: `campo ${field} editable`,
          timeout: Math.min(timeoutMs, 5_000),
          interval: this.pollIntervalMs
        }
      );
      if (!editable) throw new NewTripFieldError(field, 'sigue de solo lectura tras limpiarlo');
    }

    if (!(await this.deps.form.typeAddress(field, query))) {
      throw new NewTripFieldError(field, 'no se pudo escribir el texto');
    }

    let predictions: AddressPrediction[] = [];
    const found = await Waits.tryUntil(
      async () => {
        predictions = await this.deps.form.readPredictions(field);
        return predictions.length > 0;
      },
      { label: `predicciones de ${field}`, timeout: timeoutMs, interval: this.pollIntervalMs }
    );
    if (!found) throw new NoAddressPredictionsError(field, query);

    const index = pickPredictionIndex(predictions, address.pick);
    if (index < 0 || !(await this.deps.form.selectPrediction(field, index))) {
      throw new NewTripFieldError(field, 'no se pudo elegir la predicción');
    }

    let value = '';
    const applied = await Waits.tryUntil(
      async () => {
        value = (await this.deps.form.readFieldValue(field)).trim();
        return value.length > 0 && (await this.deps.form.isFieldReadonly(field));
      },
      {
        label: `valor de ${field} aplicado`,
        timeout: Math.min(timeoutMs, 15_000),
        interval: this.pollIntervalMs
      }
    );
    if (!applied)
      throw new NewTripFieldError(field, 'la predicción elegida no quedó aplicada al campo');
    return value;
  }
}
