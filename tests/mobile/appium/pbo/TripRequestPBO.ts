/**
 * TripRequestPBO — solicitud del viaje PAX desde el formulario ya preparado (`NewTripPBO`): ir a `travel-info`,
 * elegir método de pago, confirmar (CREA UN VIAJE REAL) y manejar los bloqueos («Ya tiene un viaje creado»,
 * límite de crédito). Compone `PaymentSelectorScreen` y `PassengerTripConfirmScreen`; NO tiene locators ni lee
 * `process.env`.
 *
 * Gate de irreversibilidad (mismo patrón que `OfferPBO`): TODO método que toca un CTA de confirmación exige
 * `{ confirmed: true }` y, sin él, lanza `IrreversibleNotConfirmedError` ANTES de tocar la pantalla:
 * - `proceedToTripInfo` (CTA «Seleccionar Vehículo»): según el código solo simula y navega a `travel-info`; se
 *   gatea igual porque no está validado en vivo que no cree nada.
 * - `confirmTrip` (CTA «Viajo Ahora»): crea el viaje real; sin deshacer ni reintento.
 * Sin gate (solo lectura / cierre de avisos / pago): `readFinalCta`, `detectBlockingDialog`, `selectPayment`,
 * `dismissTripAlreadyCreatedModal`.
 *
 * Validación en vivo pendiente (login PAX bloqueado por FCM en emuladores): flujo relevado del código (develop) y V1.
 */

import type { MobileSession } from '../core/MobileSession.js';
import { tryUntil } from '../core/Waits.js';
import {
  PaymentSelectorScreen,
  pickCardIndex,
  type PaymentKind
} from '../screens/passenger/PaymentSelectorScreen.js';
import {
  PassengerTripConfirmScreen,
  collectTripCodes,
  extractTravelId,
  type BlockingKind,
  type DialogInfo
} from '../screens/passenger/TripConfirmScreen.js';
import {
  assertConfirmed,
  IrreversibleNotConfirmedError,
  type IrreversibleOptions
} from './OfferPBO.js';

export { IrreversibleNotConfirmedError };
export type { IrreversibleOptions };

export type PaymentRequest =
  | { type: 'cash' }
  | { type: 'checking-account' }
  | { type: 'credit-card'; last4?: string };

export type PaymentSelection = {
  type: PaymentKind;
  last4: string | null;
  alreadySelected: boolean;
};

export type BlockedOutcome = {
  outcome: 'blocked-active-trip';
  message: string;
  dismissed: boolean;
};
export type CreditLimitOutcome = { outcome: 'credit-limit'; message: string; dismissed: boolean };
export type CreatedOutcome = {
  outcome: 'created';
  /** Código `<n>-<letra>` NUEVO (no presente antes de confirmar) o, si no hay, el `travelId`; `null` si no se vio. */
  tripCode: string | null;
};
export type ConfirmTripResult = CreatedOutcome | BlockedOutcome | CreditLimitOutcome;
export type ProceedResult =
  | { outcome: 'trip-info' }
  | Omit<BlockedOutcome, 'dismissed'>
  | Omit<CreditLimitOutcome, 'dismissed'>;

export class TripInfoNotShownError extends Error {
  constructor(detail = 'la app no está en travel-info') {
    super(`[TripRequestPBO] ${detail}; no se toca ningún CTA.`);
    this.name = 'TripInfoNotShownError';
  }
}
export class TripCtaNotFoundError extends Error {
  constructor(cta: string) {
    super(`[TripRequestPBO] CTA «${cta}» no encontrado o no tocable.`);
    this.name = 'TripCtaNotFoundError';
  }
}
export class FinalCtaNotEnabledError extends Error {
  constructor(state: string) {
    super(`[TripRequestPBO] el CTA final no está habilitado (${state}); no se confirma nada.`);
    this.name = 'FinalCtaNotEnabledError';
  }
}
/** Tras el tap final no apareció ni el viaje creado ni un bloqueo conocido: el resultado es desconocido. */
export class TripOutcomeUnknownError extends Error {
  constructor(timeoutMs: number) {
    super(
      `[TripRequestPBO] sin resultado tras ${timeoutMs} ms (ni «Buscando servicio» ni aviso de bloqueo). ` +
        'El viaje PUEDE haberse creado: verificar antes de reintentar.'
    );
    this.name = 'TripOutcomeUnknownError';
  }
}
export class PaymentMethodUnavailableError extends Error {
  constructor(
    readonly method: string,
    detail: string
  ) {
    super(`[TripRequestPBO] método de pago «${method}»: ${detail}.`);
    this.name = 'PaymentMethodUnavailableError';
  }
}
export class BlockingDialogNotFoundError extends Error {
  constructor(kind: BlockingKind) {
    super(
      `[TripRequestPBO] no se encontró el aviso «${kind}» para cerrar (o no tiene botón «Aceptar»).`
    );
    this.name = 'BlockingDialogNotFoundError';
  }
}

export type TripRequestPboDeps = {
  payment: Pick<PaymentSelectorScreen, 'readMethods' | 'tapMethod' | 'readCards' | 'tapCard'>;
  confirm: Pick<
    PassengerTripConfirmScreen,
    | 'isTripInfoShown'
    | 'readFinalCta'
    | 'tapSelectVehicleCta'
    | 'tapFinalConfirmCta'
    | 'readDialogs'
    | 'dismissBlockingDialog'
    | 'readTripHaystack'
    | 'isTripCreated'
  >;
};

export type TripRequestPboOptions = {
  log?: (message: string) => void;
  /** Esperas en ms (overridable en unit). */
  timeouts?: { tripInfo?: number; outcome?: number; tripCode?: number; interval?: number };
};

export class TripRequestPBO {
  private readonly log: (message: string) => void;
  private readonly t: Required<NonNullable<TripRequestPboOptions['timeouts']>>;

  constructor(
    private readonly deps: TripRequestPboDeps,
    options: TripRequestPboOptions = {}
  ) {
    this.log = options.log ?? ((m) => console.info(m));
    this.t = {
      tripInfo: options.timeouts?.tripInfo ?? 10_000,
      outcome: options.timeouts?.outcome ?? 20_000,
      tripCode: options.timeouts?.tripCode ?? 8_000,
      interval: options.timeouts?.interval ?? 500
    };
  }

  static forSession(session: MobileSession, options?: TripRequestPboOptions): TripRequestPBO {
    return new TripRequestPBO(
      {
        payment: new PaymentSelectorScreen(session),
        confirm: new PassengerTripConfirmScreen(session)
      },
      options
    );
  }

  /** Primer aviso de bloqueo visible (viaje activo o límite de crédito), sin cerrarlo; `null` si no hay. */
  async detectBlockingDialog(): Promise<{ kind: BlockingKind; message: string } | null> {
    const hit = (await this.deps.confirm.readDialogs()).find(
      (d): d is DialogInfo & { kind: BlockingKind } => d.kind !== null
    );
    return hit ? { kind: hit.kind, message: hit.text } : null;
  }

  /** Espera hasta `timeout` por el aviso «Ya tiene un viaje creado» (solo lectura). */
  async waitForTripAlreadyCreatedModal(timeout = 4_000): Promise<boolean> {
    const hit = await tryUntil(
      async () => (await this.detectBlockingDialog())?.kind === 'blocked-active-trip',
      { timeout, interval: this.t.interval, label: 'aviso «Ya tiene un viaje creado»' }
    );
    return hit === true;
  }

  /** Cierra «Ya tiene un viaje creado» tocando «Aceptar». Lanza `BlockingDialogNotFoundError` si no se pudo. */
  async dismissTripAlreadyCreatedModal(timeout = 8_000): Promise<void> {
    const ok = await tryUntil(
      () => this.deps.confirm.dismissBlockingDialog('blocked-active-trip'),
      {
        timeout,
        interval: this.t.interval
      }
    );
    if (!ok) throw new BlockingDialogNotFoundError('blocked-active-trip');
  }

  /** Estado (solo lectura) del CTA final de `travel-info`. */
  readFinalCta(): ReturnType<TripRequestPboDeps['confirm']['readFinalCta']> {
    return this.deps.confirm.readFinalCta();
  }

  /**
   * Elige el método de pago en `travel-info` (sin gate: no confirma nada). Tarjeta: si ya está elegida (con esos
   * últimos 4, si se pidieron) no toca; si no, toca la columna (en develop navega a `/cards`) y elige por últimos 4.
   */
  async selectPayment(request: PaymentRequest): Promise<PaymentSelection> {
    const last4 =
      request.type === 'credit-card' ? (request.last4?.replace(/\D/g, '').slice(-4) ?? '') : '';
    const methods = await this.deps.payment.readMethods();
    const method = methods.find((m) => m.kind === request.type);
    if (!method)
      throw new PaymentMethodUnavailableError(request.type, 'no aparece entre los métodos');
    if (method.disabled)
      throw new PaymentMethodUnavailableError(request.type, 'está deshabilitado');

    const labelHasCard = last4.length === 4 && method.text.includes(last4);
    if (method.selected && (request.type !== 'credit-card' || last4.length === 0 || labelHasCard)) {
      return { type: request.type, last4: last4 || null, alreadySelected: true };
    }
    if (!(await this.deps.payment.tapMethod(method.index))) {
      throw new PaymentMethodUnavailableError(request.type, 'no se pudo tocar');
    }
    if (request.type !== 'credit-card') {
      this.log(`[TripRequestPBO] método de pago «${request.type}» elegido.`);
      return { type: request.type, last4: null, alreadySelected: false };
    }
    if (last4.length < 4) return { type: request.type, last4: null, alreadySelected: false };

    const cards = await tryUntil(
      async () => {
        const list = await this.deps.payment.readCards();
        return list.length > 0 ? list : null;
      },
      { timeout: this.t.tripInfo, interval: this.t.interval }
    );
    const idx = cards ? pickCardIndex(cards, last4) : -1;
    if (!cards || idx < 0)
      throw new PaymentMethodUnavailableError(
        'credit-card',
        `no hay tarjeta con últimos 4 ${last4}`
      );
    if (cards[idx]!.expired)
      throw new PaymentMethodUnavailableError('credit-card', `la tarjeta ${last4} está vencida`);
    if (!(await this.deps.payment.tapCard(cards[idx]!.index))) {
      throw new PaymentMethodUnavailableError(
        'credit-card',
        `no se pudo elegir la tarjeta ${last4}`
      );
    }
    this.log(`[TripRequestPBO] tarjeta ...${last4} elegida.`);
    return { type: 'credit-card', last4, alreadySelected: false };
  }

  /**
   * CTA «Seleccionar Vehículo» -> `travel-info` (GATEADO). Si en su lugar aparece un aviso de bloqueo lo
   * devuelve (sin cerrarlo). Sin `{ confirmed: true }` lanza antes de tocar nada.
   */
  async proceedToTripInfo(options: IrreversibleOptions): Promise<ProceedResult> {
    assertConfirmed(options, 'Seleccionar vehículo (paso previo a crear el viaje)');
    if (!(await this.deps.confirm.tapSelectVehicleCta())) {
      throw new TripCtaNotFoundError('Seleccionar Vehículo');
    }
    const seen = await tryUntil(
      async (): Promise<ProceedResult | false> => {
        const block = await this.detectBlockingDialog();
        if (block) return { outcome: block.kind, message: block.message };
        return (await this.deps.confirm.isTripInfoShown()) ? { outcome: 'trip-info' } : false;
      },
      {
        timeout: this.t.tripInfo,
        interval: this.t.interval,
        label: 'travel-info o aviso de bloqueo'
      }
    );
    if (!seen)
      throw new TripInfoNotShownError('tras «Seleccionar Vehículo» no apareció travel-info');
    // Ya en travel-info: un aviso de crédito puede llegar con la estimación.
    if (seen.outcome === 'trip-info') {
      const late = await this.detectBlockingDialog();
      if (late) return { outcome: late.kind, message: late.message };
    }
    return seen;
  }

  /**
   * CTA final «Viajo Ahora» (GATEADO; CREA UN VIAJE REAL, sin deshacer). Sin `{ confirmed: true }` lanza
   * `IrreversibleNotConfirmedError` ANTES de tocar la pantalla. Exige estar en `travel-info` con el CTA habilitado.
   * `dismissBlocking` (default `true`) cierra el aviso de bloqueo con «Aceptar» (nunca «Llamar»).
   */
  async confirmTrip(
    options: IrreversibleOptions,
    extra: { dismissBlocking?: boolean } = {}
  ): Promise<ConfirmTripResult> {
    assertConfirmed(options, 'Confirmar el viaje («Viajo Ahora»)');
    const dismissBlocking = extra.dismissBlocking ?? true;
    if (!(await this.deps.confirm.isTripInfoShown())) throw new TripInfoNotShownError();
    const cta = await this.deps.confirm.readFinalCta();
    if (!cta.enabled) throw new FinalCtaNotEnabledError(cta.present ? 'deshabilitado' : 'ausente');

    // Snapshot de códigos ya visibles ANTES de confirmar (historial) para no devolver un viaje viejo.
    const before = new Set(collectTripCodes(await this.deps.confirm.readTripHaystack()));
    if (!(await this.deps.confirm.tapFinalConfirmCta()))
      throw new TripCtaNotFoundError('Viajo Ahora');

    const result = await tryUntil(
      async (): Promise<'created' | { kind: BlockingKind; message: string } | false> => {
        const block = await this.detectBlockingDialog();
        if (block) return block;
        return (await this.deps.confirm.isTripCreated()) ? 'created' : false;
      },
      { timeout: this.t.outcome, interval: this.t.interval, label: 'resultado de «Viajo Ahora»' }
    );
    if (!result) throw new TripOutcomeUnknownError(this.t.outcome);

    if (result !== 'created') {
      const dismissed = dismissBlocking
        ? await this.deps.confirm.dismissBlockingDialog(result.kind)
        : false;
      this.log(`[TripRequestPBO] bloqueo «${result.kind}»: ${result.message}`);
      return { outcome: result.kind, message: result.message, dismissed };
    }

    const tripCode = await tryUntil(
      async () => {
        const haystack = await this.deps.confirm.readTripHaystack();
        return collectTripCodes(haystack).find((c) => !before.has(c)) ?? extractTravelId(haystack);
      },
      { timeout: this.t.tripCode, interval: this.t.interval }
    );
    this.log(`[TripRequestPBO] viaje creado (código=${tripCode ?? 'n/d'}).`);
    return { outcome: 'created', tripCode };
  }
}
